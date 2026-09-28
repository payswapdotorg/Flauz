/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for the WorkspaceSeam surface of `core/service.mjs`
 * (the G-side task/evidence seam). Hand-written per the zero-dependency
 * discipline (contracts.d.mts pattern); only the class surface consumers
 * import is declared - the service's wire main() is a Node entry point,
 * never an import target. Full member fidelity for the members declared.
 */

export interface WorkspaceCreateTaskResult {
	taskId: string;
}

export interface WorkspaceAppendEventResult {
	task: unknown;
}

export interface WorkspaceAppendEvidenceResult {
	/** The ledger row id as the seam's string projection (unpadded, e.g. 'E-3'). */
	evidenceId: string;
	seq: number;
}

export interface EvidenceRowInput {
	kind: string;
	uri: string;
	sha256: string;
	note?: string;
}

/** The task-event shape the seam validates at runtime; typed loosely so the store's TaskPort passes through. */
export type TaskEventInput = Record<string, unknown>;

export declare class WorkspaceSeam {
	constructor(root: string);
	root: string;
	tasks: unknown[];
	ledgerLines: string[];
	createTask(args: { title: string }): WorkspaceCreateTaskResult;
	appendEvent(args: { taskId: string; event: Record<string, unknown> }): WorkspaceAppendEventResult;
	appendEvidence(args: { taskId: string; row: EvidenceRowInput }): WorkspaceAppendEvidenceResult;
}
