/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * STUB — design shape only (Wave 3 Lane F): no network calls, no registration,
 * no entitlement. Real adapters are future work (see REPORT section GAPS-AND-SKIPS).
 *
 * This literal describes the registration a future flauz-qwen adapter WOULD
 * make (vendor + displayName + models + pricing envelope). Nothing in v0
 * consumes it at runtime; it exists to pin the design shape and to give the
 * vendor pack's future adapters a reviewed starting point.
 */

import { deepFreeze, type VendorPlan } from './types.ts';

export const qwenVendorPlan: VendorPlan = deepFreeze<VendorPlan>({
	vendor: 'flauz-qwen',
	displayName: 'Flauz Qwen',
	models: [
		{
			id: 'qwen3-coder-plus',
			name: 'Qwen3 Coder Plus',
			family: 'qwen',
			version: '2025-07',
			maxInputTokens: 262_144,
			maxOutputTokens: 65_536,
		},
		{
			id: 'qwen3-max',
			name: 'Qwen3 Max',
			family: 'qwen',
			version: '2025-04',
			maxInputTokens: 131_072,
			maxOutputTokens: 32_768,
		},
	],
	pricing: {
		inputCost: 0.6,
		outputCost: 2.4,
		cacheCost: 0.06,
		priceCategory: 'low',
		category: 'lightweight',
	},
	status: 'stub',
});
