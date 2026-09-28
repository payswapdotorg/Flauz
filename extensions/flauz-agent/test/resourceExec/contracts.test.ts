/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The lease state machine tests (the TL3-003 state-machine pattern, applied
 * to the task boundary). Covers every legal transition + every illegal
 * transition + idempotent release + expiry via an injected fake clock +
 * rollback completeness (3 active leases => 3 typed release records).
 */
import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, throws } from 'node:assert';
import {
        applyLeaseOp,
        allowedSourceStates,
        buildLease,
        activateLease,
        releaseLease,
        rollbackLease,
        failLease,
        expireLease,
        isExpired,
        rollbackAllActive,
        surfaceMismatch,
        validateProvenance,
        validateLease,
        mintLeaseId,
        mintHandOffId,
        LEASE_STATES,
        LEASE_HELD_STATES,
        LEASE_TERMINAL_STATES,
        TaskResourceError,
        type TaskResourceLease,
        type TaskResourceProvenance,
} from '../../src/resourceExec/contracts.ts';

const actor: TaskResourceProvenance = { actor: 'agent', actorId: 'flauz-agent', taskId: 'T-001' };

/** `true` when `err` is a TaskResourceError with the given code + matching message. */
function tre(code: string, pattern?: RegExp): (err: unknown) => boolean {
        return (err: unknown): boolean => {
                if (!(err instanceof TaskResourceError)) {
                        return false;
                }
                if (err.code !== code) {
                        return false;
                }
                if (pattern !== undefined && !pattern.test(err.message)) {
                        return false;
                }
                return true;
        };
}

function baseLease(overrides: Partial<TaskResourceLease> = {}): TaskResourceLease {
        return {
                schemaVersion: 0,
                schema: 'flauz.task-resources/v0',
                leaseId: 'flauz:lease:0123456789abcdef',
                taskId: 'T-001',
                resourceKind: 'browser-session',
                resourceId: 'flauz:browser:0123456789abcdef',
                actor,
                state: 'acquiring',
                acquiredAt: 1730000000000,
                ...overrides,
        };
}

test('validateProvenance: a missing actor fails loudly with PROVENANCE_INVALID (the PIN-1 journal law, applied to the task boundary)', () => {
        throws(
                () => validateProvenance({ taskId: 'T-001' }),
                tre('PROVENANCE_INVALID', /actor is MISSING/),
        );
});

test('validateProvenance: an unknown actor fails loudly with PROVENANCE_INVALID', () => {
        throws(
                () => validateProvenance({ actor: 'ai', taskId: 'T-001' }),
                tre('PROVENANCE_INVALID', /agent\|human\|tool/),
        );
});

test('validateProvenance: a malformed taskId fails with TASK_ID_INVALID (not buried under PROVENANCE_INVALID)', () => {
        throws(
                () => validateProvenance({ actor: 'agent', taskId: 'T-1' }),
                tre('TASK_ID_INVALID', /T-<3\+ digits>/),
        );
});

test('validateProvenance: a valid provenance round-trips', () => {
        const p = validateProvenance({ actor: 'human', actorId: 'user-42', taskId: 'T-002', cause: 'planSwitch' });
        strictEqual(p.actor, 'human');
        strictEqual(p.actorId, 'user-42');
        strictEqual(p.taskId, 'T-002');
        strictEqual(p.cause, 'planSwitch');
});

test('the state machine: acquire goes acquiring -> active', () => {
        const lease = baseLease({ state: 'acquiring' });
        const active = activateLease(lease, 1730000001000);
        strictEqual(active.state, 'active');
        strictEqual(active.leaseId, lease.leaseId);
});

test('the state machine: release goes active -> released', () => {
        const lease = baseLease({ state: 'active' });
        const released = releaseLease(lease, 1730000002000);
        strictEqual(released.state, 'released');
        ok(released.release !== undefined);
        strictEqual(released.release!.outcome, 'released');
        strictEqual(released.release!.releasedAt, 1730000002000);
});

test('the state machine: rollback goes active -> rolled-back', () => {
        const lease = baseLease({ state: 'active' });
        const rb = rollbackLease(lease, 1730000003000, 'task failed');
        strictEqual(rb.state, 'rolled-back');
        strictEqual(rb.release!.outcome, 'rolled-back');
        strictEqual(rb.release!.reason, 'task failed');
});

test('the state machine: expire goes active -> expired (the injected clock is the source of truth, never the wall)', () => {
        const lease = baseLease({ state: 'active', expiresAt: 1730000005000 });
        ok(!isExpired(lease, 1730000004000), 'before expiresAt the lease is not expired');
        ok(isExpired(lease, 1730000005000), 'at expiresAt the lease is expired');
        const expired = expireLease(lease, 1730000006000);
        strictEqual(expired.state, 'expired');
        strictEqual(expired.release!.outcome, 'expired');
});

