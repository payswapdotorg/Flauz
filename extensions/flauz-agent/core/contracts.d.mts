/**
 * Type declarations for `core/contracts.mjs` (the pure seam-contract module).
 * Extension source imports these types only (`import type`), so the .mjs is
 * never loaded from shipped extension code; tests import the runtime module
 * directly. Written by hand per the zero-dependency discipline.
 */

export declare const TASKS_SCHEMA: string;
export declare const SERVICE_NAME: string;
export declare const SERVICE_VERSION: string;

export declare const TASK_STATUSES: string[];
export declare const ACTIVE_STATUSES: string[];
export declare const TERMINAL_STATUSES: string[];
export declare const EVIDENCE_KINDS: string[];
export declare const EVENT_ACTORS: string[];

export interface TransitionRule {
	type: string;
	from: string | null;
	actors: string[];
	to: string;
}

export declare const TRANSITIONS: TransitionRule[];
export declare const TRANSITION_TYPES: string[];

export declare function transitionsForType(type: string): TransitionRule[];
export declare function allowedSourceStatuses(type: string): string[];
export declare function applyTransition(status: string, event: { actor: string; type: string }): { status: string; error?: string };

export declare function canonicalJson(value: unknown): string;

export interface LedgerRow {
	seq: number;
	ts: number;
	taskId: string;
	kind: string;
	uri: string;
	sha256: string;
	prev: string | null;
}

export declare function rowHash(row: LedgerRow): string;

export interface LedgerVerification {
	ok: boolean;
	rows: LedgerRow[];
	firstBadSeq?: number;
}

export declare function validateLedgerRows(lines: string[]): LedgerVerification;
