/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-002 Free Inference Fabric contracts: the typed capability
 * matrix - which models each catalog provider offers, with which
 * bounded capabilities (context window, output cap, modalities)
 * (contract module, the labContracts discipline; binds the sibling
 * providerCatalog module and, through it, the INF-001 semantics
 * family).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the INF-001
 * semantics family laws are INHERITED and binding here):
 * - THE NO-DANGLING-REF LAW (binding): every matrix descriptor's
 *   providerEntryId RESOLVES in the bound catalog record. A matrix
 *   referencing a provider the catalog does not carry is a typed
 *   rejection - never a silent dangling ref.
 * - (MODEL, PROVIDER) UNIQUENESS: a model offering is unique per
 *   provider entry; a duplicate (providerEntryId, modelId) pair is
 *   a typed rejection, never a silent overwrite. The same modelId
 *   under different providers, and different models under the same
 *   provider, are both honest and admitted.
 * - Bounded capabilities are honest: token bounds are positive
 *   integers, the context window is INCLUSIVE on both ends, and
 *   maxOutputTokens must live inside the window (an output cap the
 *   window cannot contain is unrepresentable).
 * - THE INF-006 SCOPE BOUNDARY (binding): this module delivers
 *   descriptors, guards, the inclusive boundary predicate and
 *   serialization ONLY. The requirement -> provider/model MATCHING
 *   ENGINE is INF-006's item; nothing here ranks, scores, selects
 *   or substitutes.
 * - Determinism: no Math.random, no Date.now, no new Date(, no
 *   process.env in this module. All ids are injected plain strings;
 *   all token counts are injected plain positive integers.
 * - Vocabulary only: this module declares types, constants, pure
 *   guards and pure predicates. It is not a runtime, not an
 *   engine, not a scheduler, not a router, not a key pool, not a
 *   second authority.
 * - Every persisted record carries contractVersion (the catalog
 *   family's INFERENCE_CATALOG_VERSION, imported from the sibling
 *   providerCatalog module - the family's single version
 *   authority, pinned by the test suite).
 */
import { INFERENCE_CATALOG_VERSION, admitCatalogRecord } from './providerCatalog.js';

/**
 * The catalog contract-set version, carried by this module too (the
 * family's single declaration lives in the sibling providerCatalog
 * module; the suite pins both carried copies equal).
 */
export { INFERENCE_CATALOG_VERSION };

/**
 * The closed model-modality vocabulary. The minimal honest set for
 * an inference fabric that serves a coding assistant:
 * - text-in:      the model accepts text input;
 * - text-out:     the model produces text output;
 * - image-in:     the model accepts image input (vision);
 * - tool-call:    the model can emit structured tool calls.
 * Generation modalities (image-out, audio, video) are out of scope
 * for this contract version; widening the set is a contract change
 * requiring a version bump.
 */
export const MODEL_MODALITIES = ['text-in', 'text-out', 'image-in', 'tool-call'] as const;
export type ModelModality = (typeof MODEL_MODALITIES)[number];

/**
 * The inclusive context window: the per-request token budget bounds
 * [minTokens, maxTokens], INCLUSIVE on both ends. Token bounds are
 * positive integers (fractional tokens are malformed).
 */
export interface ContextWindow {
	readonly minTokens: number;
	readonly maxTokens: number;
}

/**
 * The typed capability descriptor: one model's bounded offering on
 * one catalog provider entry. Carries the catalog contract-set
 * version stamp. The providerEntryId must resolve in the bound
 * catalog record at matrix admission (the no-dangling-ref law).
 */
export interface CapabilityDescriptor {
	readonly modelId: string;
	readonly providerEntryId: string;
	readonly contextWindow: ContextWindow;
	readonly maxOutputTokens: number;
	readonly modalities: readonly ModelModality[];
	readonly contractVersion: string;
}

/**
 * The typed capability matrix record: the named collection of
 * descriptors. (providerEntryId, modelId) pairs are unique inside a
 * record (admission-enforced). Carries the catalog contract-set
 * version stamp.
 */
export interface CapabilityMatrixRecord {
	readonly matrixId: string;
	readonly descriptors: readonly CapabilityDescriptor[];
	readonly contractVersion: string;
}

/** Closed list of capability-descriptor admission rejection reasons. */
export const CAPABILITY_DESCRIPTOR_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-model-id',
	'invalid-provider-entry-id',
	'invalid-context-window',
	'inverted-context-window',
	'invalid-max-output',
	'max-output-outside-window',
	'invalid-modalities',
	'unknown-modality',
] as const;
export type CapabilityDescriptorRejectionReason = (typeof CAPABILITY_DESCRIPTOR_REJECTION_REASONS)[number];

