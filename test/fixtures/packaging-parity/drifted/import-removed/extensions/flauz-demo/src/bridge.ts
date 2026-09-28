/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// fixture: desktop-bound bridge - imports node:child_process like the real seamClient.

export function launch(): void {
	spawn('node', ['service.mjs']);
}
