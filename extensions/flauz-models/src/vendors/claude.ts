/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * STUB — design shape only (Wave 3 Lane F): no network calls, no registration,
 * no entitlement. Real adapters are future work (see REPORT section GAPS-AND-SKIPS).
 *
 * This literal describes the registration a future flauz-claude adapter WOULD
 * make (vendor + displayName + models + pricing envelope). Nothing in v0
 * consumes it at runtime; it exists to pin the design shape and to give the
 * vendor pack's future adapters a reviewed starting point.
 */

import { deepFreeze, type VendorPlan } from './types.ts';

export const claudeVendorPlan: VendorPlan = deepFreeze<VendorPlan>({
	vendor: 'flauz-claude',
	displayName: 'Flauz Claude',
	models: [
		{
			id: 'claude-sonnet-4-5',
			name: 'Claude Sonnet 4.5',
			family: 'claude',
			version: '2025-09',
			maxInputTokens: 200_000,
			maxOutputTokens: 64_000,
		},
	],
	pricing: {
		inputCost: 3,
		outputCost: 15,
		cacheCost: 0.3,
		cacheWriteCost: 3.75,
		longContextInputCost: 6,
		longContextOutputCost: 22.5,
		priceCategory: 'high',
		category: 'powerful',
	},
	status: 'stub',
});
