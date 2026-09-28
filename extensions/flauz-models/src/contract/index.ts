/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the adapter contract barrel (M1). Consumers import
 * from './contract/index.ts'; internal modules import their direct
 * dependencies (no cycles: types <- errors, canonical <- types,
 * ports, nodePorts <- ports).
 */

export * from './types.ts';
export * from './errors.ts';
export * from './ports.ts';
export * from './canonical.ts';
export * from './nodePorts.ts';
