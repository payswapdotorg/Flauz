# Flauz Environments (Wave 4, Lane J)

The Flauz environment registry: typed environment descriptors persisted at
`.flauz/environments.json` (`flauz.environments/v0`), descriptor-level
provider adapters for the four v0 environment kinds, connection-plan
generation (the v0 artifact — **no live connections**), and the env-switch
session-continuity model (N-8, re-open-based).

## Layout

- `src/api.ts` — descriptor/envelope types, validation predicates, canonical
  serialization (DL-9 discipline), `FileSystemPort`/`Clock` ports.
- `src/registry.ts` — `EnvironmentRegistry`: bootstrap / register /
  unregister / list / get / activate / deactivate / `planFor`; atomic
  tmp+rename persistence; sorted-by-id stable diffs; `parseEnvelope` with
  index-context errors.
- `src/providers/` — the four v0 provider adapters (`ssh`, `container`,
  `cloud-sandbox`, `workspace-remote`) + dispatch (`index.ts`). Each adapter
  validates its kind-specific connection shape and generates a
  `flauz.connectionPlan/v0` document whose steps carry tree citations
  (the plan is the artifact). The SSH adapter encodes the AHP RemoteProxy
  bridge handshake (`VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN` +
  `--agent-host-bridge-port`, mutually exclusive with `--agent-host-port`).
- `src/continuity.ts` — the N-8 model: persists/re-hydrates/lost artifact
  canon (16 surfaces), the switch state machine, `planSwitch` documents,
  and the PERF 5.5 overhead-accounting hooks (`code/flauz/*` mark pairs).
- `src/extension.ts` — the thin vscode wiring: command-driven activation
  only (`onCommand:flauz.env.*`; activation-lint R3 keeps this extension off
  `onStartupFinished`). No resolver registration and no live connections in
  v0 — see `INTEGRATION-GAP.md` for the Wave-4-next wiring steps.
- `test/` — `node --test` suites (registry / providers / continuity /
  fixtures). Zero dependencies; Node >= 23.6 (type stripping). The repo
  fixture matrix lives at `test/fixtures/environments/` (repo root).

## Commands

`flauz.env.list` / `flauz.env.register` / `flauz.env.unregister` /
`flauz.env.activate` / `flauz.env.deactivate` / `flauz.env.showPlan` /
`flauz.env.switch` (plans the re-open switch and returns the switch plan).

## Security posture

- Secrets are never persisted: bridge tokens and cloud API keys are
  vault-style references (`vault:...` / `env:...`), validated at the schema
  level (literal keys are rejected) — SECURITY-MODEL 3.5.
- Trust posture is part of the descriptor (`trusted|untrusted|unknown` +
  workspace-trust inheritance); cloud sandboxes default to the untrusted
  read-only tier posture (SECURITY-MODEL 3.4).

## Development

```
npm run typecheck   # tsc --noEmit (uses the vendored vscode.d.ts)
npm run test        # node --test "test/*.test.ts"
node build/flauz/scripts/env-registry-canary.mjs   # from the repo root
```
