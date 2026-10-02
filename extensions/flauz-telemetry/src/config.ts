/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The telemetry config (A-PROD-004-W4) -- the opt-in plane.
 *
 * THE OPT-IN LAW: telemetry is OFF until the operator explicitly enables it
 * (`flauz.telemetry.config` with `{ enable: true }`). Enabling requires the
 * operator's explicit action, records the consent event itself (both in the
 * config artifact and as a ledger row -- the audit of the operator's action,
 * not collection of observed events), and pins the digest of the declared
 * event schema that was inspectable BEFORE the enable. A record pass while
 * disabled is a typed refusal (record.ts), never a silent no-op.
 *
 * THE SCHEMA-DRIFT LAW: an ENABLED config whose pinned schema digest no
 * longer equals the live declared schema means the recording vocabulary
 * changed under an active consent -- every record pass refuses typed
 * (FLAUZ_TELEMETRY_SCHEMA_DRIFT) until the operator re-inspects and
 * re-enables against the new digest. Consent is pinned to the exact
 * vocabulary it was given for.
 */

import {
	CONFIG_PATH,
	DEFAULT_RETENTION_DAYS,
	RETENTION_DAYS_MAX,
	RETENTION_DAYS_MIN,
	TELEMETRY_CONFIG_SCHEMA_ID,
	TelemetryError,
	canonicalJson,
	hasKey,
	isPlainObject,
	joinPath,
	serializeArtifact,
	sha256Hex,
	splitJsonl,
	type Clock,
	type TelemetryFsPort,
} from './api.ts';
import { eventSchemaDigest, renderSchemaLines, type EventKind, type Outcome, type SurfaceId } from './schema.ts';

// ---------------------------------------------------------------------------
// The config artifact shape
// ---------------------------------------------------------------------------

/** The consent block -- the operator's explicit action, recorded by the config itself. */
export interface ConsentEvent {
	/** When the explicit action happened. */
	readonly at: number;
	/** The action: 'enable' | 'disable' (the consent vocabulary). */
	readonly action: 'enable' | 'disable';
}

/** The telemetry configuration (the persisted opt-in state). */
export interface TelemetryConfig {
	readonly enabled: boolean;
	/** Retention window in days (rows older than this are pruned at record time). */
	readonly retentionDays: number;
	/** The digest of the declared event schema pinned at (last) enable time. */
	readonly schemaDigest: string;
	/** The last explicit operator action (undefined before any action). */
	readonly consent?: ConsentEvent;
}

// ---------------------------------------------------------------------------
// Load + persist
// ---------------------------------------------------------------------------

const CONFIG_SCHEMA_VERSION = 0;
const CONSENT_ACTIONS = ['enable', 'disable'] as const;

/**
 * Loads the telemetry config. An ABSENT config is the default-off state (not
 * an error -- telemetry ships disabled). A PRESENT-but-malformed config is a
 * typed corruption refusal: the opt-in state may never be guessed.
 */