export interface CapabilityDescriptorAdmitted {
	readonly admitted: true;
	readonly descriptor: CapabilityDescriptor;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface CapabilityDescriptorRejected {
	readonly admitted: false;
	readonly reason: CapabilityDescriptorRejectionReason;
	readonly detail: string;
}

export type CapabilityDescriptorAdmission = CapabilityDescriptorAdmitted | CapabilityDescriptorRejected;

/** Closed list of capability-matrix admission rejection reasons. */
export const CAPABILITY_MATRIX_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-matrix-id',
	'invalid-descriptors',
	'invalid-descriptor',
	'duplicate-model-provider-pair',
	'invalid-catalog',
	'unknown-provider-entry',
] as const;
export type CapabilityMatrixRejectionReason = (typeof CAPABILITY_MATRIX_REJECTION_REASONS)[number];

export interface CapabilityMatrixAdmitted {
	readonly admitted: true;
	readonly matrix: CapabilityMatrixRecord;
}

export interface CapabilityMatrixRejected {
	readonly admitted: false;
	readonly reason: CapabilityMatrixRejectionReason;
	readonly detail: string;
}

export type CapabilityMatrixAdmission = CapabilityMatrixAdmitted | CapabilityMatrixRejected;

/**
 * Pure fail-closed guard: admits only descriptors with non-empty
 * string ids, positive-integer token bounds, a well-ordered
 * inclusive context window, an output cap inside the window, and
 * modalities drawn from the closed MODEL_MODALITIES vocabulary. The
 * admitted record carries the modalities canonicalized into the
 * closed-vocabulary order with duplicates collapsed (a set, never
 * an ordered bag - insertion order is not semantic). Deterministic:
 * same candidate, same verdict, same reason and detail. Never
 * mutates its input.
 */