test('the state machine: fail goes acquiring|active -> failed', () => {
        const lease1 = baseLease({ state: 'acquiring' });
        const f1 = failLease(lease1, 1730000007000, 'acquire failed');
        strictEqual(f1.state, 'failed');
        strictEqual(f1.release!.outcome, 'failed');

        const lease2 = baseLease({ state: 'active' });
        const f2 = failLease(lease2, 1730000008000, 'runtime failed');
        strictEqual(f2.state, 'failed');
});

test('the state machine: illegal transitions throw OP_INVALID with the allowed source states listed (the TL3-003 pattern)', () => {
        // acquire from active is illegal
        throws(
                () => applyLeaseOp('active', 'acquire'),
                tre('OP_INVALID', /legal source states for 'acquire'/),
        );
        // release from acquiring is illegal
        throws(
                () => applyLeaseOp('acquiring', 'release'),
                tre('OP_INVALID', /legal source states for 'release'/),
        );
        // rollback from released is illegal
        throws(
                () => applyLeaseOp('released', 'rollback'),
                tre('OP_INVALID'),
        );
});

test('the state machine: allowedSourceStates lists every state from which `op` is legal', () => {
        const acquireSources = allowedSourceStates('acquire');
        deepStrictEqual([...acquireSources].sort(), ['acquiring']);
        const releaseSources = allowedSourceStates('release');
        deepStrictEqual([...releaseSources].sort(), ['active', 'expired', 'failed', 'released', 'rolled-back']);
        const rollbackSources = allowedSourceStates('rollback');
        deepStrictEqual([...rollbackSources].sort(), ['active']);
        const failSources = allowedSourceStates('fail');
        deepStrictEqual([...failSources].sort(), ['acquiring', 'active']);
        const expireSources = allowedSourceStates('expire');
        deepStrictEqual([...expireSources].sort(), ['active']);
});

test('idempotent release: a lease already in a terminal state stays released (the obligation is discharged; the record states what the journal showed, never fakes a teardown)', () => {
        const released = baseLease({ state: 'released', release: { outcome: 'released', releasedAt: 1730000002000 } });
        const r2 = releaseLease(released, 1730000010000);
        strictEqual(r2.state, 'released');
        strictEqual(r2.release!.releasedAt, 1730000002000, 'the original release record is preserved (history is never rewritten)');
});

test('idempotent release: a lease in any terminal state stays in that state (the original terminal verdict is preserved; history is never rewritten)', () => {
        for (const state of LEASE_TERMINAL_STATES) {
                const lease = baseLease({ state, release: { outcome: 'released', releasedAt: 1730000002000 } });
                const r = releaseLease(lease, 1730000010000);
                strictEqual(r.state, state, `state ${state} is preserved (idempotent -- never overwrite history)`);
                strictEqual(r.release!.releasedAt, 1730000002000, `state ${state}: the original release record is preserved`);
        }
});

test('idempotent release: a terminal-state lease without a release record accepts release (the state is preserved but the release record is added)', () => {
        const lease = baseLease({ state: 'expired' });
        const r = releaseLease(lease, 1730000010000);
        strictEqual(r.state, 'expired', 'the state is preserved (idempotent -- never fake a teardown)');
        ok(r.release !== undefined, 'the release record is added');
        strictEqual(r.release!.outcome, 'released');
});

test('expireLease: a lease with no expiresAt cannot be expired (OP_INVALID)', () => {
        const lease = baseLease({ state: 'active' });
        throws(
                () => expireLease(lease, 1730000006000),
                tre('OP_INVALID', /no expiresAt set/),
        );
});

test('expireLease: cannot expire a lease before its expiresAt (the sweeper must respect the clock)', () => {
        const lease = baseLease({ state: 'active', expiresAt: 1730000005000 });
        throws(
                () => expireLease(lease, 1730000004000),
                tre('OP_INVALID', /still in the future/),
        );
});

test('rollback completeness: a task with 3 active leases that fails produces 3 typed release records -- none silently dropped', () => {
        const now = 1730000003000;
        const leases: TaskResourceLease[] = [
                baseLease({ leaseId: 'flauz:lease:0000000000000001', resourceId: 'flauz:browser:0123456789abcdef', state: 'active' }),
                baseLease({ leaseId: 'flauz:lease:0000000000000002', resourceId: 'flauz:environment:env-fixture-attached', state: 'active', resourceKind: 'environment' }),
                baseLease({ leaseId: 'flauz:lease:0000000000000003', resourceId: 'flauz:file:4d5e6f708192a3b4', state: 'active', resourceKind: 'resource-ref' }),
                // a 4th lease already in a terminal state -- not rolled back (it's discharged)
                baseLease({ leaseId: 'flauz:lease:0000000000000004', resourceId: 'flauz:browser:fedcba9876543210', state: 'released', release: { outcome: 'released', releasedAt: 1730000002000 } }),
        ];
        const result = rollbackAllActive(leases, now, 'task failed');
        strictEqual(result.released.length, 3, 'all 3 active leases are rolled back');
        strictEqual(result.failed.length, 0, 'no leases failed to roll back');
        for (const lease of result.released) {
                strictEqual(lease.state, 'rolled-back');
                strictEqual(lease.release!.outcome, 'rolled-back');
                strictEqual(lease.release!.reason, 'task failed');
        }
});

