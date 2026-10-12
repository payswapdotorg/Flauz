# A-PROD-006-W7 production deploy surface

The Vercel serverless functions, the deployment config, the workspace
assembler, and the runbook for the Flauz web distribution's
production-real deployment (Vercel hosting + Neon Postgres).

## The runtime seam (the determinism disclosure)

The shipped ops family (`build/flauz/production/ops/**`) is fully
deterministic: the contract and kit never read a clock, never call
the random global, never read env. The serverless functions in
`api/**` are the RUNTIME SEAM - the sanctioned boundary where `now`
is constructed (`new Date().toISOString()`) and `DATABASE_URL` is
read from the function env at RUNTIME. This is disclosed as the
determinism disclosure row: the shipped code is deterministic; the
runtime seam is the boundary.

## The deployment runbook (the build-assemble-Neon-Vercel command ladder)

### 1. The web build (the repo's own canonical recipe)

```bash
cd /home/z/flauz
npm ci   # env: ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 GITHUB_TOKEN=<the PAT>
npm run gulp vscode-web    # -> vscode-web/ static distribution
```

Receipt: the dist file count + total size + the index.html sha256.

### 2. Neon (the production database)

THE API-BASE CORRECTION (station-verified, binding): `api.neon.tech`
is DNS-DEAD - NEVER use it. THE REAL API BASE: `https://console.neon.tech/api/v2`.

```bash
# Discover the org id (the /projects endpoint demands an ORG id, NOT the user id, NOT 'default'):
curl -s https://console.neon.tech/api/v2/organizations -H "Authorization: Bearer $NEON_API_KEY"

# Create the project (with the org id):
curl -s -X POST https://console.neon.tech/api/v2/projects \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"project":{"name":"flauz-production","org_id":"<the org id>"}}'

# -> project id, branch id, the connection string from the endpoints API.
# Set it as $DATABASE_URL (env only - NEVER committed):
export DATABASE_URL='postgresql://...'   # from the Neon endpoints API
```

Receipts: org id, project id, branch, endpoint host, connection string MASKED.

### 3. Vercel (the production hosting)

```bash
npx vercel@latest whoami                    # the token check - cite the user/team
npx vercel project add flauz-web            # or link an existing project
npx vercel env add DATABASE_URL production  # the Neon connection string; env-only
npx vercel env add FLAUZ_PRODUCTION_URL production  # the production URL
npx vercel env add FLAUZ_VERSION production  # '0.2.0'

# Assemble the deployment workspace:
node build/flauz/production/deploy/assemble-deploy.mjs

# Deploy:
cd deploy-ws && npm install && npx vercel deploy --prod --yes
```

Receipts: project id, deployment id, the production URL.

### 4. The schema (one ensureSchema execution against the LIVE Neon)

```bash
# A one-shot node script in the deploy workspace, DATABASE_URL from env:
cd deploy-ws && node -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const { PRODUCTION_LEDGER_SCHEMA_SQL } = await import('./ops/common/productionOpsContract.js');
await sql(PRODUCTION_LEDGER_SCHEMA_SQL);
console.log('ensureSchema OK (production-real)');
"
```

Receipt: ensureSchema OK (production-real).

### 5. The production smoke battery (against the LIVE production URL)

```bash
# 1. GET / -> 200 + the workbench HTML
curl -s https://<production-url>/ | head -3

# 2. Static asset spot-check: the workbench HTML's first 2 script/css hrefs resolve (200)
# (extract the hrefs from the HTML, curl each)

# 3. GET /api/healthz -> the healthy JSON - dbConnectivity: "connected" (production-real)
curl -s https://<production-url>/api/healthz

# 4. GET /api/status -> the version 0.2.0 + the ledger census
curl -s https://<production-url>/api/status

# 5. POST /api/evidence {"kind":"smoke-run","payload":{...}} -> banked -> GET /api/evidence?limit=5
curl -s -X POST https://<production-url>/api/evidence \
  -H 'Content-Type: application/json' \
  -d '{"kind":"smoke-run","payload":{"probe":"healthz","ok":true}}'
curl -s 'https://<production-url>/api/evidence?limit=5'

# 6. The ops family battery (the station re-executes):
bunx --bun mocha --ui tdd 'build/flauz/production/ops/test/common/*.test.ts'
```

## The deployment config (vercel.json)

```json
{
  "version": 2,
  "outputDirectory": "vscode-web",
  "cleanUrls": true,
  "trailingSlash": false
}
```

- `outputDirectory`: the static files live in `vscode-web/` (the built
  distribution). See https://vercel.com/docs/projects/project-configuration#outputdirectory
- `cleanUrls`: `/api/healthz` (not `/api/healthz.ts`). See
  https://vercel.com/docs/projects/project-configuration#cleanurls
- The `api/` directory at the project root is auto-detected as
  serverless functions. See https://vercel.com/docs/functions/runtimes/node-js

## The workspace assembler (assemble-deploy.mjs)

```bash
node build/flauz/production/deploy/assemble-deploy.mjs
```

Copies into `deploy-ws/`:
- `vscode-web/*` - the built distribution (the workbench)
- `api/**` - the serverless functions (healthz, status, evidence)
- `ops/common/**` - the ops contract + kit (the api imports)
- `vercel.json` - the deployment config
- `package.json` - the minimal deploy manifest (`@neondatabase/serverless` dep)

Prints the file census.

## The NO-SECRET LAW (binding)

No credential material in ANY committed file. The `DATABASE_URL` is
read from `process.env` at RUNTIME only (in the serverless
functions). The Vercel project's env settings hold the secret; the
repo never does. The report MASKS secrets (first 6 chars + total
length).