export function admitCapabilityDescriptor(candidate: unknown): CapabilityDescriptorAdmission {
	if (!isRecord(candidate)) {
		return rejectDescriptor('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_CATALOG_VERSION) {
		return rejectDescriptor(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_CATALOG_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const modelId = record.modelId;
	if (!isNonEmptyString(modelId)) {
		return rejectDescriptor('invalid-model-id', 'modelId must be a non-empty string');
	}
	const providerEntryId = record.providerEntryId;
	if (!isNonEmptyString(providerEntryId)) {
		return rejectDescriptor('invalid-provider-entry-id', 'providerEntryId must be a non-empty string');
	}
	const contextWindow = record.contextWindow;
	if (!isRecord(contextWindow)) {
		return rejectDescriptor(
			'invalid-context-window',
			'contextWindow must be a non-null object with minTokens and maxTokens',
		);
	}
	const minTokens = (contextWindow as Record<string, unknown>).minTokens;
	const maxTokens = (contextWindow as Record<string, unknown>).maxTokens;
	if (!isPositiveInteger(minTokens) || !isPositiveInteger(maxTokens)) {
		return rejectDescriptor(
			'invalid-context-window',
			'contextWindow bounds must be positive integers (zero/negative token bounds are rejected)',
		);
	}
	if (minTokens > maxTokens) {
		return rejectDescriptor(
			'inverted-context-window',
			`contextWindow.minTokens (${minTokens}) must not exceed contextWindow.maxTokens (${maxTokens})`,
		);
	}
	const maxOutputTokens = record.maxOutputTokens;
	if (!isPositiveInteger(maxOutputTokens)) {
		return rejectDescriptor('invalid-max-output', 'maxOutputTokens must be a positive integer');
	}
	if (maxOutputTokens < minTokens || maxOutputTokens > maxTokens) {
		return rejectDescriptor(
			'max-output-outside-window',
			`maxOutputTokens (${maxOutputTokens}) must live inside the inclusive context window [${minTokens}, ${maxTokens}]`,
		);
	}
	const modalities = record.modalities;
	if (!Array.isArray(modalities)) {
		return rejectDescriptor(
			'invalid-modalities',
			'modalities must be an array drawn from the closed MODEL_MODALITIES vocabulary',
		);
	}
	for (const modality of modalities) {
		if (!isModelModality(modality)) {
			return rejectDescriptor(
				'unknown-modality',
				`modalities must be drawn from the closed vocabulary text-in/text-out/image-in/tool-call, got '${String(modality)}'`,
			);
		}
	}
	// Canonical set form: the closed vocabulary's own order, duplicates
	// collapsed. Insertion order is not semantic and never reaches the
	// canonical bytes.
	const canonicalModalities = MODEL_MODALITIES.filter((modality) =>
		(modalities as readonly unknown[]).includes(modality),
	);
	return {
		admitted: true,
		descriptor: {
			modelId,
			providerEntryId,
			contextWindow: { minTokens, maxTokens },
			maxOutputTokens,
			modalities: canonicalModalities,
			contractVersion,
		},
	};
}

/**
 * Pure fail-closed guard over the capability matrix bound to a
 * catalog record: every descriptor must pass
 * admitCapabilityDescriptor (its own rejection surfaces verbatim in
 * the detail), (providerEntryId, modelId) pairs must be unique (a
 * duplicate is a typed rejection, never a silent overwrite), the
 * bound catalog must itself satisfy admitCatalogRecord, and every
 * descriptor's providerEntryId must RESOLVE in that catalog (THE
 * NO-DANGLING-REF LAW - a matrix referencing a provider the catalog
 * does not carry is a typed rejection). Deterministic; never
 * mutates its inputs.
 */
export function admitCapabilityMatrix(candidate: unknown, catalog: unknown): CapabilityMatrixAdmission {
	const shapeAdmission = admitMatrixShape(candidate);
	if (!shapeAdmission.admitted) {
		return shapeAdmission;
	}
	const catalogAdmission = admitCatalogRecord(catalog);
	if (!catalogAdmission.admitted) {
		return rejectMatrix(
			'invalid-catalog',
			`the bound catalog record must satisfy admitCatalogRecord: '${catalogAdmission.reason}': ${catalogAdmission.detail}`,
		);
	}
	const knownEntryIds = new Set(catalogAdmission.record.entries.map((entry) => entry.entryId));
	const descriptors = shapeAdmission.matrix.descriptors;
	for (let index = 0; index < descriptors.length; index++) {
		const providerEntryId = descriptors[index].providerEntryId;
		if (!knownEntryIds.has(providerEntryId)) {
			// THE NO-DANGLING-REF LAW: the matrix never carries a
			// provider the bound catalog does not.
			return rejectMatrix(
				'unknown-provider-entry',
				`descriptors[${index}] references providerEntryId '${providerEntryId}' which the bound catalog does not carry - a dangling provider reference is a typed rejection, never a silent dangling ref`,
			);
		}
	}
	return shapeAdmission;
}

/**
 * Pure inclusive-boundary verdict: does the descriptor's context
 * window contain the token count? Boundaries are INCLUSIVE on both
 * ends: minTokens <= tokens <= maxTokens (both window endpoints
 * admit; both off-by-one directions reject). Fail-closed: a
 * non-finite probe or a malformed window contains nothing (false),
 * mirroring the semantics family's quotaWindowContains.
 */
export function contextWindowContains(descriptor: CapabilityDescriptor, tokens: number): boolean {
	if (!isFiniteNumber(tokens) || !isRecord(descriptor)) {
		return false;
	}
	const window = (descriptor as Record<string, unknown>).contextWindow;
	if (!isRecord(window)) {
		return false;
	}
	const minTokens = (window as Record<string, unknown>).minTokens;
	const maxTokens = (window as Record<string, unknown>).maxTokens;
	if (!isFiniteNumber(minTokens) || !isFiniteNumber(maxTokens)) {
		return false;
	}
	return (minTokens as number) <= tokens && tokens <= (maxTokens as number);
}

/**
 * Canonical serialization of a capability matrix record: fixed key
 * order, deterministic bytes regardless of the input record's key
 * insertion order (each descriptor and its context window are
 * canonicalized with fixed key orders; modalities emit in the
 * closed-vocabulary order). Refuses non-admitted records at the
 * shape level (fail closed - descriptors and pair uniqueness are
 * enforced; the catalog binding is an admission-time law carried by
 * admitCapabilityMatrix, which this serializer does not repeat
 * because it takes no catalog).
 */
export function serializeCapabilityMatrixRecord(record: unknown): string {
	const shapeAdmission = admitMatrixShape(record);
	if (!shapeAdmission.admitted) {
		throw new Error(
			`serializeCapabilityMatrixRecord: record rejected '${shapeAdmission.reason}': ${shapeAdmission.detail}`,
		);
	}
	return JSON.stringify({
		matrixId: shapeAdmission.matrix.matrixId,
		descriptors: shapeAdmission.matrix.descriptors.map((descriptor) => ({
			modelId: descriptor.modelId,
			providerEntryId: descriptor.providerEntryId,
			contextWindow: {
				minTokens: descriptor.contextWindow.minTokens,
				maxTokens: descriptor.contextWindow.maxTokens,
			},
			maxOutputTokens: descriptor.maxOutputTokens,
			modalities: [...descriptor.modalities],
			contractVersion: descriptor.contractVersion,
		})),
		contractVersion: shapeAdmission.matrix.contractVersion,
	});
}

/**
 * Pure shape predicate: an admitted, well-formed capability
 * descriptor.
 */
export function isCapabilityDescriptor(value: unknown): value is CapabilityDescriptor {
	return admitCapabilityDescriptor(value).admitted;
}

/**
 * Pure shape predicate: a well-formed capability matrix record
 * (shape + descriptor admission + pair uniqueness - the intrinsic
 * properties). The no-dangling-ref catalog binding is an
 * admission-time law: use admitCapabilityMatrix with the bound
 * catalog to check it.
 */
export function isCapabilityMatrixRecord(value: unknown): value is CapabilityMatrixRecord {
	return admitMatrixShape(value).admitted;
}

/**
 * The intrinsic matrix admission (shared by admitCapabilityMatrix,
 * isCapabilityMatrixRecord and serialization): record shape, every
 * descriptor admitted, (providerEntryId, modelId) uniqueness. The
 * catalog binding is deliberately NOT checked here - it is the
 * caller-bound law of admitCapabilityMatrix.
 */
function admitMatrixShape(candidate: unknown): CapabilityMatrixAdmission {
	if (!isRecord(candidate)) {
		return rejectMatrix('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_CATALOG_VERSION) {
		return rejectMatrix(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_CATALOG_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const matrixId = record.matrixId;
	if (!isNonEmptyString(matrixId)) {
		return rejectMatrix('invalid-matrix-id', 'matrixId must be a non-empty string');
	}
	const descriptors = record.descriptors;
	if (!Array.isArray(descriptors)) {
		return rejectMatrix('invalid-descriptors', 'descriptors must be an array of capability descriptors');
	}
	const admittedDescriptors: CapabilityDescriptor[] = [];
	const seenPairs = new Set<string>();
	for (let index = 0; index < descriptors.length; index++) {
		const descriptorAdmission = admitCapabilityDescriptor(descriptors[index]);
		if (!descriptorAdmission.admitted) {
			return rejectMatrix(
				'invalid-descriptor',
				`descriptors[${index}] must satisfy admitCapabilityDescriptor: '${descriptorAdmission.reason}': ${descriptorAdmission.detail}`,
			);
		}
		const descriptor = descriptorAdmission.descriptor;
		const pairKey = JSON.stringify([descriptor.providerEntryId, descriptor.modelId]);
		if (seenPairs.has(pairKey)) {
			// THE (MODEL, PROVIDER) UNIQUENESS LAW: a repeat is a
			// typed rejection - the matrix never silently overwrites.
			return rejectMatrix(
				'duplicate-model-provider-pair',
				`descriptors[${index}] repeats the (providerEntryId '${descriptor.providerEntryId}', modelId '${descriptor.modelId}') pair - a model offering is unique per provider, never a silent overwrite`,
			);
		}
		seenPairs.add(pairKey);
		admittedDescriptors.push(descriptor);
	}
	return {
		admitted: true,
		matrix: {
			matrixId,
			descriptors: admittedDescriptors,
			contractVersion,
		},
	};
}

function isModelModality(value: unknown): value is ModelModality {
	return (MODEL_MODALITIES as readonly string[]).includes(value as string);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function rejectDescriptor(
	reason: CapabilityDescriptorRejectionReason,
	detail: string,
): CapabilityDescriptorRejected {
	return { admitted: false, reason, detail };
}

function rejectMatrix(reason: CapabilityMatrixRejectionReason, detail: string): CapabilityMatrixRejected {
	return { admitted: false, reason, detail };
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
