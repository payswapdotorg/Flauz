/* ------------------------------------------------------------------ */
/* Typed declarations for registry.mjs - THE STABLE INTERFACE.        */
/*                                                                     */
/* MIT License - see registry.mjs for the full header box.            */
/* Copyright (c) Flauz contributors.                                   */
/* ------------------------------------------------------------------ */

export * from "./state.mjs";

export interface RegistryScope {
	readonly workspaceId: string;
	readonly tenantId: string;
}

export interface FsPort {
	readFile(path: string, encoding: "utf8"): Promise<string> | string;
	writeFile(path: string, text: string): Promise<void> | void;
	appendFile(path: string, text: string): Promise<void> | void;
	mkdir(path: string, options: { recursive: boolean }): Promise<void> | void;
	readdir(path: string): Promise<string[]> | string[];
}

export interface CreateRegistryOptions {
	root: string;
	clock: () => number;
	fsPort: FsPort;
	scope: RegistryScope;
}

/* Inputs are deliberately loose: the runtime validates every value  */
/* and returns typed refusals; invalid values must stay              */
/* representable at the type level for the fail-closed tests.        */

export interface DiscoveredArtifactInput {
	sourceKind?: string;
	contentHash?: string;
	artifactKind?: string;
	version?: string;
	[key: string]: unknown;
}

export interface ImportedEntryInput {
	digest?: string;
	version?: string;
	license?: string;
	permissions?: readonly string[];
	endpoints?: readonly string[];
	platforms?: readonly string[];
	artifactKind?: string;
	provenance?: Record<string, unknown>;
	verificationStatus?: string;
	entryId?: string;
	[key: string]: unknown;
}

export interface VerificationReceiptInput {
	verificationStatus?: string;
	checks?: unknown[];
	[key: string]: unknown;
}

export interface ApprovalDecisionInput {
	approver?: string;
	acknowledgedPermissions?: readonly string[];
	[key: string]: unknown;
}

export interface AvailabilityFacts {
	platformMatch: boolean;
	dependenciesPresent: boolean;
}

export interface QueryPredicate {
	state?: string;
	artifactKind?: string;
	platform?: string;
	permissionTier?: string;
	[key: string]: unknown;
}

/* Views (post-validation, stored record shapes).                     */

export interface DiscoveredArtifactView {
	sourceKind: string;
	[key: string]: unknown;
}

export interface ImportedEntryView {
	digest: string;
	version: string;
	license: string;
	permissions: readonly string[];
	endpoints: readonly string[];
	platforms: readonly string[];
	artifactKind: string;
	provenance: Record<string, unknown>;
	verificationStatus?: string;
	[key: string]: unknown;
}

export interface VerificationReceiptView {
	verificationStatus: string;
	checks?: unknown[];
	[key: string]: unknown;
}

export interface ApprovalDecisionView {
	approver: string;
	acknowledgedPermissions: readonly string[];
	at: number;
	scope: RegistryScope;
}

export interface TransitionNoteView {
	seq: number;
	at: number;
	op: string;
	fromState: string | null;
	toState: string;
}

export interface RegistryEntryView {
	entryId: string;
	contentHash: string;
	state: string;
	createdAt: number;
	updatedAt: number;
	discovery: DiscoveredArtifactView | null;
	imported: ImportedEntryView | null;
	verification: { status: string; receipts: readonly VerificationReceiptView[] };
	approval: ApprovalDecisionView | null;
	unavailableCause: string | null;
	lineage: { predecessor: string | null };
	revocation: { reason: string | null; at: number } | null;
	transitions: readonly TransitionNoteView[];
	successor: string | null;
}

export interface RegistryEntrySummary {
	entryId: string;
	state: string;
	contentHash: string;
	version: string | null;
	artifactKind: string | null;
	platforms: readonly string[] | null;
}

export interface FieldDiff {
	readonly a: unknown;
	readonly b: unknown;
	readonly differs: boolean;
}

export interface SetDiff {
	readonly onlyInA: readonly string[];
	readonly onlyInB: readonly string[];
}

export interface CompareDiff {
	entryA: string;
	entryB: string;
	version: FieldDiff;
	digest: FieldDiff;
	license: FieldDiff;
	permissions: SetDiff;
	endpoints: SetDiff;
	platforms: SetDiff;
	differs: boolean;
}

export type RefusalOutcome = { readonly ok: false; readonly refusal: Refusal };

export type LoadResult = { readonly ok: true; readonly seq: number; readonly entries: number; readonly recovered: Disclosure | null } | RefusalOutcome;
export type DiscoverResult = { readonly ok: true; readonly entryId: string; readonly state: string; readonly disclosure: Disclosure | null } | RefusalOutcome;
export type RegisterResult = DiscoverResult;
export type VerifyResult = DiscoverResult;
export type ApproveResult = DiscoverResult;
export type EnableResult = DiscoverResult;
export type DisableResult = DiscoverResult;
export type RemoveResult = DiscoverResult;
export type ProjectResult = DiscoverResult;
export type UpdateResult = { readonly ok: true; readonly entryId: string; readonly predecessor: string | null; readonly state: string; readonly disclosure: Disclosure | null } | RefusalOutcome;
export type InspectResult = { readonly ok: true; readonly entry: RegistryEntryView } | RefusalOutcome;
export type CompareResult = { readonly ok: true; readonly diff: CompareDiff } | RefusalOutcome;
export type QueryResult = { readonly ok: true; readonly count: number; readonly entries: readonly RegistryEntrySummary[] } | RefusalOutcome;

export interface RegistryRuntime {
	load(): Promise<LoadResult>;
	discover(discovery: DiscoveredArtifactInput): Promise<DiscoverResult>;
	register(importedEntry: ImportedEntryInput): Promise<RegisterResult>;
	verify(entryId: string, receipt: VerificationReceiptInput): Promise<VerifyResult>;
	approve(entryId: string, decision: ApprovalDecisionInput): Promise<ApproveResult>;
	enable(entryId: string): Promise<EnableResult>;
	disable(entryId: string, reason?: string): Promise<DisableResult>;
	update(entryId: string, newEntry: ImportedEntryInput): Promise<UpdateResult>;
	remove(entryId: string, reason?: string): Promise<RemoveResult>;
	inspect(entryId: string): Promise<InspectResult>;
	compare(entryA: string, entryB: string): Promise<CompareResult>;
	query(predicate: QueryPredicate): Promise<QueryResult>;
	/* The runtime-availability port (CR-006 ruling 1): reserved for  */
	/* the runtime authority; journaled and machine-routed like every */
	/* mutating operation.                                            */
	projectAvailability(entryId: string, facts: AvailabilityFacts): Promise<ProjectResult>;
}

export declare function createRegistry(options: CreateRegistryOptions): RegistryRuntime;