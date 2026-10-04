/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The incident intake core (A-PROD-006-W1): the `flauz.incidents.report`
 * semantics -- the typed incident intake.
 *
 * THE INCIDENT RECORD (the order's law, verbatim): the incident id
 * (`flauz:inc:<16-hex>` from an explicit rng/seed input), the class, the
 * severity (sev1..sev4), the affected surface, the repro note, the evidence
 * refs (paths under `.flauz/` only), the reportedAtIso, and the TYPED source
 * binding: `manual` (operator-entered, disclosed as such) |
 * `telemetry-census` (a `flauz.failures.list` census entry) |
 * `durability-escalation` (an escalation-demand record) | `dogfood-friction`
 * (a `flauz.dogfood-friction/v1` entry). A source binding that cannot
 * resolve is a TYPED DISCLOSURE record, never a dropped row and never a
 * fabricated/inferred incident.
 *
 * THE UNIQUE-ID LAW (the durability pattern): re-reporting an id appends a
 * NEW revision, never duplicates. The incident ledger persists
 * `.flauz/incidents/incidents.json` (`flauz.incidents/v1`), append-only,
 * census-visible, swept + banked (taskId `flauz-incidents`).
 *
 * THE PRIVACY LAW (the repro-note canary): the repro note is swept FAIL-CLOSED
 * for secret-shaped values BEFORE the record is written (a secret-shaped
 * repro note refuses the whole report). The banked census row carries the
 * sha256 of the artifact -- never the repro note text -- so the canary test
 * proves repro notes never reach banked census rows.
 *
 * THE EVIDENCE-REF SCOPING LAW: every evidence ref must be a
 * workspace-relative path under `.flauz/` only (never absolute host paths,
 * never parent-escape, never contents).
 */

import {
	type Clock,
	type IncidentsFsPort,
	type IncidentRecord,
	type IncidentRevision,
	type IncidentsLedger,
	type SourceBinding,
	type Severity,
	IncidentsError,
	EXTENSION_ID,
	INCIDENTS_SCHEMA_ID,
	INCIDENTS_DIR,
	INCIDENTS_FILENAME,
	SEVERITIES,
	SOURCE_BINDING_KINDS,
	isUnderFlauz,
	incidentIdFromSeed,
	joinPath,
	readIncidentsLedger,
	serializeArtifact,
	parseTelemetryFailureCensusLenient,
	parseDurabilityHeartbeatLenient,
	parseFrictionRowLenient,
	splitJsonl,
} from './api.ts';
import { bankRecord, type BankingOutcome } from './ledger.ts';
import { sweepArtifact } from './privacy.ts';
import { toIsoStamp } from './format.ts';
import { fireIntakeRow, type PersistedJournal } from './loop.ts';

/** The report command's typed arguments (commands carry DATA only). */
export interface ReportArgs {
	/** The incident id seed (the explicit rng/seed input; the id is the first 16 hex chars of sha256(seed)). */
	readonly seed: string;
	readonly class: string;
	readonly severity: Severity;
	readonly affectedSurface: string;
	readonly reproNote: string;
	readonly evidenceRefs: readonly string[];
	readonly sourceBinding:
		| { readonly kind: 'manual' }
		| { readonly kind: 'telemetry-census'; readonly failureClass: string; readonly censusPath: string }
		| { readonly kind: 'durability-escalation'; readonly laneId: string; readonly heartbeatPath: string; readonly policy: string }
		| { readonly kind: 'dogfood-friction'; readonly frictionKind: string; readonly phase: string; readonly frictionLogPath: string };
	/** The operator id firing the report (the actor carried by the loop journal intake row; never contents). */
	readonly actor: string;
}

/** Parses + validates the report arguments (the typed refusal surface). */
export function parseReportArgs(arg: unknown): ReportArgs {
	if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: the argument must be { seed, class, severity, affectedSurface, reproNote, evidenceRefs, sourceBinding, actor }');
	}
	const record = arg as Record<string, unknown>;
	if (typeof record.seed !== 'string' || record.seed.length === 0) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: seed must be a non-empty string (the explicit rng/seed input -- the incident id is the first 16 hex chars of sha256(seed))');
	}
	if (typeof record.class !== 'string' || record.class.length === 0) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: class must be a non-empty string (the incident class)');
	}
	if (typeof record.severity !== 'string' || !(SEVERITIES as readonly string[]).includes(record.severity)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: severity must be one of ${SEVERITIES.join('|')} (sev1..sev4)`);
	}
	if (typeof record.affectedSurface !== 'string' || record.affectedSurface.length === 0) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: affectedSurface must be a non-empty string (the affected surface)');
	}
	if (typeof record.reproNote !== 'string') {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: reproNote must be a string (the reproduction account; swept fail-closed for secret-shaped values)');
	}
	if (!Array.isArray(record.evidenceRefs) || !record.evidenceRefs.every((ref: unknown) => typeof ref === 'string' && isUnderFlauz(ref as string))) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: evidenceRefs must be an array of workspace-relative paths under ${INCIDENTS_DIR.split('/').slice(0, 1).join('/')}/ only (never absolute, never parent-escape, never contents)`);
	}
	if (typeof record.actor !== 'string' || record.actor.length === 0) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: actor must be a non-empty string (the operator id firing the report; never contents)');
	}
	const bindingRaw = record.sourceBinding;
	if (!bindingRaw || typeof bindingRaw !== 'object' || Array.isArray(bindingRaw)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: sourceBinding must be { kind, ... } (the typed source binding)');
	}
	const bindingRecord = bindingRaw as Record<string, unknown>;
	if (typeof bindingRecord.kind !== 'string' || !(SOURCE_BINDING_KINDS as readonly string[]).includes(bindingRecord.kind)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: sourceBinding.kind must be one of ${SOURCE_BINDING_KINDS.join('|')} (manual | telemetry-census | durability-escalation | dogfood-friction)`);
	}
	if (bindingRecord.kind === 'manual') {
		return {
			seed: record.seed,
			class: record.class,
			severity: record.severity as Severity,
			affectedSurface: record.affectedSurface,
			reproNote: record.reproNote,
			evidenceRefs: [...(record.evidenceRefs as string[])],
			sourceBinding: { kind: 'manual' },
			actor: record.actor,
		};
	}
	if (bindingRecord.kind === 'telemetry-census') {
		if (typeof bindingRecord.failureClass !== 'string' || bindingRecord.failureClass.length === 0) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: sourceBinding.failureClass must be a non-empty string (the telemetry failure-census class id)');
		}
		if (typeof bindingRecord.censusPath !== 'string' || bindingRecord.censusPath.length === 0 || !isUnderFlauz(bindingRecord.censusPath)) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: sourceBinding.censusPath must be a workspace-relative path under ${INCIDENTS_DIR.split('/').slice(0, 1).join('/')}/ only (the flauz.failures.list census record path)`);
		}
		return {
			seed: record.seed,
			class: record.class,
			severity: record.severity as Severity,
			affectedSurface: record.affectedSurface,
			reproNote: record.reproNote,
			evidenceRefs: [...(record.evidenceRefs as string[])],
			sourceBinding: { kind: 'telemetry-census', failureClass: bindingRecord.failureClass, censusPath: bindingRecord.censusPath },
			actor: record.actor,
		};
	}
	if (bindingRecord.kind === 'durability-escalation') {
		if (typeof bindingRecord.laneId !== 'string' || bindingRecord.laneId.length === 0) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: sourceBinding.laneId must be a non-empty string (the durability lane id)');
		}
		if (typeof bindingRecord.heartbeatPath !== 'string' || bindingRecord.heartbeatPath.length === 0 || !isUnderFlauz(bindingRecord.heartbeatPath)) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: sourceBinding.heartbeatPath must be a workspace-relative path under ${INCIDENTS_DIR.split('/').slice(0, 1).join('/')}/ only (the flauz.durability-heartbeat/v1 record path)`);
		}
		if (typeof bindingRecord.policy !== 'string' || bindingRecord.policy.length === 0) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: sourceBinding.policy must be a non-empty string (the escalation policy: notify | checkpoint-and-restart | refuse)');
		}
		return {
			seed: record.seed,
			class: record.class,
			severity: record.severity as Severity,
			affectedSurface: record.affectedSurface,
			reproNote: record.reproNote,
			evidenceRefs: [...(record.evidenceRefs as string[])],
			sourceBinding: { kind: 'durability-escalation', laneId: bindingRecord.laneId, heartbeatPath: bindingRecord.heartbeatPath, policy: bindingRecord.policy },
			actor: record.actor,
		};
	}
	if (bindingRecord.kind === 'dogfood-friction') {
		if (typeof bindingRecord.frictionKind !== 'string' || bindingRecord.frictionKind.length === 0) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: sourceBinding.frictionKind must be a non-empty string (the dogfood friction kind: failed-task | manual-intervention | confusing-ux | provider-failure | browser-env-failure | slow-path | recovery-defect | evidence-gap | upgrade-migration)');
		}
		if (typeof bindingRecord.phase !== 'string' || bindingRecord.phase.length === 0) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: sourceBinding.phase must be a non-empty string (the friction phase)');
		}
		if (typeof bindingRecord.frictionLogPath !== 'string' || bindingRecord.frictionLogPath.length === 0 || !isUnderFlauz(bindingRecord.frictionLogPath)) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: sourceBinding.frictionLogPath must be a workspace-relative path under ${INCIDENTS_DIR.split('/').slice(0, 1).join('/')}/ only (the flauz.dogfood-friction/v1 log path)`);
		}
		return {
			seed: record.seed,
			class: record.class,
			severity: record.severity as Severity,
			affectedSurface: record.affectedSurface,
			reproNote: record.reproNote,
			evidenceRefs: [...(record.evidenceRefs as string[])],
			sourceBinding: { kind: 'dogfood-friction', frictionKind: bindingRecord.frictionKind, phase: bindingRecord.phase, frictionLogPath: bindingRecord.frictionLogPath },
			actor: record.actor,
		};
	}
	throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: sourceBinding.kind must be one of ${SOURCE_BINDING_KINDS.join('|')} (got ${JSON.stringify(bindingRecord.kind)})`);
}

/** The report outcome (command-level). */
export interface ReportResult {
	readonly ok: true;
	readonly incidentId: string;
	/** True when this call APPENDED a new revision to an existing incident (never a duplicate). */
	readonly revised: boolean;
	readonly revision: number;
	readonly incidentCount: number;
	readonly record: IncidentsLedger;
	readonly persisted: PersistedIncidents;
	/** The source-binding resolution state (resolved | disclosed-unresolvable | manual-disclosed). */
	readonly sourceBindingState: 'resolved' | 'disclosed-unresolvable' | 'manual-disclosed';
	/** The intake row's persistence outcome (present ONLY on the FIRST report -- the loop journal's entry into the `incident` stage; absent on revisions). */
	readonly intakeJournal?: PersistedJournal;
}

/** The persisted outcome. */
export interface PersistedIncidents {
	readonly recordPath: string;
	readonly record: IncidentsLedger;
	readonly banking: BankingOutcome;
}

/** The incident ledger's workspace-relative path (the record + banked uri). */
export const INCIDENTS_LEDGER_PATH = joinPath(INCIDENTS_DIR, INCIDENTS_FILENAME);

/**
 * Resolves a source binding against its referenced record (the typed
 * disclosure law: a binding that cannot resolve is recorded as
 * `disclosed-unresolvable`, never a dropped row and never a fabricated
 * incident). The resolution reads the source record via the fs port (the
 * workspace-bound read surface) and checks the binding's claim.
 */
export async function resolveSourceBinding(deps: { root: string; fs: IncidentsFsPort }, binding: ReportArgs['sourceBinding']): Promise<SourceBinding> {
	if (binding.kind === 'manual') {
		return { kind: 'manual', resolved: true, disclosed: 'manual-disclosed' };
	}
	if (binding.kind === 'telemetry-census') {
		const text = await deps.fs.readFileUtf8(joinPath(deps.root, binding.censusPath));
		if (text === undefined) {
			return { kind: 'telemetry-census', failureClass: binding.failureClass, censusPath: binding.censusPath, resolved: false, disclosed: 'disclosed-unresolvable' };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { kind: 'telemetry-census', failureClass: binding.failureClass, censusPath: binding.censusPath, resolved: false, disclosed: 'disclosed-unresolvable' };
		}
		const census = parseTelemetryFailureCensusLenient(parsed);
		if (census === undefined) {
			return { kind: 'telemetry-census', failureClass: binding.failureClass, censusPath: binding.censusPath, resolved: false, disclosed: 'disclosed-unresolvable' };
		}
		const found = census.classes.some(row => row.failureClass === binding.failureClass);
		return { kind: 'telemetry-census', failureClass: binding.failureClass, censusPath: binding.censusPath, resolved: found, disclosed: found ? 'resolved' : 'disclosed-unresolvable' };
	}
	if (binding.kind === 'durability-escalation') {
		const text = await deps.fs.readFileUtf8(joinPath(deps.root, binding.heartbeatPath));
		if (text === undefined) {
			return { kind: 'durability-escalation', laneId: binding.laneId, heartbeatPath: binding.heartbeatPath, policy: binding.policy, resolved: false, disclosed: 'disclosed-unresolvable' };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { kind: 'durability-escalation', laneId: binding.laneId, heartbeatPath: binding.heartbeatPath, policy: binding.policy, resolved: false, disclosed: 'disclosed-unresolvable' };
		}
		const heartbeat = parseDurabilityHeartbeatLenient(parsed);
		if (heartbeat === undefined) {
			return { kind: 'durability-escalation', laneId: binding.laneId, heartbeatPath: binding.heartbeatPath, policy: binding.policy, resolved: false, disclosed: 'disclosed-unresolvable' };
		}
		const found = heartbeat.escalation !== undefined && heartbeat.escalation.policy === binding.policy && heartbeat.laneId === binding.laneId;
		return { kind: 'durability-escalation', laneId: binding.laneId, heartbeatPath: binding.heartbeatPath, policy: binding.policy, resolved: found, disclosed: found ? 'resolved' : 'disclosed-unresolvable' };
	}
	// dogfood-friction: read the JSONL log, find a friction row matching the kind + phase
	const text = await deps.fs.readFileUtf8(joinPath(deps.root, binding.frictionLogPath));
	if (text === undefined) {
		return { kind: 'dogfood-friction', frictionKind: binding.frictionKind, phase: binding.phase, frictionLogPath: binding.frictionLogPath, resolved: false, disclosed: 'disclosed-unresolvable' };
	}
	const rows: unknown[] = [];
	for (const line of splitJsonl(text)) {
		if (line === '') {
			continue;
		}
		try {
			rows.push(JSON.parse(line));
		} catch {
			// a torn line does not fail the whole resolution (the log's other rows may still match); continue
		}
	}
	const found = rows.some(row => {
		const parsed = parseFrictionRowLenient(row);
		if (parsed === undefined) {
			return false;
		}
		return parsed.kind === binding.frictionKind && parsed.phase === binding.phase;
	});
	return { kind: 'dogfood-friction', frictionKind: binding.frictionKind, phase: binding.phase, frictionLogPath: binding.frictionLogPath, resolved: found, disclosed: found ? 'resolved' : 'disclosed-unresolvable' };
}

/**
 * Reports (or re-reports) one incident. THE UNIQUE-ID LAW: re-reporting an
 * id appends a NEW revision, never duplicates. The source binding is
 * resolved against its referenced record; a binding that cannot resolve is
 * recorded as a TYPED DISCLOSURE (the incident is still recorded, disclosed
 * as `disclosed-unresolvable`). The repro note is swept fail-closed for
 * secret-shaped values BEFORE the record is written.
 */
export async function reportIncident(deps: { root: string; fs: IncidentsFsPort; clock: Clock }, args: ReportArgs): Promise<ReportResult> {
	const ledger = await readIncidentsLedger(deps.root, deps.fs);
	if (ledger.state === 'torn') {
		throw new IncidentsError('FLAUZ_INCIDENTS_FORMAT', `flauz.incidents.report: REFUSED -- the incident ledger is torn (${ledger.reason}); a report would silently erase the torn evidence -- route to the operator`);
	}

	const incidentId = incidentIdFromSeed(args.seed);
	const at = deps.clock();
	const reportedAtIso = toIsoStamp(at);

	const sourceBinding = await resolveSourceBinding(deps, args.sourceBinding);

	const revision: IncidentRevision = {
		revision: 0, // filled below once we know the existing revision count
		reportedAtIso,
		reportedAtEpoch: at,
		class: args.class,
		severity: args.severity,
		affectedSurface: args.affectedSurface,
		reproNote: args.reproNote,
		evidenceRefs: [...args.evidenceRefs],
		sourceBinding,
	};

	const baseIncidents: readonly IncidentRecord[] = ledger.state === 'resolved' ? ledger.record.incidents : [];
	const existing = baseIncidents.find(inc => inc.incidentId === incidentId);
	const revised = existing !== undefined;
	const newRevisionNumber = revised ? existing.revisions.length + 1 : 1;
	const filledRevision: IncidentRevision = { ...revision, revision: newRevisionNumber };

	const incident: IncidentRecord = existing !== undefined
		? { ...existing, revisions: [...existing.revisions, filledRevision] }
		: { incidentId, firstReportedAtIso: reportedAtIso, firstReportedAtEpoch: at, revisions: [filledRevision] };

	const incidents = existing !== undefined
		? baseIncidents.map(inc => inc.incidentId === incidentId ? incident : inc)
		: [...baseIncidents, incident];

	const record: IncidentsLedger = {
		$schema: INCIDENTS_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-incidents',
		createdAt: ledger.state === 'resolved' ? ledger.record.createdAt : at,
		updatedAt: at,
		extensionId: EXTENSION_ID,
		incidents: [...incidents].sort((a, b) => (a.incidentId < b.incidentId ? -1 : a.incidentId > b.incidentId ? 1 : 0)),
	};

	const persisted = await persistIncidents(deps, record);

	// the privacy canary: the repro note is swept fail-closed via bankRecord
	// (the banked census row carries the sha256 of the artifact, NEVER the
	// repro note text -- the canary proves repro notes never reach banked
	// census rows). The pre-write sweep on the assembled record refuses the
	// whole report on a secret-shaped repro note.

	// the intake row: the FIRST report fires the loop journal's intake row
	// (the loop's entry into the `incident` stage; transition='forward',
	// toStage='incident'). A revision does NOT fire another intake row -- the
	// loop is already in some stage; the revision updates the incident's
	// metadata only (the unique-id law: re-reporting appends a NEW revision,
	// never a duplicate; the loop journal is append-only, one intake row per
	// incident).
	const intakeJournal = revised ? undefined : await fireIntakeRow(deps, incidentId, args.actor);

	let sourceBindingState: 'resolved' | 'disclosed-unresolvable' | 'manual-disclosed';
	if (sourceBinding.kind === 'manual') {
		sourceBindingState = 'manual-disclosed';
	} else if (sourceBinding.resolved) {
		sourceBindingState = 'resolved';
	} else {
		sourceBindingState = 'disclosed-unresolvable';
	}

	return { ok: true, incidentId, revised, revision: newRevisionNumber, incidentCount: record.incidents.length, record, persisted, sourceBindingState, intakeJournal };
}

/** Persists the incident ledger the W3 way: swept (fail-closed BEFORE the write), written, banked census-visible. */
export async function persistIncidents(deps: { root: string; fs: IncidentsFsPort; clock: Clock }, record: IncidentsLedger): Promise<PersistedIncidents> {
	// the fail-closed sweep: refuse the whole report BEFORE a single byte is written (the privacy law: a secret-shaped repro note refuses the whole report; the canary proves the ledger is never written with a secret).
	sweepArtifact(record, 'incidents-ledger-record');
	const recordLine = serializeArtifact(record);
	const recordPath = joinPath(deps.root, INCIDENTS_LEDGER_PATH);
	await deps.fs.mkdir(joinPath(deps.root, INCIDENTS_DIR));
	await deps.fs.writeFile(recordPath, recordLine);
	const banking = await bankRecord(deps, record, recordLine, INCIDENTS_LEDGER_PATH);
	return { recordPath, record, banking };
}

/** Renders the report outcome (the disclosure-first law). */
export function renderReport(result: ReportResult): string[] {
	const lines: string[] = [];
	const incident = result.record.incidents.find(inc => inc.incidentId === result.incidentId);
	const latest = incident?.revisions[incident.revisions.length - 1];
	lines.push(`  incident: ${result.incidentId} ${result.revised ? `(REVISION ${result.revision} APPENDED -- the unique-id law: re-reporting an id appends a NEW revision, never duplicates)` : `(REPORTED, revision 1)`}`);
	lines.push(`    class: ${latest?.class ?? '?'} | severity: ${latest?.severity ?? '?'} | affected surface: ${latest?.affectedSurface ?? '?'}`);
	lines.push(`    source binding: ${latest?.sourceBinding.kind ?? '?'} -- ${result.sourceBindingState}${result.sourceBindingState === 'disclosed-unresolvable' ? ' (TYPED DISCLOSURE: the binding cannot resolve; the incident is recorded, never dropped, never fabricated)' : result.sourceBindingState === 'manual-disclosed' ? ' (operator-entered, disclosed as such)' : ' (the referenced record resolves)'}`);
	lines.push(`    reported at: ${latest?.reportedAtIso ?? '?'} (the injected clock -- the only timestamp source)`);
	lines.push(`    evidence refs: ${latest?.evidenceRefs.length ?? 0} (paths under .flauz/ only)`);
	lines.push(`    registered incidents: ${result.incidentCount}`);
	return lines;
}

/** Sweeps a whole assembled incident record (the pre-write backstop; exposed for the suite + the canary). */
export function sweepIncidentsRecord(record: IncidentsLedger): void {
	sweepArtifact(record, 'incidents-ledger-record');
}

/** Re-exported for the contract suite + the source-fixture pin pattern. */
export { INCIDENTS_TASK_ID, isIncidentId, TELEMETRY_FAILURES_SCHEMA_ID, DURABILITY_HEARTBEAT_SCHEMA_ID, FRICTION_SCHEMA_ID } from './api.ts';
