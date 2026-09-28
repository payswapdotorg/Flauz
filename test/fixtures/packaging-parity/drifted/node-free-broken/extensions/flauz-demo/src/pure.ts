/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// fixture: node-free module that DRIFTED - now imports node:path.

import { join } from 'node:path';

export function joined(a: string, b: string): string {
	return join(a, b);
}

export function pure(x: number): number {
	return x + 1;
}
