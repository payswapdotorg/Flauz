/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-107 / DL-80 — the AT-RECORD redaction layer for URL query values at
 * the browser partition's persistence boundaries (the two-layer redaction
 * law's layer 1):
 *
 *   - WHAT: a URL carried by a journal record (tab URLs in the descriptor
 *     snapshot, `navigated` rows' requested/committed URLs) or by a popup-gate
 *     record keeps its STRUCTURE — scheme, authority, path, param NAMES, param
 *     order, separators, non-secret values and fragment — while every
 *     SECRET-SHAPED query-param VALUE is replaced with the {@link
 *     REDACTED_QUERY_VALUE} marker. This is a targeted filter for ONE shape
 *     class (query-param values), NOT a blunt query-strip: provenance
 *     fidelity is the point (DL-80 basis 2).
 *
 *   - WHO detects: the flauz-resources `SECRET_SHAPED_PATTERNS` detector
 *     class — the SAME vocabulary the vault-only law uses — IMPORTED here via
 *     its exported probe `looksSecretShaped` (the pattern table itself is
 *     module-private in flauz-resources BY DESIGN; importing the probe keeps
 *     the vocabulary single-sourced — never redefined in flauz-browser).
 *
 *   - What this layer is NOT (DL-80 scope guards): it is NOT a second
 *     redaction authority — the continuity export REMAINS the authoritative
 *     full-redaction boundary, unchanged (belt-and-braces: the export catches
 *     non-query secret shapes this layer does not target). Verdict notes keep
 *     their structure — secret-shaped fragments inside them are the
 *     resources-lane detector's beat where they surface, not this change.
 *     Runtime navigation semantics are UNCHANGED: the browser navigates the
 *     REAL URL; only the RECORD is redacted.
 *
 * Byte discipline: the normalization is a no-op (the ORIGINAL string, never a
 * re-serialization) unless a secret-shaped value is actually present — URLs
 * without secret-shaped query values are byte-identical through the layer, so
 * the pinned v0 canonical record forms are untouched for them. The rewrite
 * splits the query component on `&` and replaces ONLY the value segment of a
 * `name=value` pair whose value is secret-shaped (tested raw and
 * percent-decoded), leaving every other byte of the URL in place.
 */

import { looksSecretShaped } from '../../../flauz-resources/src/api.ts';

/**
 * The replacement for a secret-shaped query-param value (P2-FIX-107 / DL-80).
 * Deliberately NOT itself secret-shaped and URL/JSON-safe (no escaping needed
 * under the canonical-JSON record discipline).
 */
export const REDACTED_QUERY_VALUE = '[redacted]';

/** True when the query-param value (raw OR percent-decoded form) is secret-shaped. */
function isSecretShapedQueryValue(value: string): boolean {
	if (looksSecretShaped(value)) {
		return true;
	}
	// A percent-encoded carrier decodes to the value the URL actually carries;
	// malformed escapes fall back to the raw form already tested above.
	try {
		const decoded = decodeURIComponent(value);
		return decoded !== value && looksSecretShaped(decoded);
	} catch {
		return false;
	}
}

/**
 * Normalizes one URL for AT-RECORD persistence (P2-FIX-107 / DL-80): the
 * structure and param NAMES survive intact, secret-shaped param VALUES are
 * replaced with {@link REDACTED_QUERY_VALUE}. Returns the input string
 * unchanged (same reference semantics, byte-identical) when the URL has no
 * query component or no secret-shaped value — the canonical record bytes for
 * ordinary URLs are never perturbed by this layer.
 */
export function redactSecretShapedQueryValues(url: string): string {
	const queryStart = url.indexOf('?');
	if (queryStart === -1) {
		return url; // no query component: nothing this layer targets
	}
	const hashIndex = url.indexOf('#');
	if (hashIndex !== -1 && hashIndex < queryStart) {
		return url; // the '?' lives inside the fragment: there is no query component
	}
	const prefix = url.slice(0, queryStart + 1); // everything through the '?'
	const tail = url.slice(queryStart + 1); // the query, then any fragment
	const tailHash = tail.indexOf('#'); // fragment position RELATIVE to the tail
	const query = tailHash === -1 ? tail : tail.slice(0, tailHash);
	const fragment = tailHash === -1 ? '' : tail.slice(tailHash);
	if (query === '') {
		return url; // a bare '?' (or '?#fragment'): byte-identical
	}
	let changed = false;
	const pairs = query.split('&').map(pair => {
		const eq = pair.indexOf('=');
		if (eq === -1) {
			return pair; // a flag-style param ('&a&') carries no value to redact
		}
		const name = pair.slice(0, eq);
		const value = pair.slice(eq + 1);
		if (!isSecretShapedQueryValue(value)) {
			return pair; // the param's exact bytes survive (names, encoding, order)
		}
		changed = true;
		return `${name}=${REDACTED_QUERY_VALUE}`;
	});
	if (!changed) {
		return url; // nothing secret-shaped: the ORIGINAL bytes, never a re-serialization
	}
	return `${prefix}${pairs.join('&')}${fragment}`;
}
