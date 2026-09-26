/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * C-ENV canary runner (Flauz Wave 4, Lane J) -- the scripted, zero-dependency
 * half of the environment-registry canary (spec: build/flauz/canaries/C-ENV.md).
 * Runs the registry, providers, and continuity model against the committed
 * fixture matrix; NO live connections (runners/real-world execute the plans).
 *
 * Assertions (C-ENV.md "Expected"):
 *   A1 fixture matrix loads: good registry parses (5 environments, 4 kinds
 *      + the bridged ssh variant), envelope schema pinned
 *   A2 descriptor round-trip: canonical serialization is byte-stable and
 *      re-parses to the identical state
 *   A3 every bad fixture is rejected with a schema-prefixed error (the 45-file
 *      matrix violates each validation rule at least once)
 *   A4 connection-plan emission per provider kind: 5 golden pins match
 *      (semantic canonical-JSON equality)
 *   A5 switch-plan emission: local -> cloud re-open plan carries the N-8
 *      mechanism, PERF 5.5 budgets, and the full artifact classification
 *   A6 registry lifecycle in a fresh temp workspace: register -> activate ->
 *      persist -> RELOAD (activeId survives the re-open -- the continuity
 *      substrate)
 *   A7 continuity classification: 5 persists / 6 rehydrates / 5 lost
 *   A8 overhead accounting: budget verdicts at the PERF 5.5 boundaries
 *
 * Usage:
 *   node build/flauz/scripts/env-registry-canary.mjs [--root <repo>] [--help]
 *
 * Exit codes: 0 canary GREEN | 1 assertion failed | 2 usage error.
 */

import { mkdtemp, readFile, writeFile, rename, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_ROOT = resolve(new URL('../../../', import.meta.url).pathname);

function usage() {
	process.stdout.write(`env-registry-canary.mjs -- C-ENV environment-registry canary (Lane J)

Usage:
	node build/flauz/scripts/env-registry-canary.mjs [--root <repo>]

Options:
	--root <dir>  repository root (default: repo containing this script)
	--help        show this help

Assertions A1-A8 per build/flauz/canaries/C-ENV.md; zero dependencies
(node >= 20 stdlib + type-stripping for the .ts core imports).
`);
}

function parseArgs(argv) {
	const options = { root: DEFAULT_ROOT };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--root') {
			options.root = resolve(argv[i + 1]);
			i += 1;
		} else if (argv[i] === '--help' || argv[i] === '-h') {
			options.help = true;
		} else {
			throw new Error(`unknown argument: ${argv[i]}`);
		}
	}
	return options;
}

