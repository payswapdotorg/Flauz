/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// B-POLICY workbench boot drill driver (TL3-H2) -- CI TEST INFRASTRUCTURE,
// not a Flauz product extension.
//
// Mechanism (why a test-driver extension, documented in
// build/flauz/canaries/B-POLICY.md "Workbench boot drill"):
//   - The ONLY architecture-allowed invocation surface for the flauz.browser.*
//     command surface is `vscode.commands.executeCommand` (the product
//     extension activates lazily onCommand:flauz.browser.*; it registers no
//     URI handler and no CLI surface, and this drill must NOT weaken that
//     discipline by adding one).
//   - Driving the renderer via CDP Runtime.evaluate would exercise page
//     internals, not the extension API contract.
//   - This driver lives under test/fixtures/ (like the fixture workspaces),
//     installs into the canary profile's --extensions-dir (NOT the product
//     bundle under extensions/flauz-*), carries no flauz- prefix, and never
//     touches the activation-lint's built-in caps (its manifest is outside
//     the extensions/flauz-* glob the lint scans).
//
// What it does: on onStartupFinished it waits for the flauz.flauz-browser
// built-in to appear in the extension registry, then exercises the REAL
// command surface in the BOOTED workbench:
//
//   driver.flauz-extension-present  the built-in is in the registry
//   driver.activation-triggered     executeCommand activates it (onCommand)
//   driver.command-surface          the ten flauz.browser.* commands are
//                                   registered after activation
//   driver.deny-start-typed         a policy-DENIED startUrl fails the session
//                                   BEFORE any host interaction (typed error
//                                   + verdict + evidence row) -- the A5-at-boot
//                                   assertion, network-free
//   driver.session-open-workbench   an agent session OPENS through the real
//                                   workbench host adapter: window.openBrowserTab
//                                   (about:blank) + BrowserTab.startCDPSession +
//                                   the TL3-002 hardening commands over the real
//                                   session -- the P0 posture boot fact
//   driver.navigate-denied          a policy-DENIED navigation on the live
//                                   session sends ZERO CDP commands and returns
//                                   the typed denial + evidence row
//   driver.navigate-allowed         the allowed navigation SENDS Page.navigate
//                                   over the real workbench session (sent=true;
//                                   the commit observation is network-dependent
//                                   and is recorded, never faked)
//   driver.sessions-audit           the audit list carries the session
//   driver.session-close            closeSession seals the session cleanly
//
// The report lands at <workspace>/.flauz/boot-drill/driver-report.json; the
// CI evaluator (build/flauz/scripts/b-policy-boot-drill.mjs) polls for it and
// asserts the log-corpus side (activation record, proposal trip-wires,
// runtime log lines).
//
// Honesty law: every row records the exact observed detail; a row the driver
// cannot observe fails loudly with the reason (never a fake pass); the
// allowed-navigation COMMIT state is recorded as observed data only.
//
// Zero dependencies: plain CommonJS + the vscode API surface only.
// ASCII only. Tabs for indentation.
// ---------------------------------------------------------------------------------------------

'use strict';

const FLAUZ_BROWSER_ID = 'flauz.flauz-browser';
const AGENT_ID = 'boot-drill';
const DENIED_URL = 'https://evil.org/pay';
const ALLOWED_URL = 'https://example.com/';
const REPORT_SCHEMA = 'flauz.bpolicy-boot-driver/v0';
const EXTENSION_WAIT_MS = 60000;
const EXTENSION_POLL_MS = 500;

/** The drill rows (mirrored by the CI evaluator's driver.* row ids). */
const rows = [];
const observed = {};

function row(id, ok, detail) {
	rows.push({ id: id, ok: ok === true, detail: String(detail) });
	console.log('[bpolicy-boot-driver] ' + (ok === true ? 'PASS ' : 'FAIL ') + id + ' -- ' + detail);
}

function sleep(ms) {
	return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function asRecord(value) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value;
}

function firstWorkspaceFolder(vscode) {
	const folders = vscode.workspace.workspaceFolders;
	return folders !== undefined && folders.length > 0 ? folders[0] : undefined;
}

