/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for the vendor stubs (src/vendors/*): design-only data that pins the
 * registration shape future adapters would make.
 *
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */

import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual } from 'node:assert';

import { codexVendorPlan } from '../src/vendors/codex.ts';
import { claudeVendorPlan } from '../src/vendors/claude.ts';
import { qwenVendorPlan } from '../src/vendors/qwen.ts';
import type { VendorPlan } from '../src/vendors/types.ts';

const PLANS: readonly VendorPlan[] = [codexVendorPlan, claudeVendorPlan, qwenVendorPlan];

test('all three vendor plans declare vendor/displayName/models/pricing with status stub', () => {
	strictEqual(PLANS.length, 3);
	deepStrictEqual(PLANS.map((plan) => plan.vendor), ['flauz-codex', 'flauz-claude', 'flauz-qwen'], 'vendor ids are the planned flauz-* names');
	for (const plan of PLANS) {
		ok(typeof plan.displayName === 'string' && plan.displayName.length > 0, `${plan.vendor}: displayName is a non-empty string`);
		ok(Array.isArray(plan.models), `${plan.vendor}: models is an array`);
		ok(plan.models.length >= 1 && plan.models.length <= 2, `${plan.vendor}: 1-2 model entries`);
		for (const model of plan.models) {
			ok(typeof model.id === 'string' && model.id.length > 0, `${plan.vendor}/${model.id}: id`);
			ok(typeof model.name === 'string' && model.name.length > 0, `${plan.vendor}/${model.id}: name`);
			ok(typeof model.family === 'string' && model.family.length > 0, `${plan.vendor}/${model.id}: family`);
			ok(typeof model.version === 'string' && model.version.length > 0, `${plan.vendor}/${model.id}: version`);
			ok(typeof model.maxInputTokens === 'number' && model.maxInputTokens > 0, `${plan.vendor}/${model.id}: maxInputTokens`);
			ok(typeof model.maxOutputTokens === 'number' && model.maxOutputTokens > 0, `${plan.vendor}/${model.id}: maxOutputTokens`);
		}
		ok(plan.pricing && typeof plan.pricing === 'object', `${plan.vendor}: pricing envelope present`);
		strictEqual(plan.status, 'stub', `${plan.vendor}: status is 'stub'`);
	}
});

test('every pricing envelope carries numeric inputCost and outputCost', () => {
	for (const plan of PLANS) {
		ok(typeof plan.pricing.inputCost === 'number' && plan.pricing.inputCost > 0, `${plan.vendor}: inputCost is a positive number`);
		ok(typeof plan.pricing.outputCost === 'number' && plan.pricing.outputCost > 0, `${plan.vendor}: outputCost is a positive number`);
	}
});

test('stubs are frozen plain data: no functions, no registration, no network surface', () => {
	const assertPlainData = (value: unknown, path: string): void => {
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
			return;
		}
		if (Array.isArray(value)) {
			for (const [index, item] of value.entries()) {
				assertPlainData(item, `${path}[${index}]`);
			}
			return;
		}
		if (typeof value === 'object') {
			strictEqual(Object.getPrototypeOf(value), Object.prototype, `${path} must be a plain object (no class instances)`);
			for (const [key, child] of Object.entries(value)) {
				assertPlainData(child, `${path}.${key}`);
			}
			return;
		}
		throw new Error(`${path} is not plain data: ${typeof value}`);
	};
	for (const plan of PLANS) {
		ok(Object.isFrozen(plan), `${plan.vendor}: the stub literal is frozen`);
		assertPlainData(plan, plan.vendor);
		// JSON round-trip stability: no live references, no functions, no undefined holes.
		deepStrictEqual(plan, JSON.parse(JSON.stringify(plan)), `${plan.vendor}: survives a JSON round-trip unchanged`);
	}
});
