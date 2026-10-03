/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The boundary scan (A-PROD-005-W3): the one walk both the audit and the
 * enforcement verdict consume -- the typed boundary-law findings over the
 * workspace's reachable tree.
 *
 * THE WALK LAW: the scan starts at the workspace root and walks every
 * reachable path, EXCEPT the host/tooling trees (`.git`, `node_modules` --
 * the disclosed skip law: they are not product workspace state, and a
 * product record cannot lawfully live in them at this plane's
 * jurisdiction). The root's own `.flauz/` is walked (its shape checks
 * stay live: an `export-<stamp>/` inside `.flauz/` is the anti-recursion
 * violation; a record file inside `.flauz/` is lawful BY PATH and never a
 * stray-record finding). The root's `.flauz-exports/` is not entered (its
 * interior is the lawful export copy; export-internals verification is
 * flauz-backup's plane). A NON-ROOT `.flauz/` or `.flauz-exports/` tree is
 * the violation itself -- recorded, never descended.
 *
 * THE FINDINGS (each typed, each with the exact workspace-relative path):
 *   nested-flauz-tree           -- a `.flauz/` tree anywhere but the root
 *                                  (the cross-workspace state bleed);
 *   nested-exports-dir          -- a `.flauz-exports/` anywhere but the root;
 *   export-outside-exports-dir  -- an `export-<stamp>/` directory not
 *                                  directly under `<root>/.flauz-exports/`
 *                                  (including one inside `.flauz/`: the W2
 *                                  anti-recursion law);
 *   bundle-outside-boundary     -- a `support-bundle-<stamp>/` directory
 *                                  outside `<root>/.flauz/`;
 *   record-outside-boundary     -- a stamp-shaped record file
 *                                  (`<prefix><stamp>.json`) outside
 *                                  `.flauz/` and `.flauz-exports/` (the
 *                                  shapes derive from the LAW TABLE's
 *                                  record prefixes -- never a second list);
 *   symlink-into-boundary       -- a symlink OUTSIDE the boundary whose
 *                                  target resolves INSIDE `.flauz/` or
 *                                  `.flauz-exports/` (the record leaking
 *                                  out through a link).
 *
 * The scan NEVER repairs, NEVER quarantines: it reports shapes; the
 * operator adjudicates. Counts are shapes (never contents).
 */

import {
	type IsolationFsPort,
	FLAUZ_DIR,
	EXPORTS_DIR,
	joinPath,
} from './api.ts';
import {
	isLawDirName,
	isLawRecordName,
	SCAN_SKIP_NAMES,
} from './law.ts';

/** The typed boundary-law finding kinds. */
export type BoundaryFindingKind =
	| 'nested-flauz-tree'
	| 'nested-exports-dir'
	| 'export-outside-exports-dir'
	| 'bundle-outside-boundary'
	| 'record-outside-boundary'
	| 'symlink-into-boundary';

/** One typed boundary finding: the kind, the exact workspace-relative path, the shape detail. */
export interface BoundaryFinding {
	readonly kind: BoundaryFindingKind;
	/** The exact workspace-relative path of the offending artifact. */
	readonly path: string;
	/** Shape-only detail (human-readable; never contents). */
	readonly detail?: string;
	/** The symlink's RESOLVED workspace-relative target (the symlink-into-boundary finding only). */
	readonly target?: string;
}

/** The boundary-scan result (shapes + counts only, never contents). */
export interface BoundaryScan {
	/** The skip law's directory names (disclosed in every record that carries a scan). */
	readonly skipped: readonly string[];
	/** Directories whose entries the scan listed. */
	readonly walkedDirs: number;
	/** Non-directory entries the scan classified (files + non-listable leaves). */
	readonly walkedFiles: number;
	/** Every `.flauz/` tree found, workspace-relative, sorted (the lawful root tree is `.flauz`). */
	readonly flauzTrees: readonly string[];
	/** Every `.flauz-exports/` dir found, workspace-relative, sorted. */
	readonly exportsDirs: readonly string[];
	readonly findings: readonly BoundaryFinding[];
}

/** True when `path` is at or under `dir` (workspace-relative POSIX segments). */
export function isUnder(path: string, dir: string): boolean {
	return path === dir || path.startsWith(`${dir}/`);
}

/** Normalizes a POSIX-ish relative path (collapses `.` and `..` segments; the empty path is `.`). */
export function normalizeRelPath(path: string): string {
	const out: string[] = [];
	for (const segment of path.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment === '..') {
			out.pop();
			continue;
		}
		out.push(segment);
	}
	return out.length === 0 ? '.' : out.join('/');
}

