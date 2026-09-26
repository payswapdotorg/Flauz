/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for the F-side seam client against the REAL core service
 * (core/service.mjs spawned as a child process over stdio).
 */

import { test } from 'node:test';
import { ok, strictEqual, match } from 'node:assert';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SeamClient } from '../src/seamClient.ts';

function makeWorkspace(): string {
        return mkdtempSync(join(tmpdir(), 'flauz-seam-'));
}

test('handshake completes (hello -> ready) and ping round-trips', async () => {
        const workspace = makeWorkspace();
        const client = await SeamClient.start({ workspaceRoot: workspace, connectTimeoutMs: 15_000 });
        try {
                const pong = await client.request<{ pong: boolean; ts: number }>('ping');
                ok(pong.pong, 'ping must pong');
                ok(typeof pong.ts === 'number');
        } finally {
                await client.dispose();
        }
});

test('createTask / appendEvent / getTask round-trip through the real service', async () => {
        const workspace = makeWorkspace();
        const client = await SeamClient.start({ workspaceRoot: workspace });
        try {
                const { taskId } = await client.createTask('wire a chat participant');
                strictEqual(taskId, 'T-001');

                const plan = await client.appendEvent(taskId, { actor: 'agent', type: 'submit-plan', payload: { steps: ['one', 'two'] } });
                strictEqual(plan.task.status, 'awaiting-approval');

                const approved = await client.appendEvent(taskId, { actor: 'human', type: 'approve', payload: {} });
                strictEqual(approved.task.status, 'execute');

                const fetched = await client.getTask(taskId);
                strictEqual(fetched.task.status, 'execute');
                strictEqual(fetched.task.events.length, 3, 'created + submit-plan + approve');
                strictEqual(fetched.task.events[2].type, 'approve');
                strictEqual(fetched.task.events[2].actor, 'human');

                // Task envelope is persisted with the documented formatting.
                const raw = readFileSync(join(workspace, '.flauz', 'tasks.json'), 'utf-8');
                match(raw, /^\{\n {2}"\$schema": "flauz\.tasks\/v0",/);
                match(raw, /\}\n$/, 'envelope ends with a trailing newline');
                const envelope = JSON.parse(raw);
                strictEqual(envelope.$schema, 'flauz.tasks/v0');
                strictEqual(envelope.tasks[0].id, 'T-001');
                strictEqual(envelope.tasks[0].events[0].type, 'created');

                // Illegal transitions surface as rejections that list allowed sources.
                let caught: unknown;
                try {
                        await client.appendEvent(taskId, { actor: 'human', type: 'approve', payload: {} });
                } catch (error) {
                        caught = error;
                }
                ok(caught instanceof Error);
                match((caught as Error).message, /approve is not allowed from status execute/);

                const listed = await client.listTasks();
                strictEqual(listed.tasks.length, 1);
        } finally {
                await client.dispose();
        }
});

test('dispose shuts the service down cleanly (exit, no dangling requests)', async () => {
        const workspace = makeWorkspace();
        const globalStorage = join(workspace, 'global-storage');
        mkdirSync(globalStorage, { recursive: true });
        const client = await SeamClient.start({ workspaceRoot: workspace, globalStoragePath: globalStorage });
        await client.createTask('dispose check');

        // The event-relay mirror exists in the extension globalStorage (v0 relay).
        const relay = readFileSync(join(globalStorage, 'relay.jsonl'), 'utf-8');
        match(relay, /"topic":"task-created"/);

        await client.dispose();
        // Requests after dispose reject rather than hang.
        let rejected = false;
        try {
                await client.listTasks();
        } catch {
                rejected = true;
        }
        ok(rejected, 'requests after dispose must reject');
});
