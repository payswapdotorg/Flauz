/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/recovery.mjs` (the recovery pass).
 * Hand-written per the zero-dependency discipline (contracts.d.mts pattern).
 */

import type { OrchestrationStore } from './orchStore.d.mts';

export interface RecoveryGraphReport {
	graphId: string;
	clean: boolean;
	actions: string[];
	summary: Record<string, unknown>;
}

export interface RecoveryReport {
	scannedAt: number;
	clean: boolean;
	journalRows: number;
	tornTail: { line: string; reason: string } | null;
	actions: string[];
	graphs: RecoveryGraphReport[];
}

export declare function recoveryScan(store: OrchestrationStore, options?: { record?: boolean; now?: number; actor?: string; origin?: string }): Promise<RecoveryReport>;
