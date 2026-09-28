/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 — the Flauz environment authority grammar (pure, vscode-free).
 *
 *   authority := "flauz-env" "+" <kind> "+" <envId>
 *
 * Pinned by test/resolverAuthority.test.ts (every malformed class). The
 * grammar is STABLE: changing it is a contract change (the workbench opens
 * windows on these authorities — vscode.newWindow { remoteAuthority }, the
 * blueprint pattern at extensions/vscode-test-resolver/src/extension.ts:396-403).
 *
 * The `@` nested-authority transit (vscode.proposed.resolvers.d.ts:17-26,
 * RemoteAuthorityResolverContext.execServer) is NOT part of the v0 grammar:
 * a `flauz-env+...+...@x` authority is malformed by this parser (rung 2 does
 * not chain resolvers; the a@b transit lands with a live multi-hop provider
 * if ever needed).
 */
import { ENVIRONMENT_KINDS, isEnvironmentId, type EnvironmentKind } from '../api.ts';
import { FLAUZ_ENV_AUTHORITY_PREFIX, ResolverFailure } from './types.ts';

/** The malformed classes (all map to the resolver code AUTHORITY_MALFORMED). */
export const AUTHORITY_MALFORM_CLASSES = [
	'EMPTY',
	'NOT_A_STRING',
	'WRONG_PREFIX',
	'PAYLOAD_MISSING',
	'SEGMENTS_EXTRA',
	'KIND_UNKNOWN',
	'ID_MISSING',
	'ID_INVALID',
	'NESTED_TRANSIT',
] as const;
export type AuthorityMalformClass = (typeof AUTHORITY_MALFORM_CLASSES)[number];

export type AuthorityParse =
	| { readonly ok: true; readonly kind: EnvironmentKind; readonly envId: string }
	| { readonly ok: false; readonly reason: AuthorityMalformClass; readonly message: string };

/**
 * Parses a Flauz environment authority. Pure, total (never throws): every
 * malformed input is a typed `{ ok: false, reason }`.
 */
export function parseFlauzEnvAuthority(authority: unknown): AuthorityParse {
	if (typeof authority !== 'string') {
		return { ok: false, reason: 'NOT_A_STRING', message: `authority must be a string (got ${JSON.stringify(authority === undefined ? 'undefined' : typeof authority)})` };
	}
	if (authority.length === 0) {
		return { ok: false, reason: 'EMPTY', message: 'authority must not be empty' };
	}
	const prefix = `${FLAUZ_ENV_AUTHORITY_PREFIX}+`;
	if (!authority.startsWith(prefix)) {
		return { ok: false, reason: 'WRONG_PREFIX', message: `authority must start with '${prefix}' (got ${JSON.stringify(authority.slice(0, 40))})` };
	}
	if (authority.includes('@')) {
		return { ok: false, reason: 'NESTED_TRANSIT', message: `nested '@' transit authorities are not part of the v0 grammar (got ${JSON.stringify(authority)})` };
	}
	const payload = authority.slice(prefix.length);
	if (payload.length === 0) {
		return { ok: false, reason: 'PAYLOAD_MISSING', message: `authority payload must be '<kind>+<envId>' after '${prefix}'` };
	}
	const segments = payload.split('+');
	if (segments.length !== 2) {
		return { ok: false, reason: segments.length < 2 ? 'PAYLOAD_MISSING' : 'SEGMENTS_EXTRA', message: `authority payload must be exactly '<kind>+<envId>' (got ${segments.length} segment(s))` };
	}
	const [kind, envId] = segments as [string, string];
	if (!(ENVIRONMENT_KINDS as readonly string[]).includes(kind)) {
		return { ok: false, reason: 'KIND_UNKNOWN', message: `authority kind must be one of ${ENVIRONMENT_KINDS.join('|')} (got ${JSON.stringify(kind)})` };
	}
	if (envId.length === 0) {
		return { ok: false, reason: 'ID_MISSING', message: 'authority environment id must not be empty' };
	}
	if (!isEnvironmentId(envId)) {
		return { ok: false, reason: 'ID_INVALID', message: `authority environment id must match env-[a-z0-9][a-z0-9-]{0,47} (got ${JSON.stringify(envId)})` };
	}
	return { ok: true, kind: kind as EnvironmentKind, envId };
}

/** Formats the authority for a registered environment (the inverse of parse). */
export function formatFlauzEnvAuthority(kind: EnvironmentKind, envId: string): string {
	return `${FLAUZ_ENV_AUTHORITY_PREFIX}+${kind}+${envId}`;
}

/** True when the authority string carries this resolver's prefix. */
export function isFlauzEnvAuthority(authority: string): boolean {
	return authority.startsWith(`${FLAUZ_ENV_AUTHORITY_PREFIX}+`);
}

/** Maps a parse failure to the typed ResolverFailure (code AUTHORITY_MALFORMED). */
export function authorityFailure(parse: { readonly reason: AuthorityMalformClass; readonly message: string }): ResolverFailure {
	return new ResolverFailure('AUTHORITY_MALFORMED', `authority malformed (${parse.reason}): ${parse.message}`);
}