test('rollback completeness: a non-held lease is not rolled back and not failed (it is discharged)', () => {
        const lease = baseLease({ state: 'released', release: { outcome: 'released', releasedAt: 1730000002000 } });
        const result = rollbackAllActive([lease], 1730000003000);
        strictEqual(result.released.length, 0);
        strictEqual(result.failed.length, 0, 'a non-held lease is not rolled back and not failed (it is discharged)');
});

test('surface mismatch: browser surface mismatch (partition changed) is detectable', () => {
        const snap = { kind: 'browser' as const, partition: 'persist:flauz-0123456789abcdef-worker-1', tabIds: ['flauz:tab:0000000000000001'] };
        const cur = { kind: 'browser' as const, partition: 'persist:flauz-CHANGED-worker-1', tabIds: ['flauz:tab:0000000000000001'] };
        ok(surfaceMismatch(snap, cur), 'a partition change is a surface mismatch');
});

test('surface mismatch: browser surface mismatch (tabIds set changed) is detectable', () => {
        const snap = { kind: 'browser' as const, partition: 'p', tabIds: ['flauz:tab:0000000000000001'] };
        const cur = { kind: 'browser' as const, partition: 'p', tabIds: ['flauz:tab:0000000000000001', 'flauz:tab:0000000000000002'] };
        ok(surfaceMismatch(snap, cur));
});

test('surface mismatch: identical surfaces do not mismatch', () => {
        const snap = { kind: 'browser' as const, partition: 'p', tabIds: ['flauz:tab:0000000000000001'] };
        const cur = { kind: 'browser' as const, partition: 'p', tabIds: ['flauz:tab:0000000000000001'] };
        ok(!surfaceMismatch(snap, cur));
});

test('surface mismatch: environment surface mismatch (descriptorId changed) is detectable', () => {
        const snap = { kind: 'environment' as const, descriptorId: 'env-a', providerKind: 'ssh-local' };
        const cur = { kind: 'environment' as const, descriptorId: 'env-b', providerKind: 'ssh-local' };
        ok(surfaceMismatch(snap, cur));
});

test('surface mismatch: resource-ref surface mismatch (refKind changed) is detectable', () => {
        const snap = { kind: 'resource-ref' as const, refKind: 'file' };
        const cur = { kind: 'resource-ref' as const, refKind: 'directory' };
        ok(surfaceMismatch(snap, cur));
});

test('buildLease: validates the leaseId grammar (LEASE_ID_INVALID)', () => {
        throws(
                () => buildLease({
                        leaseId: 'flauz:lease:short',
                        taskId: 'T-001',
                        resourceKind: 'browser-session',
                        resourceId: 'flauz:browser:0123456789abcdef',
                        actor,
                        now: 1730000000000,
                }),
                tre('LEASE_ID_INVALID'),
        );
});

test('buildLease: validates the resourceKind (OP_INVALID)', () => {
        throws(
                () => buildLease({
                        leaseId: 'flauz:lease:0123456789abcdef',
                        taskId: 'T-001',
                        resourceKind: 'unknown' as never,
                        resourceId: 'flauz:browser:0123456789abcdef',
                        actor,
                        now: 1730000000000,
                }),
                tre('OP_INVALID'),
        );
});

test('mintLeaseId: returns a well-formed lease id', () => {
        const id = mintLeaseId();
        ok(/^flauz:lease:[0-9a-f]{16}$/.test(id), `mintLeaseId returned ${id}`);
});

test('mintHandOffId: returns a well-formed hand-off id', () => {
        const id = mintHandOffId();
        ok(/^flauz:handoff:[0-9a-f]{16}$/.test(id), `mintHandOffId returned ${id}`);
});

test('validateLease: a well-formed lease round-trips', () => {
        const lease = baseLease({ state: 'active' });
        const validated = validateLease(JSON.parse(JSON.stringify(lease)));
        strictEqual(validated.leaseId, lease.leaseId);
        strictEqual(validated.state, 'active');
});

test('validateLease: a lease missing schema is OP_INVALID', () => {
        const lease = baseLease();
        const bad = JSON.parse(JSON.stringify(lease));
        delete bad.schema;
        throws(
                () => validateLease(bad),
                tre('OP_INVALID'),
        );
});

test('LEASE_STATES: covers all 6 states', () => {
        deepStrictEqual([...LEASE_STATES], ['acquiring', 'active', 'released', 'expired', 'rolled-back', 'failed']);
});

test('LEASE_HELD_STATES: acquiring + active', () => {
        deepStrictEqual([...LEASE_HELD_STATES], ['acquiring', 'active']);
});

test('LEASE_TERMINAL_STATES: released + expired + rolled-back + failed', () => {
        deepStrictEqual([...LEASE_TERMINAL_STATES], ['released', 'expired', 'rolled-back', 'failed']);
});
