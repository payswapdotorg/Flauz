/**
 * Model selection for the Flauz Agent Bridge.
 *
 * PERF-PLAN §2.2: warming is ONE `selectChatModels` call — no requests, no
 * heavy work. Vendor preference puts the flauz-mock vendor first (the
 * flauz-models vendor pack) so CI runs deterministic; other vendors follow.
 * The "no models available" state is handled gracefully per the stable-API
 * contract (vscode.d.ts:20746-20769: "can be empty!").
 */

import type * as vscode from 'vscode';

/** Vendors preferred for the bridge, in order (flauz-models first). */
export const PREFERRED_VENDORS: readonly string[] = ['flauz-mock'];

export interface ModelSelection {
        models: vscode.LanguageModelChat[];
        status: 'ready' | 'no-models';
        message?: string;
}

export type ModelSelector = (selector?: vscode.LanguageModelChatSelector) => Thenable<vscode.LanguageModelChat[]>;

export const NO_MODELS_MESSAGE =
        'No language models are registered yet. The plan below runs deterministically; install the flauz-models vendor pack (vendor `flauz-mock`) or any other language-model provider to enable model-driven turns.';

function vendorRank(vendor: string): number {
        const index = PREFERRED_VENDORS.indexOf(vendor);
        return index === -1 ? PREFERRED_VENDORS.length : index;
}

/** Select all models, ranked by vendor preference (stable within a vendor). */
export async function selectPreferredModels(select: ModelSelector): Promise<ModelSelection> {
        const all = await select();
        if (all.length === 0) {
                return { models: [], status: 'no-models', message: NO_MODELS_MESSAGE };
        }
        const ranked = [...all].sort(
                (a, b) =>
                        vendorRank(a.vendor) - vendorRank(b.vendor) ||
                        a.vendor.localeCompare(b.vendor) ||
                        a.id.localeCompare(b.id),
        );
        return { models: ranked, status: 'ready' };
}

/** One-line attribution for plan text (empty when no models). */
export function modelAttribution(selection: ModelSelection): string {
        if (selection.status === 'no-models' || selection.models.length === 0) {
                return NO_MODELS_MESSAGE;
        }
        const model = selection.models[0];
        return `Model in scope: ${model.vendor}/${model.family} (${model.id}) — v0 runs the deterministic plan scaffold.`;
}
