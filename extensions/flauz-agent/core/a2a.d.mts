/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Type declarations for `core/a2a.mjs` (the Wave 4 Lane K A2A bus, G side).
 * Hand-written per the zero-dependency discipline (the contracts.d.mts
 * pattern): the .mjs is never loaded from shipped extension code; tests and
 * the fixture generator import the runtime module directly and get these
 * types via the sibling-declaration resolution.
 */

export declare const A2A_SCHEMA: string;
export declare const A2A_DIR: string;
export declare const A2A_MESSAGES_PATH: string;
export declare const A2A_CURSORS_PATH: string;
export declare const A2A_CURSORS_SCHEMA: string;

export declare const MESSAGE_KINDS: string[];
export declare const REPORT_OUTCOMES: string[];
export declare const CLAIM_ACTIONS: string[];

export declare function isAgentId(value: unknown): boolean;
export declare function isMessageId(value: unknown): boolean;

/** Journal message id of a seq (M-NNNNNN, the E-NNNNNN discipline). */
export declare function messageIdOf(seq: number): string;

export interface A2aMessage {
	$schema: string;
	seq: number;
	id: string;
	kind: string;
	from: string;
	to: string;
	ts: number;
	inReplyTo: string | null;
	payload: Record<string, unknown>;
}

/** Caller-side post input (seq/id/$schema are bus-minted; ts/inReplyTo defaulted). */
export interface A2aMessageInput {
	kind: string;
	from: string;
	to: string;
	ts?: number;
	inReplyTo?: string | null;
	payload: Record<string, unknown>;
}

export declare function validateMessage(value: unknown): { ok: true; message: A2aMessage } | { ok: false; error: string };

/** Canonical compact JSON of a message (the exact journal line bytes). */
export declare function messageLine(message: A2aMessage): string;

export declare class A2ABus {
	constructor(root: string);
	post(args: { message: A2aMessageInput }): { id: string; seq: number; message: A2aMessage };
	collect(args: { agentId: string; consume?: boolean }): { messages: A2aMessage[] };
	list(): { agents: Array<{ agentId: string; pending: number }> };
}
