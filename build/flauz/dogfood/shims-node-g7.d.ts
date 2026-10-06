/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * G7-consumer ambient overload (the dogfood browser-policy exercise,
 * A-PROD-003-W7). The flauz-browser cdp transport sources type their
 * command timers as the minimal `{ unref(): void }` handle (their own
 * tsconfig's shims carry the matching clearTimeout overload — but sibling
 * shims do not travel with static imports, and the flauz-models ambient
 * TextDecoder conflicts with the flauz-browser shims when both are forced
 * into one program). This file adds ONLY the one missing overload as a
 * function-declaration merge (functions merge; the classes do not):
 *
 *   clearTimeout(handle: { unref(): void } | undefined): void
 *
 * At runtime the real Node clearTimeout receives the real Timeout object
 * (a structural superset). Nothing else is declared here on purpose.
 */

declare function clearTimeout(handle: { unref(): void } | undefined): void;
