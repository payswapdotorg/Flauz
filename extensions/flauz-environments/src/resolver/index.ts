/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 — the provider resolver module (single import site).
 *
 *   - authority  : the flauz-env+<kind>+<envId> grammar (pure, total)
 *   - types      : the typed failure taxonomy + resolution envelope
 *   - resolver   : FlauzEnvResolver — the pure resolution core (trust/policy
 *                  gate + per-kind probes through the rung-1 seams)
 *
 * The vscode boundary (registerRemoteAuthorityResolver + the ResolverResult
 * mapping) lives in src/extension.ts — the ONLY vscode-importing file.
 */
export {
	AGENT_HOST_BRIDGE_TOKEN_ENV_VAR,
	FLAUZ_ENV_AUTHORITY_PREFIX,
	RESOLVER_ERROR_CODES,
	ResolverFailure,
	type AgentHostBridgeHandshake,
	type FlauzResolvedData,
	type ResolvedBacking,
	type ResolvedTransportEndpoint,
	type ResolverErrorCode,
	type ResolverOutcome,
} from './types.ts';
export {
	AUTHORITY_MALFORM_CLASSES,
	authorityFailure,
	formatFlauzEnvAuthority,
	isFlauzEnvAuthority,
	parseFlauzEnvAuthority,
	type AuthorityMalformClass,
	type AuthorityParse,
} from './authority.ts';
export {
	FlauzEnvResolver,
	containerNameOf,
	formatFlauzEnvAuthority as formatAuthority,
	type FlauzEnvResolverOptions,
	type ResolveContext,
} from './resolver.ts';