export async function loadTelemetryConfig(root: string, fs: TelemetryFsPort): Promise<TelemetryConfig> {
	const text = await fs.readFileUtf8(joinPath(root, CONFIG_PATH));
	if (text === undefined) {
		return { enabled: false, retentionDays: DEFAULT_RETENTION_DAYS, schemaDigest: eventSchemaDigest() };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH} is not valid JSON (${(err as Error).message}) -- the opt-in state may never be guessed; fix or remove the config and re-enable consciously`);
	}
	if (!isPlainObject(parsed)) {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH} is not a JSON object -- the opt-in state may never be guessed; fix or remove the config and re-enable consciously`);
	}
	if (parsed.$schema !== TELEMETRY_CONFIG_SCHEMA_ID) {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH} carries $schema ${JSON.stringify(parsed.$schema)} (expected '${TELEMETRY_CONFIG_SCHEMA_ID}') -- a foreign artifact is not a telemetry config`);
	}
	if (parsed.schemaVersion !== CONFIG_SCHEMA_VERSION) {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH} carries schemaVersion ${JSON.stringify(parsed.schemaVersion)} (expected ${String(CONFIG_SCHEMA_VERSION)})`);
	}
	if (typeof parsed.enabled !== 'boolean') {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH}: 'enabled' must be a boolean (the opt-in state)`);
	}
	if (typeof parsed.retentionDays !== 'number' || !Number.isSafeInteger(parsed.retentionDays) || parsed.retentionDays < RETENTION_DAYS_MIN || parsed.retentionDays > RETENTION_DAYS_MAX) {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH}: 'retentionDays' must be an integer in [${String(RETENTION_DAYS_MIN)}, ${String(RETENTION_DAYS_MAX)}]`);
	}
	if (typeof parsed.schemaDigest !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.schemaDigest)) {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH}: 'schemaDigest' must be 64 lowercase hex chars (the declared schema pinned at enable time)`);
	}
	let consent: ConsentEvent | undefined;
	if (hasKey(parsed, 'consent')) {
		const value = parsed.consent;
		if (!isPlainObject(value) || typeof value.at !== 'number' || !Number.isSafeInteger(value.at) || value.at <= 0 || (value.action !== 'enable' && value.action !== 'disable')) {
			throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_CORRUPT', `flauz.telemetry/v1: ${CONFIG_PATH}: 'consent' must be { at: positive integer, action: ${CONSENT_ACTIONS.join(' | ')} }`);
		}
		consent = { at: value.at, action: value.action };
	}
	return {
		enabled: parsed.enabled,
		retentionDays: parsed.retentionDays,
		schemaDigest: parsed.schemaDigest,
		...(consent !== undefined ? { consent } : {}),
	};
}

/** Persists the telemetry config (canonical artifact bytes; caller sweeps first). */
export async function persistTelemetryConfig(root: string, fs: TelemetryFsPort, config: TelemetryConfig): Promise<void> {
	const artifact = {
		$schema: TELEMETRY_CONFIG_SCHEMA_ID,
		schemaVersion: CONFIG_SCHEMA_VERSION,
		enabled: config.enabled,
		retentionDays: config.retentionDays,
		schemaDigest: config.schemaDigest,
		...(config.consent !== undefined ? { consent: config.consent } : {}),
	};
	const target = joinPath(root, CONFIG_PATH);
	await fs.mkdir(target.split('/').slice(0, -1).join('/'));
	await fs.writeFile(target, serializeArtifact(artifact));
}

// ---------------------------------------------------------------------------
// The consent-event ledger row (the config records the consent event itself)
// ---------------------------------------------------------------------------

/** One telemetry ledger row (the durable form -- see record.ts for the full row contract). */
export interface TelemetryRow {
	readonly $schema: string;
	readonly seq: number;
	readonly at: number;
	readonly session: string;
	readonly eventKind: EventKind;
	readonly surface: SurfaceId;
	readonly outcome: Outcome;
	readonly durationBucket: string;
	readonly errorCode?: string;
	readonly identity?: Record<string, string>;
	readonly count: number;
}

/** The canonical ledger line of a row (no trailing newline). */
export function telemetryRowLine(row: TelemetryRow): string {
	return canonicalJson(row);
}

/**
 * Appends the consent event row to the telemetry ledger. This is the ONE row
 * class written by the config plane: the audit of the operator's explicit
 * action (not collection of observed events). The row is closed-vocabulary
 * and swept before the write.
 */
export async function appendConsentEvent(deps: { root: string; fs: TelemetryFsPort; clock: Clock }, action: 'enable' | 'disable'): Promise<void> {
	const row: TelemetryRow = {
		$schema: 'flauz.telemetry-event/v1',
		seq: await nextLedgerSeq(deps.root, deps.fs),
		at: deps.clock(),
		session: `config-${String(deps.clock())}`,
		eventKind: 'config',
		surface: 'flauz-telemetry',
		outcome: action === 'enable' ? 'enabled' : 'disabled',
		durationBucket: 'unrecorded',
		count: 1,
	};
	const target = joinPath(deps.root, '.flauz/telemetry/ledger.jsonl');
	await deps.fs.mkdir(target.split('/').slice(0, -1).join('/'));
	await deps.fs.appendFile(target, `${telemetryRowLine(row)}\n`);
}

/** The next ledger seq (line count + 1; a torn final line is counted, never silently repaired). */
async function nextLedgerSeq(root: string, fs: TelemetryFsPort): Promise<number> {
	const text = await fs.readFileUtf8(joinPath(root, '.flauz/telemetry/ledger.jsonl'));
	if (text === undefined || text === '') {
		return 1;
	}
	return splitJsonl(text).length + 1;
}

// ---------------------------------------------------------------------------
// The change plane
// ---------------------------------------------------------------------------

/** The parsed config-command argument ({ enable?, retentionDays? }). */
export interface ConfigChange {
	readonly enable?: boolean;
	readonly retentionDays?: number;
}

/** Parses the config-command argument (typed refusal on malformed shapes). */
export function parseConfigArg(arg: unknown): ConfigChange {
	if (arg === undefined || arg === null) {
		return {};
	}
	if (typeof arg !== 'object' || Array.isArray(arg)) {
		throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_INVALID', 'flauz.telemetry.config: the argument must be an object like { enable: true } or { retentionDays: 30 } (or omitted to inspect)');
	}
	const record = arg as Record<string, unknown>;
	const change: { enable?: boolean; retentionDays?: number } = {};
	if (hasKey(record, 'enable')) {
		if (typeof record.enable !== 'boolean') {
			throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_INVALID', 'flauz.telemetry.config: \'enable\' must be a boolean (true is the explicit operator consent that turns collection on)');
		}
		change.enable = record.enable;
	}
	if (hasKey(record, 'retentionDays')) {
		if (typeof record.retentionDays !== 'number' || !Number.isSafeInteger(record.retentionDays) || record.retentionDays < RETENTION_DAYS_MIN || record.retentionDays > RETENTION_DAYS_MAX) {
			throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_INVALID', `flauz.telemetry.config: 'retentionDays' must be an integer in [${String(RETENTION_DAYS_MIN)}, ${String(RETENTION_DAYS_MAX)}]`);
		}
		change.retentionDays = record.retentionDays;
	}
	for (const key of Object.keys(record)) {
		if (key !== 'enable' && key !== 'retentionDays') {
			throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_INVALID', `flauz.telemetry.config: unknown argument key '${key}' (accepted: enable, retentionDays)`);
		}
	}
	return change;
}

/**
 * Applies a config change: the explicit-enable path pins the CURRENT schema
 * digest + records the consent event; the explicit-disable path records the
 * disable consent event. Retention-only changes persist without consent
 * rows (they alter the pruning window, not the collection state).
 */
export async function applyConfigChange(
	deps: { root: string; fs: TelemetryFsPort; clock: Clock },
	current: TelemetryConfig,
	change: ConfigChange,
): Promise<TelemetryConfig> {
	let next: TelemetryConfig = { ...current };
	if (change.retentionDays !== undefined) {
		next = { ...next, retentionDays: change.retentionDays };
	}
	if (change.enable === undefined) {
		if (change.retentionDays === undefined) {
			return current; // pure inspection: nothing persists
		}
		await persistTelemetryConfig(deps.root, deps.fs, next);
		return next;
	}
	const consent: ConsentEvent = { at: deps.clock(), action: change.enable ? 'enable' : 'disable' };
	next = { ...next, enabled: change.enable, consent, schemaDigest: eventSchemaDigest() };
	await persistTelemetryConfig(deps.root, deps.fs, next);
	await appendConsentEvent(deps, change.enable ? 'enable' : 'disable');
	return next;
}

// ---------------------------------------------------------------------------
// The render (the disclosure -- the schema FIRST, then the state)
// ---------------------------------------------------------------------------

/** Renders the config surface: the declared schema (the inspect-before-enable plane), then the live state. */
export function renderConfigLines(config: TelemetryConfig): string[] {
	const lines: string[] = [];
	lines.push('flauz.telemetry.config -- the opt-in plane (inspect the schema BEFORE enabling; enabling is the operator\'s explicit action):');
	lines.push('');
	for (const line of renderSchemaLines()) {
		lines.push(line);
	}
	lines.push('');
	lines.push(`  state: enabled = ${config.enabled ? 'TRUE (collecting, workspace-local only)' : 'FALSE (zero collection; a record attempt is a typed refusal, never a silent no-op)'}`);
	lines.push(`  retention: ${String(config.retentionDays)} day(s) (rows older than this are pruned at record time)`);
	lines.push(`  pinned schema digest: ${config.schemaDigest}${config.schemaDigest === eventSchemaDigest() ? ' (matches the live declared schema)' : ' (DRIFTED from the live declared schema -- record passes refuse typed until re-enabled)'}`);
	if (config.consent !== undefined) {
		lines.push(`  last consent event: ${config.consent.action === 'enable' ? 'ENABLE' : 'DISABLE'} at ${String(config.consent.at)} (the config records the consent event itself; it is also banked as a ledger row)`);
	} else {
		lines.push('  last consent event: none (telemetry has never been enabled in this workspace)');
	}
	lines.push('  local-first: aggregates persist under .flauz/telemetry/ only; no network egress exists in v0; nothing leaves the machine');
	return lines;
}

/** The digest check exported for the record pass (the schema-drift law). */
export function schemaDigestMatches(config: TelemetryConfig): boolean {
	return config.schemaDigest === eventSchemaDigest();
}

/** sha256 re-export for the digest computation sites (single import surface). */
export const digestOf = sha256Hex;
