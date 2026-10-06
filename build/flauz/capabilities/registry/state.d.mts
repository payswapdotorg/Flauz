/* ------------------------------------------------------------------ */
/* Typed declarations for state.mjs (the pure machine).               */
/*                                                                     */
/* MIT License - see state.mjs for the full header box.               */
/* Copyright (c) Flauz contributors.                                   */
/* ------------------------------------------------------------------ */

export declare const REGISTRY_CONTRACT_VERSION: string;

export type RegistryState =
	| "discovered"
	| "imported"
	| "verified"
	| "approved"
	| "enabled"
	| "available"
	| "unavailable"
	| "revoked";

export declare const REGISTRY_STATES: readonly RegistryState[];

export type RegistryOp =
	| "discover"
	| "inspect"
	| "compare"
	| "verify"
	| "approve"
	| "register"
	| "enable"
	| "disable"
	| "update"
	| "remove"
	| "query";

export declare const REGISTRY_OPS: readonly RegistryOp[];

export type TransitionOp = "register" | "verify" | "approve" | "enable" | "disable" | "remove" | "project";

export declare const TRANSITION_OPS: readonly TransitionOp[];

export declare const INITIAL_STATES: Readonly<{ discover: "discovered"; update: "imported" }>;

export declare const TRANSITIONS: Readonly<Record<RegistryState, Readonly<Record<string, readonly string[]>>>>;

export type UnavailableCause = "platform-mismatch" | "dependency-missing" | "verification-failed" | "disabled-by-operator";

export declare const UNAVAILABLE_CAUSES: readonly UnavailableCause[];
export declare const RUNTIME_PROJECTED_CAUSES: readonly UnavailableCause[];

export type RefusalCode =
	| "E_UNKNOWN_STATE"
	| "E_UNKNOWN_OP"
	| "E_OP_NOT_A_TRANSITION"
	| "E_ILLEGAL_TRANSITION"
	| "E_REVOKED_TERMINAL"
	| "E_REGISTER_REQUIRES_DISCOVERED"
	| "E_REGISTER_DIGEST_MISMATCH"
	| "E_VERIFY_REQUIRES_IMPORTED"
	| "E_RECEIPT_MALFORMED"
	| "E_APPROVE_REQUIRES_VERIFIED"
	| "E_APPROVAL_MALFORMED"
	| "E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH"
	| "E_ENABLE_REQUIRES_APPROVED"
	| "E_DISABLE_REQUIRES_ENABLED"
	| "E_PROJECT_REQUIRES_ENABLED"
	| "E_PROJECTION_MALFORMED"
	| "E_RECOVERY_FORBIDDEN"
	| "E_IMPORT_MALFORMED_ENTRY"
	| "E_IMPORT_MISSING_LICENSE"
	| "E_IMPORT_MISSING_DIGEST"
	| "E_IMPORT_PERMISSION_OUT_OF_TABLE"
	| "E_ENTRY_ENTERS_UNVERIFIED"
	| "E_UPDATE_REQUIRES_IMPORTED"
	| "E_UPDATE_VERSION_DRIFT"
	| "E_ENTRY_UNKNOWN"
	| "E_NOT_LOADED"
	| "E_DISCOVERY_MALFORMED"
	| "E_QUERY_MALFORMED"
	| "E_COMPARE_REQUIRES_IMPORTED"
	| "E_ARGUMENT_MALFORMED"
	| "E_JOURNAL_TORN"
	| "E_JOURNAL_UNLAWFUL"
	| "E_SNAPSHOT_MISMATCH";

export interface Refusal {
	readonly code: RefusalCode;
	readonly law: string;
	readonly entryId: string | null;
	readonly state: string | null;
	readonly detail: string | null;
}

export type DisclosureCode =
	| "D_DISCOVER_DUPLICATE"
	| "D_VERIFICATION_PARTIAL"
	| "D_VERIFICATION_UNCHANGED"
	| "D_PROJECTION_UNCHANGED"
	| "D_UPDATE_IDENTICAL"
	| "D_SNAPSHOT_REBUILT";

export interface Disclosure {
	readonly code: DisclosureCode;
	readonly note: string;
	readonly detail: string | null;
}

export declare const REFUSALS: Readonly<Record<RefusalCode, Readonly<{ code: RefusalCode; law: string }>>>;
export declare const DISCLOSURES: Readonly<Record<DisclosureCode, Readonly<{ code: DisclosureCode; note: string }>>>;

export declare function refusalFor(code: RefusalCode, context?: { entryId?: string; state?: string; detail?: string }): Refusal;
export declare function disclosureFor(code: DisclosureCode, context?: { detail?: string }): Disclosure;

/* Vocabulary cross-pins (frozen copies of the ZC contracts).        */

export type ArtifactKind = "cli" | "skill-instructions" | "mcp-server" | "commands";
export declare const ARTIFACT_KINDS: readonly ArtifactKind[];

export type PermissionId = "read-files" | "execute-command" | "network-access" | "write-workspace";
export declare const PERMISSION_IDS: readonly PermissionId[];

export type RiskTier = "low" | "moderate" | "high";
export declare const RISK_TIERS: readonly RiskTier[];

export type Platform = "darwin-x64" | "darwin-arm64" | "linux-x64" | "linux-arm64" | "windows-x64";
export declare const PLATFORMS: readonly Platform[];

export type VerificationStatus = "unverified" | "verified" | "verified-partial" | "verification-failed";
export declare const VERIFICATION_STATUSES: readonly VerificationStatus[];

export type SourceKind =
	| "printing-press"
	| "printing-press-library"
	| "composio"
	| "mcp-catalog"
	| "skill-catalog"
	| "user-spec"
	| "api-spec"
	| "site-spec"
	| "community-project";

export declare const SOURCE_KINDS: readonly SourceKind[];

export type ImportChainStage = "discovered" | "fetched" | "normalized" | "registered";
export declare const IMPORT_CHAIN: readonly ImportChainStage[];

/* DRAFTED mapping (see state.mjs note): consumed only by            */
/* query(predicate.permissionTier). The id and tier lists are        */
/* cross-pinned; this mapping is not.                                 */

export declare const PERMISSION_TABLE: Readonly<Record<PermissionId, RiskTier>>;

export declare function showValue(value: unknown): string;
export declare function isRegistryState(value: unknown): boolean;
export declare function isArtifactKind(value: unknown): boolean;
export declare function isVerificationStatus(value: unknown): boolean;
export declare function isSourceKind(value: unknown): boolean;
export declare function isPermission(value: unknown): boolean;
export declare function isPlatform(value: unknown): boolean;
export declare function isRiskTier(value: unknown): boolean;
export declare function isUnavailableCause(value: unknown): boolean;
export declare function permissionTier(permission: string): RiskTier | null;
export declare function verificationStatusFor(receipt: unknown): VerificationStatus | null;
export declare function importViolation(importedEntry: unknown): Refusal | null;
export declare function canTransition(state: string, op: string): boolean;

export type TransitionResult =
	| { readonly ok: true; readonly nextState: RegistryState; readonly cause?: UnavailableCause | null; readonly disclosure?: Disclosure }
	| { readonly ok: false; readonly refusal: Refusal };

export declare function applyTransition(state: string, op: string, input?: unknown): TransitionResult;

export declare function canonicalJSON(value: unknown): string;
export declare function sha256Hex(text: string): string;