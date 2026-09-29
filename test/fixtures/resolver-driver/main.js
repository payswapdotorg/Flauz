/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// C-ENV resolver rung 2 (TL3-H1) workbench boot drill driver -- CI TEST
// INFRASTRUCTURE, not a Flauz product extension.
//
// Mechanism (the TL3-H2 b-policy-boot-drill precedent, documented in the
// cenv-resolver-rung2 job header): the ONLY architecture-allowed invocation
// surface for the flauz.env.* command surface is
// vscode.commands.executeCommand (the product extension activates lazily
// onCommand:flauz.env.*). --extensionTestsPath boots hang on public
// runners (the first real run waited 52 minutes and died at the job
// timeout; run 36492061309) -- the driver-extension + evaluator pattern is
// the proven boot-drill shape of this repo.
//
// What it does (the R1/R2/R3 rows of the original registrationDrill, now
// driven through the REAL command machinery in the BOOTED workbench):
//
//   driver.flaus-extension-present  flauz.flauz-environments is in the registry
//   driver.resolver-registered      flauz.env.resolver reports registered=true,
//                                   prefix flauz-env, the pinned grammar, all
//                                   four kinds -- reachable ONLY when
//                                   activate() found the proposed
//                                   registerRemoteAuthorityResolver surface
//                                   live (the resolvers grant; the A3-class
//                                   tripwire complements this log-side)
//   driver.activation-triggered     the executeCommand above activated the
//                                   built-in (isActive=true)
//   driver.resolve-malformed        a non-flauz authority -> AUTHORITY_MALFORMED
//   driver.resolve-absent           an unregistered flauz-env authority ->
//                                   ENVIRONMENT_ABSENT
//   driver.trust-refused-unproven   a TRUSTED environment with NO PIN-2 entry
//                                   (registered, never created) -> TRUST_REFUSED
//   driver.trust-refused-untrusted  an UNTRUSTED environment -> TRUST_REFUSED
//
// The report lands at <workspace>/.flauz/resolver-drill/driver-report.json;
// the CI evaluator (build/flauz/scripts/cenv-resolver-boot-drill.mjs)
// polls for it and asserts the log-corpus side (activation record +
// proposal trip-wires).
//
// Honesty law: every row records the exact observed detail; a row the
// driver cannot observe fails loudly with the reason (never a fake pass).
//
// Zero dependencies: plain CommonJS + the vscode API surface only.
// ASCII only. Tabs for indentation.
// ---------------------------------------------------------------------------------------------

'use strict';

const FLAUZ_ENV_ID = 'flauz.flauz-environments';
const REPORT_SCHEMA = 'flauz.cenv-resolver-boot-driver/v0';
const EXTENSION_WAIT_MS = 60000;
const EXTENSION_POLL_MS = 500;

const rows = [];
const observed = {};

function row(id, ok, detail) {
	rows.push({ id: id, ok: ok === true, detail: String(detail) });
	console.log('[cenv-resolver-boot-driver] ' + (ok === true ? 'PASS ' : 'FAIL ') + id + ' -- ' + detail);
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
		const extension = vscode.extensions.getExtension(FLAUZ_ENV_ID);
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
		console.error('[cenv-resolver-boot-driver] no workspace folder open -- cannot write the report');
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
	const dirUri = vscode.Uri.joinPath(folder.uri, '.flauz', 'resolver-drill');
	await vscode.workspace.fs.createDirectory(dirUri);
	const reportUri = vscode.Uri.joinPath(dirUri, 'driver-report.json');
	await vscode.workspace.fs.writeFile(reportUri, new TextEncoder().encode(JSON.stringify(report, null, 1) + '\n'));
	console.log('[cenv-resolver-boot-driver] report written: ' + reportUri.toString());
}

async function resolveCommand(vscode, arg) {
	return asRecord(await vscode.commands.executeCommand('flauz.env.resolve', arg));
}

