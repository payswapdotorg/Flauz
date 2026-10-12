/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production deploy: the deployment-workspace assembler
 * (node, zero-dep). Copies the built vscode-web distribution + the
 * deploy api functions + the ops common modules (the api imports) +
 * vercel.json + a minimal package.json (the @neondatabase/serverless
 * dep) into deploy-ws/. Prints the file census.
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
        version: '0.2.0',
        private: true,
        dependencies: {
                '@neondatabase/serverless': '^1.0.0',
        },
};
writeFileSync(join(deployWs, 'package.json'), JSON.stringify(minimalPackageJson, null, 2) + '\n');
fileCount += 1;
console.log(`  wrote package.json: ${join(deployWs, 'package.json')}`);

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
