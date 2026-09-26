/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Artifact persistence for the Flauz Agent Bridge (F side).
 *
 * Tool outputs are written under `<workspaceRoot>/.flauz/artifacts/<taskId>/`
 * and hashed; the ledger row then references the workspace-relative URI plus
 * the sha256 (seam contract section H `appendEvidence`). The artifacts directory
 * choice is a documented v0 contract interpretation (REPORT
 * section CONTRACT-DEVIATIONS).
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ArtifactRecord {
	/** Workspace-relative POSIX-style URI of the artifact. */
	uri: string;
	/** sha256 (hex) of the artifact bytes. */
	sha256: string;
}

export function sha256Of(text: string): string {
	return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** Write one command-output artifact and return its ledger (uri, sha256). */
export async function writeCommandOutput(
	workspaceRoot: string,
	taskId: string,
	seq: number,
	output: string,
): Promise<ArtifactRecord> {
	const relative = `.flauz/artifacts/${taskId}/command-output-${seq}.txt`;
	const absolute = join(workspaceRoot, '.flauz', 'artifacts', taskId, `command-output-${seq}.txt`);
	await mkdir(join(workspaceRoot, '.flauz', 'artifacts', taskId), { recursive: true });
	await writeFile(absolute, output);
	return { uri: relative, sha256: sha256Of(output) };
}