async function waitForFlauzExtension(vscode) {
	const deadline = Date.now() + EXTENSION_WAIT_MS;
	for (;;) {
		const extension = vscode.extensions.getExtension(FLAUZ_BROWSER_ID);
		if (extension !== undefined) {
			return extension;
		}
		if (Date.now() >= deadline) {
			return undefined;
		}
		await sleep(EXTENSION_POLL_MS);
	}
}

async function writeReport(vscode) {
	const folder = firstWorkspaceFolder(vscode);
	if (folder === undefined) {
		console.error('[bpolicy-boot-driver] no workspace folder open -- cannot write the report');
		return;
	}
	const report = {
		schema: REPORT_SCHEMA,
		at: new Date().toISOString(),
		vscodeVersion: vscode.version,
		workspaceRoot: folder.uri.fsPath,
		ok: rows.length > 0 && rows.every(function (r) { return r.ok; }),
		rows: rows,
		observed: observed
	};
	const dirUri = vscode.Uri.joinPath(folder.uri, '.flauz', 'boot-drill');
	await vscode.workspace.fs.createDirectory(dirUri);
	const reportUri = vscode.Uri.joinPath(dirUri, 'driver-report.json');
	await vscode.workspace.fs.writeFile(reportUri, new TextEncoder().encode(JSON.stringify(report, null, 1) + '\n'));
	console.log('[bpolicy-boot-driver] report written: ' + reportUri.toString());
}

