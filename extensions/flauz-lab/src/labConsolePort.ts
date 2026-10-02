/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-009 W1 console port - the injected seam between the console state
 * machine (src/consoleState.ts) and the deterministic lab core at
 * build/flauz/lab/. The runtime binding lives in src/labFlauzPort.ts (the
 * ONLY cross-lane runtime edge; esbuild resolves the lab core's .js
 * specifiers at bundle time). No test ever imports that file - Node type
 * stripping cannot resolve the lab core - so this module stays pure shape
 * declarations plus the port contract.
 */

import type { LabCandidateRow, LabComparisonRow, LabRunSummary, LabScenarioSummary } from './consoleState.ts';

/** The port the console extension consumes. */
export interface LabConsolePort {
	/** Stable port identifier, e.g. 'flauz-lab-console-fixture-v1'. */
	readonly id: string;
	/** Honesty label for the lane this port serves ('fixture' in W1). */
	readonly mode: 'fixture' | 'flauz';
	/** List the runnable task scenarios. */
	listScenarios(): Promise<LabScenarioSummary[]>;
	/**
	 * Run the evaluation ladder for one scenario. The port mints nothing
	 * itself: the caller supplies the runId and the injected nowIso (the
	 * determinism law - the port never reads a clock).
	 */
	runScenario(scenarioId: string, runId: string, nowIso: string): Promise<LabRunSummary | undefined>;
}

/** Re-exported view-model shapes (the port's vocabulary IS the console's). */
export type { LabCandidateRow, LabComparisonRow, LabRunSummary, LabScenarioSummary };