const report = [];
let exit = 0;
function pass(msg) { report.push(`PASS  ${msg}`); }
function fail(msg) { report.push(`FAIL  ${msg}`); exit = 1; }

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`usage error: ${err.message}\n`);
		usage();
		process.exit(2);
	}
	if (options.help) {
		usage();
		process.exit(0);
	}

	const extRoot = join(options.root, 'extensions', 'flauz-environments');
	const fixtureRoot = join(options.root, 'test', 'fixtures', 'environments');
	const { EnvironmentRegistry } = await import(join(extRoot, 'src', 'registry.ts'));
	const { validateDescriptor, buildConnectionPlan, PROVIDERS } = await import(join(extRoot, 'src', 'providers', 'index.ts'));
	const { canonicalJson } = await import(join(extRoot, 'src', 'api.ts'));
	const { classifyWorkspaceState, planSwitch, checkOverhead, CONTINUITY_ARTIFACTS, SWITCH_MARKS } = await import(join(extRoot, 'src', 'continuity.ts'));

	// ---- A1 fixture matrix loads ----
	try {
		const raw = await readFile(join(fixtureRoot, 'good', 'registry.json'), { encoding: 'utf-8' });
		const envelope = EnvironmentRegistry.parseEnvelope(raw);
		if (envelope.$schema !== 'flauz.environments/v0') { throw new Error('schema not pinned'); }
		if (envelope.environments.length !== 5) { throw new Error(`expected 5 environments, got ${envelope.environments.length}`); }
		const kinds = new Set(envelope.environments.map(d => d.kind));
		for (const kind of ['ssh-local', 'container', 'cloud-sandbox', 'workspace-remote']) {
			if (!kinds.has(kind)) { throw new Error(`kind ${kind} missing from fixture registry`); }
		}
		pass('A1 fixture matrix loads: 5 environments across 4 kinds + bridged ssh variant; $schema pinned');
	} catch (err) { fail(`A1 ${err.message}`); }

	// ---- A2 descriptor round-trip ----
	try {
		const raw = await readFile(join(fixtureRoot, 'good', 'registry.json'), { encoding: 'utf-8' });
		const once = EnvironmentRegistry.parseEnvelope(raw);
		const serializedOnce = JSON.stringify(once, null, 2) + '\n';
		const twice = EnvironmentRegistry.parseEnvelope(serializedOnce);
		if (canonicalJson(twice) !== canonicalJson(once)) { throw new Error('re-parse of serialized state diverges'); }
		const reSerialized = JSON.stringify(twice, null, 2) + '\n';
		if (reSerialized !== serializedOnce) { throw new Error('serialization is not byte-stable across round-trips'); }
		pass('A2 descriptor round-trip: canonical serialization byte-stable, re-parse identical');
	} catch (err) { fail(`A2 ${err.message}`); }

	// ---- A3 every bad fixture rejected ----
	try {
		const badDir = join(fixtureRoot, 'bad');
		const files = (await readdir(badDir)).filter(f => f.endsWith('.json')).sort();
		if (files.length < 40) { throw new Error(`bad matrix too small: ${files.length} files (need >= 40 for rule coverage)`); }
		let rejected = 0;
		const rejections = [];
		for (const file of files) {
			const raw = await readFile(join(badDir, file), { encoding: 'utf-8' });
			try {
				EnvironmentRegistry.parseEnvelope(raw);
				rejections.push(`NOT-REJECTED: ${file}`);
			} catch (err) {
				if (String(err.message).startsWith('flauz.environments/v0:')) { rejected += 1; }
				else { rejections.push(`WRONG-PREFIX ${file}: ${err.message}`); }
			}
		}
		if (rejections.length > 0) { throw new Error(rejections.join(' | ')); }
		pass(`A3 every bad fixture rejected with schema-prefixed errors (${rejected}/${files.length})`);
	} catch (err) { fail(`A3 ${err.message}`); }

	// ---- A4 connection-plan emission per provider kind ----
	try {
		const pairs = [
			['descriptor-ssh.json', 'expected-plan-ssh.json'],
			['descriptor-ssh-bridged.json', 'expected-plan-ssh-bridged.json'],
			['descriptor-container.json', 'expected-plan-container.json'],
			['descriptor-cloud-sandbox.json', 'expected-plan-cloud-sandbox.json'],
			['descriptor-workspace-remote.json', 'expected-plan-workspace-remote.json'],
		];
		for (const [descriptorFile, planFile] of pairs) {
			const descriptor = validateDescriptor(JSON.parse(await readFile(join(fixtureRoot, 'good', descriptorFile), 'utf-8')));
			const plan = buildConnectionPlan(descriptor);
			const expected = JSON.parse(await readFile(join(fixtureRoot, 'plans', planFile), 'utf-8'));
			if (canonicalJson(plan) !== canonicalJson(expected)) { throw new Error(`plan drift: ${planFile}`); }
		}
		if (PROVIDERS.length !== 4) { throw new Error(`expected 4 provider adapters, got ${PROVIDERS.length}`); }
		pass('A4 connection-plan emission per provider kind: 5 golden pins match (4 providers)');
	} catch (err) { fail(`A4 ${err.message}`); }

	// ---- A5 switch-plan emission ----
	try {
		const to = validateDescriptor(JSON.parse(await readFile(join(fixtureRoot, 'good', 'descriptor-cloud-sandbox.json'), 'utf-8')));
		const plan = planSwitch(null, to);
		if (plan.$schema !== 'flauz.switchPlan/v0') { throw new Error('switch-plan schema not pinned'); }
		if (plan.mechanism !== 're-open') { throw new Error('N-8 mechanism missing'); }
		if (plan.budgets.warmSwitchMs !== 1500 || plan.budgets.choreographyMs !== 500) { throw new Error('PERF 5.5 budgets missing'); }
		if (plan.phases.length !== 4) { throw new Error('expected persist/reopen/reconnect/rehydrate phases'); }
		if (plan.toAuthority !== 'e2b+env-e2b-main') { throw new Error(`unexpected authority ${plan.toAuthority}`); }
		pass('A5 switch-plan emission: re-open mechanism + PERF 5.5 budgets + 4 phases + authority');
	} catch (err) { fail(`A5 ${err.message}`); }

	// ---- A6 registry lifecycle in a fresh temp workspace ----
	const tmp = await mkdtemp(join(tmpdir(), 'cenv-canary-'));
	try {
		const fsPort = {
			readFileUtf8: async path => {
				try { return await readFile(path, { encoding: 'utf-8' }); } catch (err) {
					if (err && err.code === 'ENOENT') { return undefined; }
					throw err;
				}
			},
			writeFile: (path, contents) => writeFile(path, contents, { encoding: 'utf-8' }),
			rename: (from, to) => rename(from, to),
			mkdir: path => mkdir(path, { recursive: true }),
		};
		let clock = 1730000000000;
		const registry = new EnvironmentRegistry({ root: tmp, fs: fsPort, clock: () => clock });
		await registry.bootstrap();
		await registry.register({ id: 'env-canary', kind: 'ssh-local', label: 'Canary SSH', connection: { host: 'canary.internal', authMethod: 'key' }, trust: { posture: 'unknown', inheritsWorkspaceTrust: false }, capabilities: { agentHost: true, browser: false, exec: true, terminal: true } });
		clock += 1000;
		const plan = await registry.activate('env-canary');
		if (plan.authority !== 'ssh-remote+canary.internal') { throw new Error(`unexpected plan authority ${plan.authority}`); }
		const reloaded = new EnvironmentRegistry({ root: tmp, fs: fsPort, clock: () => clock });
		await reloaded.bootstrap();
		if (reloaded.activeId() !== 'env-canary') { throw new Error('activeId did not survive the reload (continuity substrate broken)'); }
		if (reloaded.list().length !== 1) { throw new Error('descriptor did not survive the reload'); }
		pass('A6 registry lifecycle: register -> activate -> persist -> reload keeps activeId (re-open substrate)');
	} catch (err) { fail(`A6 ${err.message}`); }
	finally { await rm(tmp, { recursive: true, force: true }); }

	// ---- A7 continuity classification ----
	try {
		const report7 = classifyWorkspaceState({ surfaces: CONTINUITY_ARTIFACTS.map(a => a.id) });
		if (report7.persists.length !== 5 || report7.rehydrates.length !== 6 || report7.lost.length !== 5) {
			throw new Error(`unexpected classification sizes ${report7.persists.length}/${report7.rehydrates.length}/${report7.lost.length}`);
		}
		pass('A7 continuity classification: 5 persists / 6 rehydrates / 5 lost (closed canon)');
	} catch (err) { fail(`A7 ${err.message}`); }

	// ---- A8 overhead accounting ----
	try {
		if (!checkOverhead('warm-switch', 1500).withinBudget) { throw new Error('budget boundary broken at 1500'); }
		if (checkOverhead('warm-switch', 1501).withinBudget) { throw new Error('budget boundary broken above 1500'); }
		if (!checkOverhead('persist', 200).withinBudget) { throw new Error('persist budget boundary broken'); }
		if (!checkOverhead('rehydrate', 300).withinBudget) { throw new Error('rehydrate budget boundary broken'); }
		if (checkOverhead('rehydrate', 301).withinBudget) { throw new Error('rehydrate budget above boundary accepted'); }
		const pair = checkOverhead('persist', 0).markPair;
		if (pair[0] !== SWITCH_MARKS.willPersist || pair[1] !== SWITCH_MARKS.didPersist) { throw new Error('mark pair mismatch'); }
		pass('A8 overhead accounting: PERF 5.5 budget verdicts + code/flauz/* mark pairs');
	} catch (err) { fail(`A8 ${err.message}`); }

	report.push('-- verdict ' + '-'.repeat(51));
	report.push(exit === 0 ? 'C-ENV FIXTURE CANARY GREEN' : 'C-ENV FIXTURE CANARY FAILURES PRESENT');
	process.stdout.write(report.join('\n') + '\n');
	process.exit(exit);
}

main().catch(err => {
	process.stderr.write(`canary crashed: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exit(1);
});
