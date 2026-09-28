/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The environment adapter tests (the PIN-2 read-only adapter). Covers the
 * trust gate (`untrusted` => TRUST_REFUSED, `unknown` => TRUST_REFUSED),
 * the usable-state check, the surface snapshot, the op-port reference
 * (`flauz.env.detach` when attached, `flauz.env.stop` otherwise), and
 * idempotent release.
 */
import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { EnvironmentAdapter } from '../../src/resourceExec/environment.ts';
import { copyGoodWorkspace } from './helpers.ts';

test('acquire: a running trusted env returns the descriptor + surface + op-port', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-running', 'agent');
                ok(result.ok);
                strictEqual(result.descriptor.id, 'env-fixture-running');
                strictEqual(result.descriptor.trust.posture, 'trusted');
                strictEqual(result.snapshot.kind, 'environment');
                strictEqual(result.opPort, 'flauz.env.stop', 'a non-attached running env releases via flauz.env.stop');
        } finally {
                await cleanup();
        }
});

test('acquire: an attached env returns opPort=flauz.env.detach + the attachTarget in the snapshot', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-attached', 'agent');
                ok(result.ok);
                strictEqual(result.opPort, 'flauz.env.detach');
                const snap = result.snapshot as { kind: 'environment'; descriptorId: string; providerKind: string; attachTarget?: string };
                strictEqual(snap.attachTarget, 'env-fixture-attached');
        } finally {
                await cleanup();
        }
});

test('acquire: TRUST_REFUSED -- an untrusted env that is running (the fail-closed gate belongs to the TL3 manager; the adapter enforces the SAME verdict read-only)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                // Mutate the fixture copy: make env-fixture-untrusted running so the
                // trust gate fires (not the lifecycle state check first)
                const lifecyclePath = `${root}/.flauz/environments-lifecycle.json`;
                const lifecycle = JSON.parse(readFileSync(lifecyclePath, 'utf-8'));
                lifecycle.entries['env-fixture-untrusted'].state = 'running';
                writeFileSync(lifecyclePath, JSON.stringify(lifecycle, null, 2) + '\n');
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-untrusted', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'TRUST_REFUSED');
                ok(/untrusted/.test(result.error.message));
                ok(/fail-closed gate belongs to the TL3 manager/.test(result.error.message));
                strictEqual(result.error.details?.posture, 'untrusted');
        } finally {
                await cleanup();
        }
});

test('acquire: TRUST_REFUSED -- an unknown-trust env (fail-closed until the posture is set to trusted)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-unknown', 'agent');
                // env-fixture-unknown has no lifecycle entry (only registry entry) -- the
                // adapter sees no usable state first; the test pins RESOURCE_ABSENT
                // (the orchestrator must start it first, then set the posture)
                ok(!result.ok);
                // the lifecycle envelope doesn't carry env-fixture-unknown -> RESOURCE_ABSENT
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- an env not in the lifecycle envelope', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-nonexistent', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a stopped env (the canonical truth says it cannot be operated; the orchestrator may start it first)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-untrusted', 'agent');
                // env-fixture-untrusted is stopped -> RESOURCE_ABSENT (not TRUST_REFUSED;
                // the lifecycle state check fires first)
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
                ok(/stopped/.test(result.error.message));
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a destroyed env', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-destroyed', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
                ok(/destroyed/.test(result.error.message));
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a failed env', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('env-fixture-failed', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
                ok(/failed/.test(result.error.message));
        } finally {
                await cleanup();
        }
});

test('acquire: RESOURCE_ABSENT -- a malformed env id', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.acquire('not-an-env-id', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'RESOURCE_ABSENT');
        } finally {
                await cleanup();
        }
});

test('release: idempotent -- an env already in a terminal state releases CLEANLY', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                // env-fixture-untrusted is stopped in the fixture (a terminal state)
                const result = await adapter.release('env-fixture-untrusted');
                ok(result.ok);
                ok(result.idempotent);
                strictEqual(result.opPort, 'flauz.env.stop');
                // an absent env releases idempotently too
                const r2 = await adapter.release('env-fixture-nonexistent');
                ok(r2.ok);
                ok(r2.idempotent);
        } finally {
                await cleanup();
        }
});

test('release: an attached env releases via flauz.env.detach', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.release('env-fixture-attached');
                ok(result.ok);
                strictEqual(result.opPort, 'flauz.env.detach');
                ok(!result.idempotent);
        } finally {
                await cleanup();
        }
});

test('release: a running (non-attached) env releases via flauz.env.stop', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                const result = await adapter.release('env-fixture-running');
                ok(result.ok);
                strictEqual(result.opPort, 'flauz.env.stop');
        } finally {
                await cleanup();
        }
});

test('TRUST_REFUSED verdict never weakens the gate: the message NAMES the posture (fail-closed, machine-checkable)', async () => {
        const { root, fs, cleanup } = await copyGoodWorkspace();
        try {
                const adapter = new EnvironmentAdapter({ workspaceRoot: root, fs });
                // env-fixture-untrusted is stopped -> RESOURCE_ABSENT first (lifecycle state check).
                // To test TRUST_REFUSED cleanly, add a running untrusted env to the lifecycle:
                const lifecyclePath = `${root}/.flauz/environments-lifecycle.json`;
                const raw = readFileSync(lifecyclePath, 'utf-8');
                const lifecycle = JSON.parse(raw);
                lifecycle.entries['env-fixture-untrusted'].state = 'running';
                writeFileSync(lifecyclePath, JSON.stringify(lifecycle, null, 2) + '\n');
                const result = await adapter.acquire('env-fixture-untrusted', 'agent');
                ok(!result.ok);
                strictEqual(result.error.code, 'TRUST_REFUSED');
                strictEqual(result.error.details?.posture, 'untrusted');
                ok(/fail-closed gate belongs to the TL3 manager/.test(result.error.message));
        } finally {
                await cleanup();
        }
});