/** Resolves a symlink target against its link's directory (relative targets) or the workspace frame (absolute targets). */
function resolveLinkTarget(root: string, linkRel: string, target: string): string {
	if (target.startsWith('/')) {
		// an absolute target is only into-boundary when it points inside the workspace root
		const prefix = root.endsWith('/') ? root : `${root}/`;
		if (target === root || target.startsWith(prefix)) {
			return normalizeRelPath(target.slice(prefix.length));
		}
		return '\0outside-workspace';
	}
	const linkDir = linkRel.includes('/') ? linkRel.slice(0, linkRel.lastIndexOf('/')) : '.';
	return normalizeRelPath(joinPath(linkDir, target));
}

/**
 * Runs the boundary scan over a workspace root. Pure deps-injected core
 * (the fs port is the node wiring in the host, a temp-dir port in tests);
 * deterministic (sorted entries, no clock, no randomness).
 */
export async function scanBoundary(deps: { root: string; fs: IsolationFsPort }): Promise<BoundaryScan> {
	const flauzTrees: string[] = [];
	const exportsDirs: string[] = [];
	const findings: BoundaryFinding[] = [];
	let walkedDirs = 0;
	let walkedFiles = 0;

	const underBoundary = (rel: string): boolean => isUnder(rel, FLAUZ_DIR) || isUnder(rel, EXPORTS_DIR);

	/**
	 * Walks one directory (workspace-relative), one finding pass per
	 * entry (sorted -- the walk is deterministic).
	 */
	const walk = async (dirRel: string): Promise<void> => {
		const entries = await deps.fs.readdir(joinPath(deps.root, dirRel === '.' ? '' : dirRel));
		if (entries === undefined) {
			return;
		}
		walkedDirs += 1;
		for (const entry of [...entries].sort()) {
			if (SCAN_SKIP_NAMES.includes(entry)) {
				continue; // the disclosed skip law (.git + node_modules)
			}
			const rel = dirRel === '.' ? entry : joinPath(dirRel, entry);

			// --- the symlink probe (the link-outside-leak class) ---
			const target = await deps.fs.readlink(joinPath(deps.root, rel));
			if (target !== undefined) {
				const resolved = resolveLinkTarget(deps.root, rel, target);
				if (!underBoundary(rel) && (isUnder(resolved, FLAUZ_DIR) || isUnder(resolved, EXPORTS_DIR))) {
					findings.push({ kind: 'symlink-into-boundary', path: rel, detail: `target ${resolved}`, target: resolved });
				}
				continue; // a symlink is never descended (the walk stays loop-free)
			}

			// --- the durable-state trees ---
			if (entry === FLAUZ_DIR) {
				flauzTrees.push(rel);
				if (rel !== FLAUZ_DIR) {
					findings.push({ kind: 'nested-flauz-tree', path: rel });
					continue; // the nested tree IS the violation; never descended
				}
				// the root's lawful .flauz: walked (shape checks stay live; the
				// stray-record law excludes in-boundary paths by construction)
				await walk(rel);
				continue;
			}
			if (entry === EXPORTS_DIR) {
				exportsDirs.push(rel);
				if (rel !== EXPORTS_DIR) {
					findings.push({ kind: 'nested-exports-dir', path: rel });
				}
				// the exports dir's interior is the lawful export copy (flauz-backup's
				// verification plane owns export-internals); never descended here
				continue;
			}

			// --- the stamp-shaped directory laws (the shapes derive from the law table) ---
			if (isLawDirName(entry)) {
				if (entry.startsWith('export-')) {
					// exports live ONLY directly under <root>/.flauz-exports (never inside .flauz: anti-recursion)
					const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
					if (parentRel !== EXPORTS_DIR) {
						findings.push({ kind: 'export-outside-exports-dir', path: rel, detail: `the lawful home is ${EXPORTS_DIR}/ (directly under the workspace root; never inside ${FLAUZ_DIR}/)` });
					}
				} else if (entry.startsWith('support-bundle-')) {
					// the diagnostics bundles live ONLY directly under <root>/.flauz
					const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
					if (parentRel !== FLAUZ_DIR) {
						findings.push({ kind: 'bundle-outside-boundary', path: rel, detail: `the lawful home is directly under ${FLAUZ_DIR}/` });
					}
				}
				continue; // the shape itself is the signal; never descended
			}

			// --- the stamp-shaped record files (the stray-record law) ---
			if (isLawRecordName(entry) && !underBoundary(rel)) {
				findings.push({ kind: 'record-outside-boundary', path: rel, detail: `a stamp-shaped durable record outside ${FLAUZ_DIR}/ and ${EXPORTS_DIR}/` });
				continue;
			}

			// --- descend directories (anything listable); files are counted ---
			const listable = await deps.fs.readdir(joinPath(deps.root, rel));
			if (listable !== undefined) {
				await walk(rel);
			} else {
				walkedFiles += 1;
			}
		}
	};

	await walk('.');

	findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
	return {
		skipped: [...SCAN_SKIP_NAMES],
		walkedDirs,
		walkedFiles,
		flauzTrees: [...new Set(flauzTrees)].sort(),
		exportsDirs: [...new Set(exportsDirs)].sort(),
		findings,
	};
}
