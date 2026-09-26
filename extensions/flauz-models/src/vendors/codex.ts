/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * STUB — design shape only (Wave 3 Lane F): no network calls, no registration,
 * no entitlement. Real adapters are future work (see REPORT section GAPS-AND-SKIPS).
 *
 * This literal describes the registration a future flauz-codex adapter WOULD
 * make (vendor + displayName + models + pricing envelope). Nothing in v0
 * consumes it at runtime; it exists to pin the design shape and to give the
 * vendor pack's future adapters a reviewed starting point.
 */

import { deepFreeze } from './types.ts';
import type { VendorPlan } from './types.ts';

export const codexVendorPlan: VendorPlan = deepFreeze<VendorPlan>({
	vendor: 'flauz-codex',
	displayName: 'Flauz Codex',
	models: [
		{
			id: 'gpt-5.2',
			name: 'GPT-5.2',
			family: 'gpt',
			version: '2025-11',
			maxInputTokens: 272_000,
			maxOutputTokens: 128_000,
		},
		{
			id: 'o4-mini',
			name: 'o4 mini',
			family: 'o-series',
			version: '2025-04',
			maxInputTokens: 200_000,
			maxOutputTokens: 100_000,
		},
	],
	pricing: {
		inputCost: 1.25,
		outputCost: 10,
		cacheCost: 0.125,
		cacheWriteCost: 1.25,
		priceCategory: 'medium',
		category: 'versatile',
	},
	status: 'stub',
});
