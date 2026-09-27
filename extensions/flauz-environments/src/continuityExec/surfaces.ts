/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — the surface table: the N-8 16-surface canon (src/continuity.ts)
 * materialized from ACTUAL `.flauz/` state, extended with the post-canon
 * state surfaces that landed after the model was written (the PIN-1 browser
 * journal, the PIN-2 lifecycle envelopes, the flauz-resources graph + ops
 * ledger, the workflow state).
 *
 * The table is CLOSED: every surface id is known, every manifest must cover
 * the full table (lost surfaces are typed entries, never dropped, never
 * fabricated), and a manifest naming a surface outside the table is
 * `BUNDLE_CORRUPT`.
 *
 * Secret-shape classification (the redaction law, see types.ts):
 *   - `captured`: the surface's content model admits captured or
 *     secret-shaped material (network/console evidence rows, arbitrary
 *     artifact bytes, journal tab URLs that can embed tokens). PRESENT
 *     surfaces of this class are exported `redacted` (presence + path hash,
 *     never the payload).
 *   - `never`: structurally-validated envelopes that reject secret literals
 *     at the schema level (the vault-only policy surfaces). These are
 *     `carried` when present, and deep-scanned at export as
 *     defense-in-depth (a hit fails the export closed).
 */
import { CONTINUITY_ARTIFACTS, type ContinuityArtifact } from '../continuity.ts';

/** How a surface's payload relates to the secret-redaction law. */
export type SurfaceSecretClass = 'never' | 'captured';

/** The materialization kind of a canon surface. */
export type SurfaceMaterialization = 'file' | 'directory' | null;

export interface ContinuitySurfaceSpec {
	/** Canon surface id (the 16 N-8 ids) or a post-canon state surface id. */
	readonly id: string;
	readonly label: string;
	/** Workspace-relative path (always under `.flauz/`), or null when the surface has no file materialization. */
	readonly path: string | null;
	readonly kind: SurfaceMaterialization;
	readonly secretClass: SurfaceSecretClass;
	/** The artifact name inside the bundle (file surfaces only; `surfaces/<id>[.<ext>]`). */
	readonly artifactName: string | null;
	/** The note recorded for non-materialized (lost) surfaces. */
	readonly lostNote: string;
}

/** The note recorded for present-but-redacted surfaces (the redaction law). */
export const REDACTED_NOTE = 'secret-shaped surface: presence + sha256 of the path recorded; the payload is never copied into a continuity bundle (the secret-redaction law)';

/** The note recorded for a materialized surface absent from disk at export. */
export const ABSENT_NOTE = 'no file materialized this surface at export time (typed lost, never fabricated)';

/**
 * The post-canon state surfaces — sibling envelopes + journals that landed
 * after the N-8 model was written (labels carry their owning contract).
 */
const POST_CANON_SURFACES: readonly { id: string; label: string; path: string; kind: 'file' | 'directory'; secretClass: SurfaceSecretClass; extension: string; why: string }[] = [
	{
		id: 'flauz-browser-session-journal',
		label: 'browser session journal (.flauz/browser-sessions.jsonl, PIN-1) — the forensic/continuity seam flauz-resources consumes read-only',
		path: '.flauz/browser-sessions.jsonl',
		kind: 'file',
		secretClass: 'captured',
		extension: 'jsonl',
		why: 'journal tab URLs can embed credential-shaped query material',
	},
	{
		id: 'flauz-environments-lifecycle',
		label: 'environment lifecycle state (.flauz/environments-lifecycle.json, PIN-2)',
		path: '.flauz/environments-lifecycle.json',
		kind: 'file',
		secretClass: 'never',
		extension: 'json',
		why: '',
	},
	{
		id: 'flauz-environments-ops',
		label: 'environment lifecycle ops ledger (.flauz/environments-ops.jsonl, PIN-2)',
		path: '.flauz/environments-ops.jsonl',
		kind: 'file',
		secretClass: 'never',
		extension: 'jsonl',
		why: '',
	},
	{
		id: 'flauz-resources-graph',
		label: 'resource graph envelope (.flauz/resources.json, flauz.resources/v0) — carried together with its ops ledger (the digest chain verifies against the graph envelope)',
		path: '.flauz/resources.json',
		kind: 'file',
		secretClass: 'never',
		extension: 'json',
		why: '',
	},
	{
		id: 'flauz-resources-ops',
		label: 'resource graph provenance ledger (.flauz/resources-ops.jsonl, flauz.resources-ops/v0)',
		path: '.flauz/resources-ops.jsonl',
		kind: 'file',
		secretClass: 'never',
		extension: 'jsonl',
		why: '',
	},
	{
		id: 'flauz-workflow-state',
		label: 'workflow state (.flauz/workflows/ — index.json + per-workflow envelopes, flauz-workflow)',
		path: '.flauz/workflows',
		kind: 'directory',
		secretClass: 'never',
		extension: '',
		why: '',
	},
];