async function runDrill(vscode) {
	const startedAt = Date.now();

	// driver.flaus-extension-present: the built-in must be in the registry.
	const extension = await waitForFlauzExtension(vscode);
	if (extension === undefined) {
		row('driver.flaus-extension-present', false, FLAUZ_ENV_ID + ' never appeared in vscode.extensions within ' + EXTENSION_WAIT_MS + 'ms (bundling or scanning broken)');
		return;
	}
	row('driver.flaus-extension-present', true, FLAUZ_ENV_ID + ' is in the extension registry');

	// driver.resolver-registered: the read-only registration surface. This
	// executeCommand call is ALSO the activation trigger
	// (onCommand:flauz.env.resolver) -- the real lazy-activation machinery
	// runs here. registered=true is only reachable when activate() found the
	// proposed registerRemoteAuthorityResolver surface live (the grant).
	const surface = asRecord(await vscode.commands.executeCommand('flauz.env.resolver'));
	const kinds = surface !== undefined && Array.isArray(surface.kinds) ? surface.kinds : [];
	const registeredOk = surface !== undefined
		&& surface.registered === true
		&& surface.prefix === 'flauz-env'
		&& surface.grammar === 'flauz-env+<kind>+<envId>'
		&& kinds.length === 4;
	row('driver.resolver-registered', registeredOk, registeredOk
		? 'the flauz-env authority resolver is registered in the booted workbench: prefix=' + surface.prefix + ' grammar=' + surface.grammar + ' kinds=' + kinds.length
		: 'unexpected flauz.env.resolver surface: ' + JSON.stringify(surface).slice(0, 400));
	observed.resolverSurface = surface;

	// driver.activation-triggered: the executeCommand above must have
	// ACTIVATED the built-in (the onCommand activation machinery).
	const activated = extension.isActive === true;
	row('driver.activation-triggered', activated, activated
		? FLAUZ_ENV_ID + ' isActive=true after the flauz.env.resolver executeCommand (the ExtensionService activation record is asserted log-side by the evaluator)'
		: FLAUZ_ENV_ID + ' did not activate on the command invocation (isActive=false)');

	if (!registeredOk) {
		// Without the command surface the resolution rows cannot run; fail
		// loudly and write the report (never leave the evaluator waiting).
		row('driver.resolve-malformed', false, 'no resolver surface to resolve through (the registration row failed)');
		row('driver.resolve-absent', false, 'no resolver surface to resolve through (the registration row failed)');
		row('driver.trust-refused-unproven', false, 'no resolver surface to resolve through (the registration row failed)');
		row('driver.trust-refused-untrusted', false, 'no resolver surface to resolve through (the registration row failed)');
		return;
	}

	// driver.resolve-malformed: a non-flauz authority is typed garbage.
	const malformed = await resolveCommand(vscode, { authority: 'ssh-remote+not-ours' });
	const malformedFailure = asRecord(malformed !== undefined ? malformed.failure : undefined);
	const malformedOk = malformed !== undefined
		&& malformed.ok === false
		&& malformedFailure !== undefined && malformedFailure.code === 'AUTHORITY_MALFORMED';
	row('driver.resolve-malformed', malformedOk, malformedOk
		? 'a non-flauz authority fails typed: AUTHORITY_MALFORMED (the pure grammar reached from the workbench)'
		: 'unexpected malformed-resolution result: ' + JSON.stringify(malformed).slice(0, 400));
	observed.malformedResolution = malformed;

	// driver.resolve-absent: an unregistered flauz-env authority.
	const absent = await resolveCommand(vscode, { authority: 'flauz-env+ssh-local+env-not-registered-anywhere' });
	const absentFailure = asRecord(absent !== undefined ? absent.failure : undefined);
	const absentOk = absent !== undefined
		&& absent.ok === false
		&& absentFailure !== undefined && absentFailure.code === 'ENVIRONMENT_ABSENT';
	row('driver.resolve-absent', absentOk, absentOk
		? 'an unregistered flauz-env authority fails typed: ENVIRONMENT_ABSENT'
		: 'unexpected absent-resolution result: ' + JSON.stringify(absent).slice(0, 400));
	observed.absentResolution = absent;

	// driver.trust-refused-*: the both-directions trust-gate law at the
	// command level. Two registered environments: one trusted (but never
	// created -- NO PIN-2 lifecycle entry), one untrusted.
	const registrations = [
		['env-drill-local', 'trusted'],
		['env-drill-untrusted', 'untrusted']
	];
	for (let i = 0; i < registrations.length; i++) {
		const entry = registrations[i];
		await vscode.commands.executeCommand('flauz.env.register', {
			id: entry[0],
			kind: 'workspace-remote',
			label: 'TL3-H1 drill ' + entry[0],
			connection: { authorityPrefix: 'flauz-drill' },
			trust: { posture: entry[1], inheritsWorkspaceTrust: false },
			capabilities: { browser: true, exec: true, agentHost: true, terminal: true }
		});
	}
	try {
		const unproven = await resolveCommand(vscode, 'env-drill-local');
		const unprovenFailure = asRecord(unproven !== undefined ? unproven.failure : undefined);
		const unprovenOk = unproven !== undefined
			&& unproven.ok === false
			&& unprovenFailure !== undefined && unprovenFailure.code === 'TRUST_REFUSED';
		row('driver.trust-refused-unproven', unprovenOk, unprovenOk
			? 'a TRUSTED environment with NO PIN-2 lifecycle entry never resolves: TRUST_REFUSED (the unproven backing refuses)'
			: 'an environment without a PIN-2 entry must never resolve: ' + JSON.stringify(unproven).slice(0, 400));
		observed.unprovenResolution = unproven;

		const untrusted = await resolveCommand(vscode, 'env-drill-untrusted');
		const untrustedFailure = asRecord(untrusted !== undefined ? untrusted.failure : undefined);
		const untrustedOk = untrusted !== undefined
			&& untrusted.ok === false
			&& untrustedFailure !== undefined && untrustedFailure.code === 'TRUST_REFUSED';
		row('driver.trust-refused-untrusted', untrustedOk, untrustedOk
			? 'an UNTRUSTED environment never resolves: TRUST_REFUSED (even before any backing exists)'
			: 'an untrusted environment must never resolve: ' + JSON.stringify(untrusted).slice(0, 400));
		observed.untrustedResolution = untrusted;
	} finally {
		for (let i = 0; i < registrations.length; i++) {
			try {
				await vscode.commands.executeCommand('flauz.env.unregister', registrations[i][0]);
			} catch (err) {
				console.error('[cenv-resolver-boot-driver] cleanup unregister failed for ' + registrations[i][0] + ': ' + (err !== undefined && err.message !== undefined ? err.message : String(err)));
			}
		}
	}

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
