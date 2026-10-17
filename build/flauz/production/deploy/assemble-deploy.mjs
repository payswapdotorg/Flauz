/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production deploy: the deployment-workspace assembler
 * (node, zero-dep). Copies the built vscode-web distribution + the
 * deploy api functions + the ops common modules (the api imports) +
 * vercel.json + a minimal package.json (the @neondatabase/serverless
 * dep) into deploy-ws/, then PRE-RENDERS the workbench shell html (the
 * W7 round-2 discovery: the dist's workbench.html is the RAW TEMPLATE —
 * unsubstituted {{WORKBENCH_*}} placeholders — and the shell boot js
 * JSON.parse's the configuration meta strictly, so a static deploy
 * serves a dead boot without this step). Prints the file census.
 *
 * Usage: node build/flauz/production/deploy/assemble-deploy.mjs
 * (run from the repo root after `npm run gulp vscode-web`)
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '..', '..', '..', '..');
const deployWs = join(repoRoot, 'deploy-ws');
const vscodeWebSrc = join(repoRoot, 'vscode-web');
const apiSrc = join(repoRoot, 'build', 'flauz', 'production', 'deploy', 'api');
const opsCommonSrc = join(repoRoot, 'build', 'flauz', 'production', 'ops', 'common');
const vercelJsonSrc = join(repoRoot, 'build', 'flauz', 'production', 'deploy', 'vercel.json');

// Clean the deploy workspace.
rmSync(deployWs, { recursive: true, force: true });
mkdirSync(deployWs, { recursive: true });

let fileCount = 0;

function countFiles(dir) {
        const entries = readdirSync(dir);
        for (const entry of entries) {
                const full = join(dir, entry);
                const stat = statSync(full);
                if (stat.isDirectory()) {
                        countFiles(full);
                } else {
                        fileCount += 1;
                }
        }
}

function copyDir(src, dest, label) {
        if (!existsSync(src)) {
                throw new Error(`assemble-deploy: source not found: ${src} (${label})`);
        }
        mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
        countFiles(dest);
        console.log(`  copied ${label}: ${src} -> ${dest}`);
}

console.log('assemble-deploy: assembling the deployment workspace...');

// 1. The built vscode-web distribution (the static files).
copyDir(vscodeWebSrc, join(deployWs, 'vscode-web'), 'vscode-web');

// 2. The deploy api functions (the serverless runtime seam).
copyDir(apiSrc, join(deployWs, 'api'), 'api');

// 3. The ops common modules (the api imports - the contract + kit).
copyDir(opsCommonSrc, join(deployWs, 'ops', 'common'), 'ops/common');

// 4. vercel.json (the deployment config).
if (!existsSync(vercelJsonSrc)) {
        throw new Error(`assemble-deploy: source not found: ${vercelJsonSrc} (vercel.json)`);
}
writeFileSync(join(deployWs, 'vercel.json'), readFileSync(vercelJsonSrc));
fileCount += 1;
console.log(`  copied vercel.json: ${vercelJsonSrc} -> ${join(deployWs, 'vercel.json')}`);

// 5. A minimal package.json (the @neondatabase/serverless dep).
const minimalPackageJson = {
        name: 'flauz-deploy',
        version: '0.2.1',
        private: true,
        dependencies: {
                '@neondatabase/serverless': '^1.0.0',
        },
};
writeFileSync(join(deployWs, 'package.json'), JSON.stringify(minimalPackageJson, null, 2) + '\n');
fileCount += 1;
console.log(`  wrote package.json: ${join(deployWs, 'package.json')}`);

// 6. The workbench shell PRE-RENDER (the W7 round-2 discovery, binding).
//
// The dist's out/vs/code/browser/workbench/workbench.html is the RAW
// TEMPLATE the vscode web server would normally substitute at request
// time. A STATIC deploy has no server: without this step the served
// document carries {{WORKBENCH_WEB_BASE_URL}}/out/... module srcs that
// never resolve and a configuration meta whose raw-quoted JSON the HTML
// parser truncates at the first quote — the shell's JSON.parse throws
// before the workbench ever boots. The pre-render applies the exact
// substitutions the server would: the empty-workspace configuration
// (entity-escaped — the parser decodes entities, JSON.parse then sees
// valid JSON), the empty base URL (relative resolution from the deploy
// origin), the empty nonce (no CSP header on static hosting), the NLS
// URLs, and the icon/manifest hrefs remapped to the dist-root copies
// (the dist carries favicon.ico/manifest.json/code-192.png at its root,
// not under resources/server/).
const workbenchHtmlPath = join(deployWs, 'vscode-web', 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html');
if (!existsSync(workbenchHtmlPath)) {
        throw new Error(`assemble-deploy: workbench shell html not found: ${workbenchHtmlPath} (build the 'web' target with the browser shell entry — the a7dd3094 completeness repair)`);
}
const substitutions = [
        ['{{WORKBENCH_SCRIPT_NONCE}}', ''],
        ['{{WORKBENCH_WEB_CONFIGURATION}}', '{&quot;workspaceId&quot;:&quot;&quot;,&quot;folders&quot;:[]}'],
        ['{{WORKBENCH_WEB_BASE_URL}}', ''],
        ['{{WORKBENCH_AUTH_SESSION}}', ''],
        ['{{WORKBENCH_NLS_FALLBACK_URL}}', '/out/nls.messages.js'],
        ['{{WORKBENCH_NLS_URL}}', '/out/nls.messages.js'],
        ['href="/resources/server/code-192.png"', 'href="/code-192.png"'],
        ['href="/resources/server/favicon.ico"', 'href="/favicon.ico"'],
        ['href="/resources/server/manifest.json"', 'href="/manifest.json"'],
];
let html = readFileSync(workbenchHtmlPath, 'utf8');
let applied = 0;
for (const [placeholder, value] of substitutions) {
        if (html.includes(placeholder)) {
                html = html.split(placeholder).join(value);
                applied += 1;
        }
}
if (applied === 0 && html.includes('{{WORKBENCH_')) {
        // An unsubstituted WORKBENCH placeholder survived the map above:
        // the template grew a new placeholder — fail loudly rather than
        // deploy a dead boot (the honest-surface law).
        throw new Error('assemble-deploy: unknown {{WORKBENCH_*}} placeholder survived the pre-render map — extend the substitutions');
}
writeFileSync(workbenchHtmlPath, html);
console.log(`  pre-rendered the workbench shell html: ${workbenchHtmlPath} (${applied}/9 substitution families applied)`);

console.log('');
console.log(`assemble-deploy: DONE - ${fileCount} files in deploy-ws/`);
console.log('');
console.log('deploy-ws/ structure:');
console.log('  deploy-ws/');
console.log('    vscode-web/     the static distribution (the workbench)');
console.log('    api/            the serverless functions (healthz, status, evidence)');
console.log('    ops/common/     the ops contract + kit (the api imports)');
console.log('    vercel.json     the deployment config');
console.log('    package.json    the minimal deploy manifest (@neondatabase/serverless)');
console.log('');
console.log('next: cd deploy-ws && npm install && npx vercel deploy --prod --yes');
