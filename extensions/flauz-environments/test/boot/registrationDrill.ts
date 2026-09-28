/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 rung 2 — the BOOT REGISTRATION DRILL (CI-only; the
 * --extensionTestsPath runner the flauz-environments workflow compiles with
 * esbuild to $RUNNER_TEMP and drives inside a real booted workbench).
 *
 * What it proves (the fixture-rung resolution drill of the TL3-H1 CI job):
 *
 *   R1 the bundled extension ACTIVATES command-driven (executing
 *      `flauz.env.resolver` IS the activation event) and the resolver
 *      registration path EXECUTED — `registered: true` is only reachable
 *      when activate() found the proposed `registerRemoteAuthorityResolver`
 *      surface live (the grant; the A3-class tripwire greps the boot log
 *      for the DOES-NOT-EXIST proposal warning as the complement).
 *   R2 the typed resolution path runs through the live command surface
 *      (AUTHORITY_MALFORMED / ENVIRONMENT_ABSENT — the pure core reached
 *      from the workbench, deterministically, zero daemons).
 *   R3 the trust gate holds at the command level: a registered-but-unproven
 *      environment (no PIN-2 entry) and an untrusted one are BOTH
 *      TRUST_REFUSED — the both-directions law on the live surface.
 *
 * NO live remote sessions are attempted here (the skip-gated liveRemote
 * rung owns those); no secrets are read; the drill cleans up after itself.
 */
import * as vscode from 'vscode';
import * as assert from 'node:assert';

interface ResolverSurface {
	readonly prefix: string;
	readonly grammar: string;
	readonly registered: boolean;
	readonly reason?: string;
	readonly kinds: readonly string[];
}

interface ResolveOutcome {
	readonly ok: boolean;
	readonly failure?: { readonly code: string; readonly message: string };
}

async function resolve(arg: unknown): Promise<ResolveOutcome> {
	return await vscode.commands.executeCommand('flauz.env.resolve', arg) as ResolveOutcome;
}

export async function run(): Promise<void> {
	// R1 — the registration surface (command-driven activation; the grant live).
	const surface = await vscode.commands.executeCommand('flauz.env.resolver') as ResolverSurface;
	assert.ok(surface !== undefined && surface !== null, 'flauz.env.resolver returned nothing');
	assert.strictEqual(surface.registered, true, `the flauz-env authority resolver must be registered (got: ${JSON.stringify(surface)})`);
	assert.strictEqual(surface.prefix, 'flauz-env');
	assert.strictEqual(surface.grammar, 'flauz-env+<kind>+<envId>');
	assert.strictEqual(surface.kinds.length, 4, `the resolver serves all four kinds (got: ${JSON.stringify(surface.kinds)})`);

	// R2 — the typed resolution path through the live command surface.
	const malformed = await resolve({ authority: 'ssh-remote+not-ours' });
	assert.strictEqual(malformed.ok, false);
	assert.strictEqual(malformed.failure?.code, 'AUTHORITY_MALFORMED');

	const absent = await resolve({ authority: 'flauz-env+ssh-local+env-not-registered-anywhere' });
	assert.strictEqual(absent.ok, false);
	assert.strictEqual(absent.failure?.code, 'ENVIRONMENT_ABSENT');

	// R3 — the trust gate at the command level (both directions).
	const registrations: [string, { posture: string }][] = [
		['env-drill-local', { posture: 'trusted' }],
		['env-drill-untrusted', { posture: 'untrusted' }],
	];
	for (const [id, trust] of registrations) {
		await vscode.commands.executeCommand('flauz.env.register', {
			id,
			kind: 'workspace-remote',
			label: `TL3-H1 drill ${id}`,
			connection: { authorityPrefix: 'flauz-drill' },
			trust: { posture: trust.posture, inheritsWorkspaceTrust: false },
			capabilities: { browser: true, exec: true, agentHost: true, terminal: true },
		});
	}
	try {
		// a trusted environment with NO PIN-2 lifecycle entry (never created):
		// the unproven backing refuses — TRUST_REFUSED.
		const unproven = await resolve('env-drill-local');
		assert.strictEqual(unproven.ok, false, 'an environment without a PIN-2 entry must never resolve');
		assert.strictEqual(unproven.failure?.code, 'TRUST_REFUSED');

		// an untrusted environment NEVER resolves (even before any backing exists).
		const untrusted = await resolve('env-drill-untrusted');
		assert.strictEqual(untrusted.ok, false, 'an untrusted environment must never resolve');
		assert.strictEqual(untrusted.failure?.code, 'TRUST_REFUSED');
	} finally {
		for (const [id] of registrations) {
			await vscode.commands.executeCommand('flauz.env.unregister', id);
		}
	}
}
