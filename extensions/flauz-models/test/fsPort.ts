/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- a node:fs-backed FileSystemPort over a fresh temp
 * dir (zero-dependency test helper; the same port shape the extension host
 * wires for production).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FileSystemPort } from '../src/contract/ports.ts';

export interface TempFs {
	readonly root: string;
	readonly port: FileSystemPort;
	cleanup(): void;
}

/** Creates a temp workspace root with a real fs port (caller cleans up). */
export function makeTempFs(prefix = 'flauz-models-test-'): TempFs {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const port: FileSystemPort = {
		async readFileUtf8(filePath: string): Promise<string | undefined> {
			try {
				return fs.readFileSync(filePath, 'utf-8');
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw error;
			}
		},
		async writeFile(filePath: string, contents: string): Promise<void> {
			fs.writeFileSync(filePath, contents, 'utf-8');
		},
		async rename(fromPath: string, toPath: string): Promise<void> {
			fs.renameSync(fromPath, toPath);
		},
		async mkdir(dirPath: string): Promise<void> {
			try {
				fs.mkdirSync(dirPath);
			} catch (error) {
				if ((error as { code?: string }).code === 'EEXIST') {
					return;
				}
				throw error;
			}
		},
	};
	return {
		root,
		port,
		cleanup(): void {
			fs.rmSync(root, { recursive: true, force: true });
		},
	};
}
