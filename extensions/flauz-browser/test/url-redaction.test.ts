/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-107 (url-redaction-control-point) — the finding's targeted tests
 * (DL-80, the two-layer redaction law's AT-RECORD layer):
 *
 *   - the acceptance test (the finding's §1 contract): a canary-bearing URL
 *     (`?token=<canary>`) in an ALLOWED navigation leaves the journal
 *     `navigated` record with the URL structure intact but the canary value
 *     redacted; the DENY path still puts the canary NOWHERE on the wire
 *     (zero CDP commands for denied operations, asserted across every
 *     transport's sent-command log); the LIVE runtime keeps the REAL URL
 *     (only the RECORD is redacted); every redacted line still satisfies the
 *     pinned v0 canonical contract (journalBridge-compatible).
 *   - the at-record surfaces per DL-80: journal tab URLs (descriptor
 *     snapshots), `navigated` rows' requested/committed URLs, popup-gate
 *     records — URL STRUCTURE and param NAMES preserved, secret-shaped VALUES
 *     redacted by the flauz-resources SECRET_SHAPED_PATTERNS class (imported
 *     — never redefined; the detector probe is cross-checked here so a
 *     locally redefined vocabulary would fail this suite).
 *   - regression guards: URLs without secret-shaped query values are
 *     BYTE-IDENTICAL through the layer (the P2-FIX-105 journey, the pinned
 *     canonical record forms, the J3 zero-wire fact — unchanged).
 *
 * Vault-only fixture discipline (mirrors flauz-resources test/helpers.ts):
 * every secret-shaped canary in this file is ASSEMBLED FROM FRAGMENTS at
 * runtime — no complete secret shape is ever spelled out in source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import {
	InMemorySessionJournal,
	buildSessionJournalRecord,
	sessionJournalLine,
	validateSessionJournalLine,
} from '../src/runtime/journal.ts';
import { REDACTED_QUERY_VALUE, redactSecretShapedQueryValues } from '../src/runtime/urlRedaction.ts';
import { looksSecretShaped } from '../../flauz-resources/src/api.ts';
import { isUntrustedContentNote } from '../src/runtime/capture.ts';
import { snapshotDescriptor, type BrowserSessionDescriptor } from '../src/runtime/session.ts';

const WORKSPACE_ROOT = '/ws/acme';

const REDACTION_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

/**
 * Assembles the P2-FIX-107 canary from fragments at RUNTIME (the vault-only
 * fixture discipline: no complete secret shape appears in this source). The
 * canary is a ghp_-class value (30 alphanumerics after the prefix) — flagged
 * by the flauz-resources SECRET_SHAPED_PATTERNS vocabulary.
 */
function canaryFixture(): string {
	return ['ghp_', 'FlauzP2', 'Fix107', 'Canary', '9f31c7aa', '4d'].join('');
}

/**
 * Assembles a percent-encoded Bearer-class carrier: the RAW query value is
 * not secret-shaped (no literal space), the DECODED value is — pinning the
 * layer's decode arm.
 */
function encodedBearerFixture(): string {
	return ['Bearer%20', 'Flauz', 'P2FIX107', '0123', '4567', '890a'].join('');
}

interface RedactionRig {
	state: FakeBrowserState;
	manager: BrowserSessionManager;
	journal: InMemorySessionJournal;
	transports: FakeCdpTransport[];
}

function rig(policyText: string = REDACTION_POLICY): RedactionRig {
	const state = new FakeBrowserState();
	const journal = new InMemorySessionJournal();
	const transports: FakeCdpTransport[] = [];
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => {
			const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
			transports.push(transport);
			return transport;
		},
	});
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(policyText),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		journal,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	return { state, manager, journal, transports };
}

function fixtureDescriptor(initiator: 'agent' | 'human', tabUrl: string): BrowserSessionDescriptor {
	return {
		schemaVersion: 0,
		sessionId: 'flauz:browser:0123456789abcdef',
		initiator,
		agentId: initiator === 'agent' ? 'worker-1' : undefined,
		partition: 'persist:flauz-0123456789abcdef',
		policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
		createdAt: '2026-10-01T12:00:00.000Z',
		state: 'active',
		tabs: [{
			tabId: 'flauz:tab:0000000000000001',
			targetId: 'fixture-target-1',
			url: tabUrl,
			state: 'active',
			openedAt: '2026-10-01T12:00:00.000Z',
		}],
	};
}

// #region The normalization helper (the at-record layer's one shape class)

test('P2-FIX-107 — redactSecretShapedQueryValues: URL structure and param NAMES survive, secret-shaped VALUES are redacted (DL-80: not a blunt query-strip)', () => {
	const canary = canaryFixture();
	assert.equal(looksSecretShaped(canary), true, 'the canary is flagged by the IMPORTED flauz-resources detector class (the vocabulary the at-record layer uses)');
	assert.equal(looksSecretShaped(REDACTED_QUERY_VALUE), false, 'the marker is not itself secret-shaped (a redacted record never re-trips any detector)');
	// the canonical A10 shape: one secret value among ordinary params —
	// scheme/authority/path, param names, order, separators and the sibling
	// values all survive verbatim:
	assert.equal(
		redactSecretShapedQueryValues(`https://docs.example.com/app?token=${canary}&keep=plain&x=1`),
		`https://docs.example.com/app?token=${REDACTED_QUERY_VALUE}&keep=plain&x=1`,
	);
	// the fragment survives; only the query VALUE is replaced:
	assert.equal(
		redactSecretShapedQueryValues(`https://docs.example.com/app?token=${canary}#section`),
		`https://docs.example.com/app?token=${REDACTED_QUERY_VALUE}#section`,
	);
	// every secret-shaped value in the query is redacted, names stay paired:
	assert.equal(
		redactSecretShapedQueryValues(`https://docs.example.com/app?a=${canary}&b=${canary}`),
		`https://docs.example.com/app?a=${REDACTED_QUERY_VALUE}&b=${REDACTED_QUERY_VALUE}`,
	);
	// a percent-encoded carrier: the RAW form is not secret-shaped, the
	// DECODED value is — the layer redacts it (the value the URL carries):
	assert.equal(
		redactSecretShapedQueryValues(`https://docs.example.com/app?token=${encodedBearerFixture()}`),
		`https://docs.example.com/app?token=${REDACTED_QUERY_VALUE}`,
	);
});

test('P2-FIX-107 — redactSecretShapedQueryValues is a BYTE-IDENTICAL no-op for URLs without secret-shaped query values (canonical record forms untouched)', () => {
	const plain = [
		'about:blank',
		'https://docs.example.com/x',
		'https://docs.example.com/x?keep=plain&n=1',
		'https://docs.example.com/x?a&b=1#frag',
		'https://docs.example.com/p#f?token=x', // the '?' lives in the fragment: no query component
		'https://docs.example.com/p?',
		'not a url at all',
	].every(url => redactSecretShapedQueryValues(url) === url);
	assert.equal(plain, true, 'no re-serialization: the ORIGINAL bytes come back when nothing is secret-shaped');
	// an ordinary value that merely looks token-ish stays verbatim:
	assert.equal(redactSecretShapedQueryValues('https://docs.example.com/app?token=plainvalue&sig=abc123'), 'https://docs.example.com/app?token=plainvalue&sig=abc123');
});

// #endregion

// #region The journal write boundary (buildSessionJournalRecord)

test('P2-FIX-107 — buildSessionJournalRecord persists the navigated row + descriptor tab URLs through the at-record layer (caller objects NEVER mutated)', () => {
	const canary = canaryFixture();
	const canaryUrl = `https://docs.example.com/app?token=${canary}&keep=plain`;
	const redactedUrl = `https://docs.example.com/app?token=${REDACTED_QUERY_VALUE}&keep=plain`;
	const descriptor = fixtureDescriptor('agent', canaryUrl);
	const navigation = { decision: 'allow', requestedUrl: canaryUrl, committedUrl: canaryUrl, sent: true } as const;
	const record = buildSessionJournalRecord('agent', 'navigated', descriptor, 1760000000000, navigation);
	// the RECORD carries the redacted form, structure intact:
	assert.equal(record.navigation?.requestedUrl, redactedUrl);
	assert.equal(record.navigation?.committedUrl, redactedUrl);
	assert.equal(record.descriptor.tabs[0]?.url, redactedUrl);
	// the line: canonical v0, no canary, param name + marker present:
	const line = sessionJournalLine(record);
	assert.ok(!line.includes(canary), 'the canary never reaches the journal bytes');
	assert.ok(line.includes('"requestedUrl":"https://docs.example.com/app?token=[redacted]&keep=plain"'));
	assert.equal(validateSessionJournalLine(line).ok, true, 'the redacted line satisfies the pinned v0 canonical contract (journalBridge-compatible)');
	// the CALLER's objects keep the REAL URL (runtime semantics unchanged — only the record is redacted):
	assert.equal(descriptor.tabs[0]?.url, canaryUrl, 'the live descriptor is never mutated');
	assert.deepEqual(navigation, { decision: 'allow', requestedUrl: canaryUrl, committedUrl: canaryUrl, sent: true }, 'the caller navigation facts object is never mutated');
	// the DENY row: J3 invariants pass through redaction untouched:
	const denyNavigation = { decision: 'deny', requestedUrl: canaryUrl, sent: false } as const;
	const denyRecord = buildSessionJournalRecord('agent', 'navigated', fixtureDescriptor('agent', 'about:blank'), 1760000000001, denyNavigation);
	assert.equal(denyRecord.navigation?.requestedUrl, redactedUrl);
	assert.equal('committedUrl' in (denyRecord.navigation ?? {}), false, 'a deny row never claims a commit');
	assert.equal(denyRecord.navigation?.sent, false);
	assert.equal(validateSessionJournalLine(sessionJournalLine(denyRecord)).ok, true, 'the redacted deny row stays a self-certifying J3 row');
	// no-op identity: a navigation without secret-shaped values keeps the
	// EXACT pre-P2-FIX-107 projection (byte-identical evolution):
	const plainNavigation = { decision: 'allow', requestedUrl: 'https://docs.example.com/x', committedUrl: 'https://docs.example.com/x', sent: true } as const;
	const plainRecord = buildSessionJournalRecord('agent', 'navigated', fixtureDescriptor('agent', 'https://docs.example.com/x'), 1760000000002, plainNavigation);
	assert.deepEqual(plainRecord.navigation, plainNavigation, 'non-secret navigation facts ride through unchanged');
});

test('P2-FIX-107 — lifecycle rows (opened/state-changed/closed/failed) carry redacted tab URLs; plain tab URLs keep the exact pre-107 snapshot', () => {
	const canary = canaryFixture();
	const canaryUrl = `https://docs.example.com/app?token=${canary}`;
	const redactedUrl = `https://docs.example.com/app?token=${REDACTED_QUERY_VALUE}`;
	for (const event of ['opened', 'state-changed', 'closed', 'failed'] as const) {
		const record = buildSessionJournalRecord('agent', event, fixtureDescriptor('agent', canaryUrl), 1760000000000);
		assert.equal(record.descriptor.tabs[0]?.url, redactedUrl, `${event}: the tab URL is redacted at the write boundary`);
		const line = sessionJournalLine(record);
		assert.ok(!line.includes(canary), `${event}: the canary never reaches the journal bytes`);
		assert.equal(validateSessionJournalLine(line).ok, true, `${event}: the redacted line satisfies the pinned v0 contract`);
	}
	// plain URLs: the snapshot is EXACTLY the descriptor snapshot (identity):
	const plainDescriptor = fixtureDescriptor('human', 'https://docs.example.com/x?keep=plain');
	const plainRecord = buildSessionJournalRecord('human', 'opened', plainDescriptor, 1760000000000);
	assert.deepEqual(plainRecord.descriptor, snapshotDescriptor(plainDescriptor), 'no secret shapes: the snapshot passes through untouched');
});

// #endregion

// #region THE ACCEPTANCE TEST (the finding's §1 contract, on the real write path)

test('P2-FIX-107 — THE ACCEPTANCE TEST: a canary-bearing ALLOWED navigation journals a navigated record with URL structure intact + canary value redacted; the DENY path puts the canary NOWHERE on the wire; the LIVE runtime keeps the REAL URL', async () => {
	const canary = canaryFixture();
	const allowUrl = `https://docs.example.com/app?token=${canary}&keep=plain`;
	const redactedAllowUrl = `https://docs.example.com/app?token=${REDACTED_QUERY_VALUE}&keep=plain`;
	const denyUrl = `https://evil.org/pay?token=${canary}`;
	const redactedDenyUrl = `https://evil.org/pay?token=${REDACTED_QUERY_VALUE}`;
	const popupUrl = `https://docs.example.com/popup?token=${canary}`;
	const redactedPopupUrl = `https://docs.example.com/popup?token=${REDACTED_QUERY_VALUE}`;

	const redactionRig = rig();
	const opened = await redactionRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const sessionId = opened.descriptor.sessionId;

	// the ALLOWED canary navigation: the runtime navigates the REAL URL...
	const allowed = await redactionRig.manager.navigate(sessionId, allowUrl);
	assert.ok(isNavigationOutcome(allowed));
	assert.equal(allowed.verdict.decision, 'allow');
	assert.equal(allowed.committedUrl, allowUrl, 'runtime semantics UNCHANGED: the REAL URL committed');
	// ...and the LIVE descriptor keeps the REAL URL (only the record is redacted):
	assert.equal(redactionRig.manager.getSession(sessionId)?.tabs.find(tab => tab.tabId === allowed.tabId)?.url, allowUrl);

	// the DENIED canary navigation: zero wire commands by construction:
	const denied = await redactionRig.manager.navigate(sessionId, denyUrl);
	assert.ok(isNavigationOutcome(denied));
	assert.equal(denied.verdict.decision, 'deny');
	assert.equal(denied.sent, false, 'the deny path sends ZERO wire commands (J3 fail-closed)');

	// a canary-bearing POPUP through the gate (allowed host):
	const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';
	redactionRig.transports[0]?.openPopupFrom(sourceTargetId, popupUrl);
	await redactionRig.manager.awaitPopupGate();

	await redactionRig.manager.close(sessionId);
	await redactionRig.manager.dispose();

	// THE JOURNAL (the at-rest evidence surface): census + the finding's exact
	// acceptance shape — URL structure intact, canary value redacted:
	assert.deepEqual(redactionRig.journal.records.map(record => record.event), ['opened', 'navigated', 'navigated', 'closed']);
	const allowRow = redactionRig.journal.records[1];
	assert.ok(allowRow !== undefined);
	assert.deepEqual(allowRow.navigation, {
		decision: 'allow',
		requestedUrl: redactedAllowUrl,
		committedUrl: redactedAllowUrl,
		sent: true,
	}, 'structure + param names intact (token=, &keep=plain), the canary VALUE redacted');
	assert.equal(allowRow.descriptor.tabs.find(tab => tab.tabId === allowed.tabId)?.url, redactedAllowUrl, 'the tab URL in the record snapshot is redacted');
	const denyRow = redactionRig.journal.records[2];
	assert.ok(denyRow !== undefined);
	assert.deepEqual(denyRow.navigation, { decision: 'deny', requestedUrl: redactedDenyUrl, sent: false }, 'the deny row: the requested URL redacted, sent:false, no commit');
	const closedRow = redactionRig.journal.records[3];
	assert.ok(closedRow !== undefined);
	assert.ok(closedRow.descriptor.tabs.some(tab => tab.url === redactedPopupUrl), 'the popup tab URL in the closed snapshot is redacted');

	// the AT-REST fact (the finding's observable, gone): the canary appears
	// in NO journal byte, while every line stays a canonical, contract-valid
	// v0 record (the pinned reader contract — journalBridge compatibility):
	for (const line of redactionRig.journal.lines) {
		assert.ok(!line.includes(canary), `the canary never reaches the journal bytes: ${line}`);
		assert.equal(validateSessionJournalLine(line).ok, true, line);
	}

	// THE WIRE: zero commands for the DENIED operation; the canary rides the
	// wire ONLY as the allowed navigation's REAL Page.navigate target (the
	// runtime navigates the REAL URL — that is unchanged and correct):
	const wire = redactionRig.transports.flatMap(transport => transport.sentCommands);
	assert.equal(wire.filter(command => JSON.stringify(command.params ?? {}).includes('evil.org')).length, 0, 'the DENY path put the canary-bearing denied URL NOWHERE on the wire (zero commands for denied operations)');
	const canaryWire = wire.filter(command => JSON.stringify(command.params ?? {}).includes(canary));
	assert.equal(canaryWire.length, 1, 'the canary appears on the wire exactly once: the allowed Page.navigate to the REAL URL');
	assert.equal(canaryWire[0]?.method, 'Page.navigate');

	// the POPUP-GATE record: the redacted form at the write boundary:
	const gateEvents = redactionRig.manager.popupGateEvents();
	assert.equal(gateEvents.length, 1);
	assert.equal(gateEvents[0]?.url, redactedPopupUrl, 'the popup-gate record carries the redacted URL');
	assert.ok(gateEvents[0]?.attachedTabId !== undefined, 'the allowed popup attached as a tab (gate semantics unchanged)');
});

test('P2-FIX-107 — popup-gate records carry the redacted URL at the write boundary (allowed + denied popups; verdict/evidence-row notes keep their structure per the DL-80 scope guard)', async () => {
	const canary = canaryFixture();
	const gateRig = rig();
	const opened = await gateRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/page' });
	const sourceTargetId = opened.descriptor.tabs[0]?.targetId ?? '';

	// an ALLOWED canary popup attaches; its RECORD carries the redacted url:
	gateRig.transports[0]?.openPopupFrom(sourceTargetId, `https://docs.example.com/popup?token=${canary}`);
	// a DENIED canary popup is closed; its RECORD carries the redacted url:
	gateRig.transports[0]?.openPopupFrom(sourceTargetId, `https://evil.org/popup?token=${canary}`);
	// a PLAIN popup: byte-identical pre-107 behavior (no redaction without a
	// secret-shaped value):
	gateRig.transports[0]?.openPopupFrom(sourceTargetId, 'https://docs.example.com/plain?keep=1');
	await gateRig.manager.awaitPopupGate();

	const events = gateRig.manager.popupGateEvents();
	assert.equal(events.length, 3);
	assert.equal(events[0]?.decision, 'allow');
	assert.equal(events[0]?.url, `https://docs.example.com/popup?token=${REDACTED_QUERY_VALUE}`, 'allowed popup: the record url is the redacted form');
	assert.ok(isUntrustedContentNote(events[0]?.evidenceRow.note ?? ''), 'the evidence-row note keeps its untrusted-content structure (DL-80 scope guard: verdict notes are not this change)');
	assert.equal(events[1]?.decision, 'deny');
	assert.equal(events[1]?.url, `https://evil.org/popup?token=${REDACTED_QUERY_VALUE}`, 'denied popup: the record url is the redacted form');
	assert.equal(events[1]?.closed, true, 'the denied popup is still closed immediately (gate semantics unchanged)');
	assert.ok(isUntrustedContentNote(events[1]?.evidenceRow.note ?? ''), 'the deny note keeps its structure');
	assert.equal(events[2]?.url, 'https://docs.example.com/plain?keep=1', 'a popup URL without secret-shaped values records VERBATIM (no blunt query-strip)');
	await gateRig.manager.dispose();
});

// #endregion

// #region Regression guards (the pre-107 behavior for non-secret URLs)

test('P2-FIX-107 — REGRESSION: the P2-FIX-105 journey is byte-identical for URLs without secret-shaped values (census, row shapes, J3 zero-wire fact)', async () => {
	const journalRig = rig();
	const opened = await journalRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	const sessionId = opened.descriptor.sessionId;
	const allowed = await journalRig.manager.navigate(sessionId, 'https://docs.example.com/x');
	assert.ok(isNavigationOutcome(allowed));
	assert.equal(allowed.committedUrl, 'https://docs.example.com/x');
	const denied = await journalRig.manager.navigate(sessionId, 'https://evil.org/pay');
	assert.ok(isNavigationOutcome(denied));
	assert.equal(denied.sent, false);
	await journalRig.manager.close(sessionId);
	await journalRig.manager.dispose();
	assert.deepEqual(journalRig.journal.records.map(record => record.event), ['opened', 'navigated', 'navigated', 'closed']);
	assert.deepEqual(journalRig.journal.records[1]?.navigation, {
		decision: 'allow',
		requestedUrl: 'https://docs.example.com/x',
		committedUrl: 'https://docs.example.com/x',
		sent: true,
	}, 'no marker, no re-serialization: the plain URL records exactly as before P2-FIX-107');
	assert.deepEqual(journalRig.journal.records[2]?.navigation, { decision: 'deny', requestedUrl: 'https://evil.org/pay', sent: false });
	for (const line of journalRig.journal.lines) {
		assert.ok(!line.includes(REDACTED_QUERY_VALUE), 'no redaction marker ever appears for URLs without secret-shaped values');
		assert.equal(validateSessionJournalLine(line).ok, true, line);
	}
	const wireDrives = journalRig.transports.flatMap(transport => transport.pageNavigateCommands());
	assert.equal(wireDrives.length, 1, 'the J3 zero-wire fact: exactly ONE Page.navigate (the allowed one)');
	assert.equal(wireDrives[0]?.params?.url, 'https://docs.example.com/x');
});

// #endregion
