/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The web (browser) lane's ambient declarations - A-PROD-006-W9.
 *
 * Zero-dependency discipline (the extension's own pattern, the
 * node.d.ts shim's exact sibling): no lib.dom.d.ts is pulled (the
 * extension tsconfig's lib is ["ES2022"]); the web entry uses exactly
 * ONE browser global - the Web Crypto `crypto.getRandomValues` (the
 * in-session id seam, the node:crypto rng's web sibling) - so exactly
 * that narrow surface is declared here. Nothing more.
 */
declare const crypto: {
	getRandomValues(array: Uint8Array): Uint8Array;
};