async function runDrill(vscode) {
	const startedAt = Date.now();

	// driver.flauz-extension-present: the built-in must be in the registry.
	const extension = await waitForFlauzExtension(vscode);
	if (extension === undefined) {
		row('driver.flauz-extension-present', false, 'flauz.flauz-browser never appeared in vscode.extensions within ' + EXTENSION_WAIT_MS + 'ms (bundling or scanning broken)');
		return;
	}
	row('driver.flauz-extension-present', true, 'flauz.flauz-browser is in the extension registry');

	// driver.deny-start-typed (+ the activation trigger): the DENIED startUrl
	// fails the session before any host interaction. This executeCommand call
	// is ALSO the first activation trigger (onCommand:flauz.browser.openSession)
	// -- the real lazy-activation machinery runs here.
	let deniedStart;
	try {
		deniedStart = asRecord(await vscode.commands.executeCommand('flauz.browser.openSession', {
			initiator: 'agent',
			agentId: AGENT_ID,
			startUrl: DENIED_URL
		}));
	} catch (err) {
		// The command invocation itself failed (extension missing / activation
		// failure / command not registered): record it as the deny-start row's
		// failure detail -- that IS the drill's finding, not an internal error.
		deniedStart = undefined;
		rows.push({ id: 'driver.deny-start-typed', ok: false, detail: 'executeCommand flauz.browser.openSession THREW: ' + (err !== undefined && err.message !== undefined ? err.message : String(err)) });
	}
	if (deniedStart === undefined && rows.some(function (r) { return r.id === 'driver.deny-start-typed'; })) {
		// The catch above already recorded the invocation failure; the report
		// must carry it exactly once (the evaluator mirrors every row).
		observed.deniedStart = { error: 'executeCommand threw (see the deny-start row)' };
		return;
	}
	const deniedDescriptor = asRecord(deniedStart !== undefined ? deniedStart.descriptor : undefined);
	const deniedError = asRecord(deniedStart !== undefined ? deniedStart.error : undefined);
	const deniedVerdict = asRecord(deniedStart !== undefined ? deniedStart.verdict : undefined);
	const deniedEvidenceRow = asRecord(deniedStart !== undefined ? deniedStart.evidenceRow : undefined);
	const denyStartOk = deniedStart !== undefined
		&& deniedDescriptor !== undefined && deniedDescriptor.state === 'failed'
		&& deniedError !== undefined && deniedError.code === 'flauz.browser.policy.deny'
		&& deniedVerdict !== undefined && deniedVerdict.decision === 'deny' && deniedVerdict.layer === 'driver' && deniedVerdict.initiator === 'agent-tool'
		&& deniedEvidenceRow !== undefined && deniedEvidenceRow.kind === 'note' && typeof deniedEvidenceRow.sha256 === 'string' && /^[0-9a-f]{64}$/.test(deniedEvidenceRow.sha256);
	row('driver.deny-start-typed', denyStartOk, denyStartOk
		? 'denied startUrl failed the session BEFORE any host interaction: state=failed code=flauz.browser.policy.deny verdict=deny/driver/agent-tool evidenceRow=note/<64hex>'
		: 'unexpected denied-startSession result: ' + JSON.stringify(deniedStart).slice(0, 400));
	observed.deniedStart = deniedStart;

	// driver.activation-triggered: the executeCommand above must have
	// ACTIVATED flauz.flauz-browser (the onCommand activation machinery).
	const activated = extension.isActive === true;
	row('driver.activation-triggered', activated, activated
		? 'flauz.flauz-browser isActive=true after the first flauz.browser.* executeCommand (the ExtensionService activation record is asserted log-side by the evaluator)'
		: 'flauz.flauz-browser did not activate on the command invocation (isActive=false)');

	// driver.command-surface: after activation, the ten commands register.
	const commands = await vscode.commands.getCommands();
	const expected = [
		'flauz.browser.setPolicy',
		'flauz.browser.showPolicy',
		'flauz.browser.verifyPolicy',
		'flauz.browser.checkUrl',
		'flauz.browser.evaluate',
		'flauz.browser.openSession',
		'flauz.browser.closeSession',
		'flauz.browser.sessions',
		'flauz.browser.navigate',
		'flauz.browser.screenshot'
	];
	const missing = expected.filter(function (name) { return commands.indexOf(name) === -1; });
	row('driver.command-surface', missing.length === 0, missing.length === 0
		? 'all ten flauz.browser.* commands are registered in the booted workbench'
		: 'missing commands after activation: ' + missing.join(', '));

	// driver.session-open-workbench: an agent session OPENS through the real
	// workbench host adapter (window.openBrowserTab + startCDPSession + the
	// hardening commands -- the P0 posture boot fact). No startUrl: the tab
	// mints at about:blank (network-free).
	const opened = asRecord(await vscode.commands.executeCommand('flauz.browser.openSession', {
		initiator: 'agent',
		agentId: AGENT_ID
	}));
	const openedDescriptor = asRecord(opened !== undefined ? opened.descriptor : undefined);
	const partition = openedDescriptor !== undefined && typeof openedDescriptor.partition === 'string' ? openedDescriptor.partition : '';
	const tabs = openedDescriptor !== undefined && Array.isArray(openedDescriptor.tabs) ? openedDescriptor.tabs : [];
	const openOk = opened !== undefined
		&& openedDescriptor !== undefined && openedDescriptor.state === 'active'
		&& /^persist:flauz-[0-9a-f]{16}-boot-drill$/.test(partition)
		&& tabs.length >= 1
		&& opened.error === undefined;
	row('driver.session-open-workbench', openOk, openOk
		? 'agent session opened through the real workbench host adapter: state=active partition=' + partition + ' tabs=' + tabs.length + ' (window.openBrowserTab + BrowserTab.startCDPSession + hardening over the real session)'
		: 'unexpected openSession result: ' + JSON.stringify(opened).slice(0, 400));
	observed.openedSession = opened;

	const sessionId = openedDescriptor !== undefined && typeof openedDescriptor.sessionId === 'string' ? openedDescriptor.sessionId : undefined;
	if (sessionId === undefined) {
		// Without a live session the remaining rows cannot run; fail loudly and
		// write the report (never leave the evaluator waiting for a file).
		row('driver.navigate-denied', false, 'no live session to navigate (openSession did not produce a sessionId)');
		row('driver.navigate-allowed', false, 'no live session to navigate (openSession did not produce a sessionId)');
		row('driver.sessions-audit', false, 'no session to audit');
		row('driver.session-close', false, 'no session to close');
		return;
	}

	// driver.navigate-denied: a policy-DENIED navigation on the LIVE session
	// sends ZERO CDP commands and returns the typed denial + evidence row.
	const deniedNav = asRecord(await vscode.commands.executeCommand('flauz.browser.navigate', {
		sessionId: sessionId,
		url: DENIED_URL
	}));
	const deniedNavVerdict = asRecord(deniedNav !== undefined ? deniedNav.verdict : undefined);
	const deniedNavRow = asRecord(deniedNav !== undefined ? deniedNav.evidenceRow : undefined);
	const navDeniedOk = deniedNav !== undefined
		&& deniedNav.sent === false
		&& deniedNavVerdict !== undefined && deniedNavVerdict.decision === 'deny' && deniedNavVerdict.layer === 'driver'
		&& deniedNavRow !== undefined && deniedNavRow.kind === 'note' && typeof deniedNavRow.sha256 === 'string' && /^[0-9a-f]{64}$/.test(deniedNavRow.sha256);
	row('driver.navigate-denied', navDeniedOk, navDeniedOk
		? 'denied navigation sent ZERO CDP commands (sent=false) with the typed deny/driver verdict + evidence row'
		: 'unexpected denied navigate result: ' + JSON.stringify(deniedNav).slice(0, 400));
	observed.deniedNavigation = deniedNav;

	// driver.navigate-allowed: the allowed navigation SENDS Page.navigate over
	// the real workbench session. sent=true is the wire fact (the CDP command
	// goes over the session regardless of network reachability of the URL);
	// the COMMIT observation is network-dependent and is recorded as observed
	// data only -- never faked, never gated.
	const allowedNav = asRecord(await vscode.commands.executeCommand('flauz.browser.navigate', {
		sessionId: sessionId,
		url: ALLOWED_URL
	}));
	row('driver.navigate-allowed', allowedNav !== undefined && allowedNav.sent === true, allowedNav !== undefined && allowedNav.sent === true
		? 'Page.navigate sent over the real workbench CDP session (sent=true); commit observation recorded: ' + JSON.stringify({
			committedUrl: allowedNav.committedUrl,
			errorCode: allowedNav.error !== undefined ? allowedNav.error.code : undefined
		})
		: 'the allowed navigation did not send (transport/surface failure): ' + JSON.stringify(allowedNav).slice(0, 400));
	observed.allowedNavigation = allowedNav;

	// driver.sessions-audit: the audit list carries the session.
	const sessions = await vscode.commands.executeCommand('flauz.browser.sessions');
	const sessionList = Array.isArray(sessions) ? sessions : [];
	const audited = sessionList.filter(function (entry) {
		const record = asRecord(entry);
		return record !== undefined && record.sessionId === sessionId;
	});
	row('driver.sessions-audit', audited.length === 1, audited.length === 1
		? 'the audit list carries the session ' + sessionId
		: 'session ' + sessionId + ' missing from the sessions audit list (' + sessionList.length + ' entries)');

	// driver.session-close: closeSession seals the session cleanly.
	const closed = asRecord(await vscode.commands.executeCommand('flauz.browser.closeSession', {
		sessionId: sessionId
	}));
	const closedDescriptor = asRecord(closed !== undefined ? closed.descriptor : undefined);
	const closeOk = closed !== undefined
		&& closed.error === undefined
		&& closedDescriptor !== undefined && (closedDescriptor.state === 'closed' || (typeof closed === 'object' && closed.state === 'closed'));
	row('driver.session-close', closeOk, closeOk
		? 'session ' + sessionId + ' closed (tabs closed, audit list keeps it)'
		: 'unexpected closeSession result: ' + JSON.stringify(closed).slice(0, 400));
	observed.closedSession = closed;

	observed.drillDurationMs = Date.now() - startedAt;
}

function activate(context) {
	// The drill runs detached from activation (the workbench must not wait on
	// it); every failure lands as a row and the report is ALWAYS written.
	void runDrill(require('vscode'))
		.then(function () { return writeReport(require('vscode')); })
		.catch(function (err) {
			row('driver.internal-error', false, err !== undefined && err.message !== undefined ? err.message : String(err));
			return writeReport(require('vscode'));
		});
}

module.exports = { activate: activate };
