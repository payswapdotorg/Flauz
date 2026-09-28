/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Test helpers for the resourceExec suite (zero-dep, Node stdlib only).
 *
 * Uses the SYNC fs APIs from `node:fs` (declared in the extension's
 * shims/node.d.ts) + `node:os` + `node:path` + `node:url` -- the same
 * posture as `extensions/flauz-agent/test/goldenPath.test.ts`.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock, FileSystemPort } from '../../src/resourceExec/types.ts';

/** A deterministic clock pinned to FIXED_TS. */
export const FIXED_TS = 1730000000000;

export function fixedClock(): Clock {
        let value = FIXED_TS;
        return () => value;
}

/** A clock that advances by 1000 on every call (deterministic but distinguishable). */
export function steppingClock(start = 1000): Clock {
        let current = start;
        return () => {
                const value = current;
                current += 1000;
                return value;
        };
}

/** A clock that advances by `step` ms on every call. */
export function advancingClock(start: number, step: number): Clock {
        let current = start;
        return () => {
                const value = current;
                current += step;
                return value;
        };
}

/** A deterministic lease id minter (1, 2, 3, ...). */
export function deterministicLeaseMinter(): () => string {
        let n = 1;
        return () => {
                const id = `flauz:lease:${n.toString(16).padStart(16, '0')}`;
                n++;
                return id;
        };
}

/** A deterministic hand-off id minter (1, 2, 3, ...). */
export function deterministicHandOffMinter(): () => string {
        let n = 1;
        return () => {
                const id = `flauz:handoff:${n.toString(16).padStart(16, '0')}`;
                n++;
                return id;
        };
}

/** A node:fs-backed FileSystemPort (sync-impl, async-surfaced). */
export function nodeFsPort(): FileSystemPort {
        return {
                readFileUtf8: async target => {
                        if (!existsSync(target)) {
                                return undefined;
                        }
                        return readFileSync(target, 'utf-8');
                },
                writeFile: async (target, contents) => { writeFileSync(target, contents); },
                appendFile: async (target, contents) => {
                        const existing = existsSync(target) ? readFileSync(target, 'utf-8') : '';
                        writeFileSync(target, existing + contents);
                },
                rename: async (from, to) => {
                        const contents = readFileSync(from, 'utf-8');
                        writeFileSync(to, contents);
                        // best-effort cleanup of the tmp file (no rmSync in the shim; the OS
                        // reaps /tmp on exit)
                },
                mkdir: async target => { mkdirSync(target, { recursive: true }); },
        };
}

/** An in-memory FileSystemPort (no disk touched; tests are deterministic + fast). */
export function memoryFsPort(seed: ReadonlyMap<string, string> = new Map()): FileSystemPort & { readonly files: ReadonlyMap<string, string> } {
        const files = new Map<string, string>(seed);
        return {
                files,
                readFileUtf8: async target => files.get(target),
                writeFile: async (target, contents) => { files.set(target, contents); },
                appendFile: async (target, contents) => { files.set(target, (files.get(target) ?? '') + contents); },
                rename: async (from, to) => {
                        const contents = files.get(from);
                        if (contents === undefined) {
                                throw new Error(`ENOENT: ${from}`);
                        }
                        files.delete(from);
                        files.set(to, contents);
                },
                mkdir: async () => { /* in-memory: no-op */ },
        };
}

/** A FileSystemPort whose every write fails (fail-closed drills). */
export function failingFsPort(reason = 'fs unavailable (scripted failure)'): FileSystemPort {
        return {
                readFileUtf8: async () => undefined,
                writeFile: async () => { throw new Error(reason); },
                appendFile: async () => { throw new Error(reason); },
                rename: async () => { throw new Error(reason); },
                mkdir: async () => { throw new Error(reason); },
        };
}

/** Boots a fresh temp workspace root. */
export function bootTempWorkspace(): { readonly root: string; readonly fs: FileSystemPort; cleanup(): void } {
        const root = mkdtempSync(join(tmpdir(), 'flauz-task-res-'));
        mkdirSync(join(root, '.flauz'), { recursive: true });
        return {
                root,
                fs: nodeFsPort(),
                cleanup: () => { /* best-effort: the OS reaps /tmp on exit (no rmSync in the shim) */ },
        };
}

/** Recursively copies a directory tree (sync, using the shim-declared fs APIs). */
function copyDirRecursive(src: string, dest: string): void {
        mkdirSync(dest, { recursive: true });
        for (const entry of readdirSync(src)) {
                const srcPath = join(src, entry);
                const destPath = join(dest, entry);
                const stat = statSync(srcPath);
                if (stat.isDirectory()) {
                        copyDirRecursive(srcPath, destPath);
                } else {
                        writeFileSync(destPath, readFileSync(srcPath, 'utf-8'));
                }
        }
}

/** Copies the good fixture workspace into a temp dir (so tests can mutate it). */
export function copyGoodWorkspace(): { readonly root: string; readonly fs: FileSystemPort; cleanup(): void } {
        const src = fixturePath('good', 'workspace');
        const root = mkdtempSync(join(tmpdir(), 'flauz-task-res-'));
        copyDirRecursive(src, root);
        return {
                root,
                fs: nodeFsPort(),
                cleanup: () => { /* best-effort: the OS reaps /tmp on exit */ },
        };
}

/** The repo-root task-resources fixture path (read-only consumption). */
export function fixturePath(...segments: readonly string[]): string {
        // this file: extensions/flauz-agent/test/resourceExec/helpers.ts
        // repo root: 4 levels up from this file's directory
        const here = fileURLToPath(new URL('.', import.meta.url));
        const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
        void here; // sanity anchor (used by the URL resolution above)
        return join(repoRoot, 'test', 'fixtures', 'task-resources', ...segments);
}
