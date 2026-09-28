/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the adapter barrel (M2): three real wire families
 * (OpenAI-compatible, Anthropic-compatible, Ollama-style local) plus the
 * vscode bridge. FIXTURE-VERIFIED through test/{openAiCompat,
 * anthropicCompat,ollama,bridge}.test.ts against LOCAL node:http fixture
 * servers; live-provider verification is a recorded future integration gap.
 */

export * from './common.ts';
export * from './openAiCompat.ts';
export * from './anthropicCompat.ts';
export * from './ollama.ts';
export * from './bridge.ts';
