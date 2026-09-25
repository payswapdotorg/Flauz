/**
 * Shared design shapes for the flauz-models vendor pack stubs.
 *
 * These types describe the registration a FUTURE vendor adapter would make:
 * the `languageModelChatProviders` package.json contribution plus the
 * `lm.registerLanguageModelChatProvider(vendor, provider)` call for its
 * vendor, the models it would serve, and their pricing envelope. They are
 * DESIGN ONLY in v0 — nothing in this extension consumes them at runtime
 * (see the stubs in codex.ts / claude.ts / qwen.ts).
 */

/**
 * Pricing envelope, structurally typed after the optional pricing fields the
 * PROPOSED `languageModelPricing` API adds to `LanguageModelChatInformation`.
 * Upstream shape: vendored vscode-dts/vscode.proposed.languageModelPricing.d.ts
 * (mirror of src/vscode-dts/vscode.proposed.languageModelPricing.d.ts @
 * 9bf9ae764da). Compile-time shape ONLY: the proposal is NOT enabled in this
 * extension (DL-4 — stable APIs only) and no value from the proposed API is
 * referenced at runtime.
 */
export interface PricingEnvelope {
	/** Optional pricing label for display, such as "Free" or "$0.01/request". */
	readonly pricing?: string;
	/** Optional input cost in AI credits per million input tokens. */
	readonly inputCost?: number;
	/** Optional output cost in AI credits per million output tokens. */
	readonly outputCost?: number;
	/** Optional cache cost in AI credits per million cached tokens. */
	readonly cacheCost?: number;
	/** Optional cache write cost in AI credits per million cache-write tokens. */
	readonly cacheWriteCost?: number;
	/** Optional long-context input cost (when long-context pricing differs). */
	readonly longContextInputCost?: number;
	/** Optional long-context output cost (when long-context pricing differs). */
	readonly longContextOutputCost?: number;
	/** Optional long-context cache cost (when long-context pricing differs). */
	readonly longContextCacheCost?: number;
	/** Optional long-context cache write cost (when long-context pricing differs). */
	readonly longContextCacheWriteCost?: number;
	/** Optional relative pricing category, e.g. "low" | "medium" | "high" | "very_high". */
	readonly priceCategory?: string;
	/** Optional model category describing the model's tier, e.g. "lightweight" | "versatile" | "powerful". */
	readonly category?: string;
}

/**
 * A model a future vendor adapter would serve — the required-field slice of
 * `vscode.LanguageModelChatInformation` (vscode.d.ts:20584-20633). The
 * optional pricing fields are carried on the plan-level envelope instead.
 */
export interface VendorModelPlan {
	readonly id: string;
	readonly name: string;
	readonly family: string;
	readonly version: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
}

/**
 * The registration a future vendor adapter WOULD make. `status: 'stub'`
 * marks this as design-only data: no registration, no network, no secrets.
 */
export interface VendorPlan {
	readonly vendor: string;
	readonly displayName: string;
	readonly models: readonly VendorModelPlan[];
	readonly pricing: PricingEnvelope;
	readonly status: 'stub';
}

/**
 * Recursively freezes plain data (arrays and plain objects) in place and
 * returns it, so stub literals become deeply immutable at module load.
 */
export function deepFreeze<T>(value: T): T {
	if (value !== null && (typeof value === 'object' || Array.isArray(value))) {
		for (const child of Object.values(value as unknown as Record<string, unknown>)) {
			deepFreeze(child);
		}
		Object.freeze(value);
	}
	return value;
}
