/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/orchMediator.mjs` (the in-process orchestration
 * mediator). Hand-written per the zero-dependency discipline.
 */

import type { OrchFailure } from './orchProtocol.d.mts';

export interface OrchEventEnvelope {
	event: string;
	payload: Record<string, unknown>;
	ts: number;
}

export interface MediatorOptions {
	taskPort?: unknown | null;
	clock?: () => number;
}

export interface ShutdownResult {
	ok: boolean;
	state: 'active' | 'draining' | 'drained';
	replay: boolean;
}

export declare class OrchestrationMediator {
	constructor(root: string, options?: MediatorOptions);

	root: string;
	store: import('./orchStore.d.mts').OrchestrationStore;
	state: 'active' | 'draining' | 'drained';
	inFlight: number;
	lastSyncedSeq: number;

	subscribe(listener: (event: OrchEventEnvelope) => void): () => void;
	emit(event: string, payload: Record<string, unknown>, ts: number): void;
	syncEvents(): void;
	shutdown(): Promise<ShutdownResult>;
	dispatch(method: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}