/** Materialization of the 16 N-8 canon surfaces (id -> backing state). */
const CANON_MATERIALIZATION: Readonly<Record<string, { path: string | null; kind: SurfaceMaterialization; secretClass: SurfaceSecretClass; extension: string; lostNote: string }>> = {
	'flauz-tasks-envelope': { path: '.flauz/tasks.json', kind: 'file', secretClass: 'never', extension: 'json', lostNote: '' },
	'flauz-evidence-ledger': { path: '.flauz/evidence/ledger.jsonl', kind: 'file', secretClass: 'captured', extension: 'jsonl', lostNote: '' },
	'flauz-evidence-artifacts': { path: '.flauz/artifacts', kind: 'directory', secretClass: 'captured', extension: '', lostNote: '' },
	'flauz-environments-registry': { path: '.flauz/environments.json', kind: 'file', secretClass: 'never', extension: 'json', lostNote: '' },
	'scm-working-tree': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'rides the SCM substrate (git working tree + branches); not a .flauz/ surface — workspace-committed .flauz state travels with it' },
	'chat-sessions': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'natively re-hydrated by the sessions infra on the target env (N-8 re-open model)' },
	'chat-editing-checkpoints': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'natively re-hydrated by the chat editing/checkpoint infra (N-8 re-open model)' },
	'edit-sessions': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'natively re-hydrated by the edit-sessions infra (working-copy continuation, N-8)' },
	'agent-sessions': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'AHP server-side (sessionDatabase + taskEventReplay); not a workspace-local surface' },
	'flauz-task-state-machine': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 're-hydrates from the carried tasks envelope (no separate file)' },
	'persisted-approvals': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'AHP session-permission entries (SECURITY-MODEL 3.4); re-established by the agent host' },
	'terminal-scrollback': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'renderer-local (per-connection ptys) — lost by design (N-8)' },
	'browser-pane-state': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'live CDP state is renderer-local — lost by design (N-8); the PIN-1 journal carries its persistent trace as its own surface (flauz-browser-session-journal)' },
	'inflight-chat-streams': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'in-flight streaming turns do not survive the re-open — lost by design (N-8)' },
	'window-layout': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'machine-local workspace state — lost by design (N-8)' },
	'resolver-connection-state': { path: null, kind: null, secretClass: 'never', extension: '', lostNote: 'resolver sockets/tunnels are re-established by resolve() on the target env' },
};

function canonSurfaceSpec(artifact: ContinuityArtifact): ContinuitySurfaceSpec {
	const materialization = CANON_MATERIALIZATION[artifact.id]!;
	return {
		id: artifact.id,
		label: artifact.label,
		path: materialization.path,
		kind: materialization.kind,
		secretClass: materialization.secretClass,
		artifactName: materialization.path === null || materialization.extension === ''
			? (materialization.kind === 'directory' ? `surfaces/${artifact.id}` : null)
			: `surfaces/${artifact.id}.${materialization.extension}`,
		lostNote: materialization.lostNote,
	};
}

function postCanonSurfaceSpec(entry: (typeof POST_CANON_SURFACES)[number]): ContinuitySurfaceSpec {
	return {
		id: entry.id,
		label: entry.label,
		path: entry.path,
		kind: entry.kind,
		secretClass: entry.secretClass,
		artifactName: entry.kind === 'directory' ? `surfaces/${entry.id}` : `surfaces/${entry.id}.${entry.extension}`,
		lostNote: ABSENT_NOTE,
	};
}

/**
 * The full surface table: the 16 N-8 canon surfaces (in canon order),
 * followed by the post-canon state surfaces (table order, sorted by id).
 * CLOSED and deterministic.
 */
export const CONTINUITY_SURFACES: readonly ContinuitySurfaceSpec[] = [
	...CONTINUITY_ARTIFACTS.map(canonSurfaceSpec),
	...POST_CANON_SURFACES.map(postCanonSurfaceSpec),
];

const SURFACES_BY_ID: ReadonlyMap<string, ContinuitySurfaceSpec> = new Map(CONTINUITY_SURFACES.map(spec => [spec.id, spec]));

/** The surface spec for a canon/table id (undefined = outside the closed table). */
export function surfaceSpec(id: string): ContinuitySurfaceSpec | undefined {
	return SURFACES_BY_ID.get(id);
}

/** Every surface id of the closed table (canon order). */
export function surfaceIds(): readonly string[] {
	return CONTINUITY_SURFACES.map(spec => spec.id);
}

/**
 * The known credential-shape pattern family — VERBATIM the
 * flauz-resources `SECRET_SHAPED_PATTERNS` discipline (DL-32 sibling
 * duplication; pattern text only — no complete secret shape is ever spelled
 * out; keep the two families synchronized when either changes).
 * Used by the export-time defense-in-depth scan of `never`-class payloads.
 */
const SECRET_SHAPED_PATTERNS: readonly RegExp[] = [
	/\bghp_[A-Za-z0-9]{20,}\b/,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
	/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bASIA[0-9A-Z]{16}\b/,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\bBearer [A-Za-z0-9._-]{16,}\b/,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{16,}\b/,
];

/** `true` when a carried payload unexpectedly contains secret-shaped text (fails the export closed). */
export function looksSecretShaped(value: string): boolean {
	return SECRET_SHAPED_PATTERNS.some(pattern => pattern.test(value));
}
