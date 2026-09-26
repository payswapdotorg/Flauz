# Flauz Browser Policy (extensions/flauz-browser)

Wave 4, Lane I (worker `flauz-I-w4`). The layered browser navigation policy
engine for Flauz's agent browser surface: driver-side allowlist (AUTHORITATIVE
for agent-initiated navigation) + webRequest rules + will-navigate rules +
per-workspace/agent partition containment, with
`.flauz/browser-policy.json` as the per-workspace, git-diffable policy source.

Basis: `docs/BROWSER-ARCHITECTURE.md` section 5 (branch `wave1/b-browser-ux`,
flauz-code-lab) + DL-6 + `docs/SECURITY-MODEL.md` section 4 (branch
`wave2/d-license-security`). The B1c finding drives the design: CDP-initiated
navigations BYPASS the Electron `will-navigate` event, so layered gates are
mandatory — a navigation that skips will-navigate must STILL be denied by the
driver + webRequest layers.

See `INTEGRATION-GAP.md` (same directory) for the tree-cited analysis of what
extension-land owns vs. what only a product-side change can wire into the
in-tree browser platform (`src/vs/platform/browserView/`,
`src/vs/platform/networkFilter/`).

## The policy file

`.flauz/browser-policy.json` (workspace root, schema `flauz.browser-policy/v0`):

```json
{
	"schemaVersion": 0,
	"driver": {
		"allow": ["*.example.com", "docs.flauz.dev"],
		"deny": ["evil.example.com"],
		"fileRoots": ["/tmp/trusted-exports", ".flauz"],
		"enabled": true
	},
	"webRequest": {
		"allow": ["*.example.com"],
		"deny": ["tracker.example.net"]
	},
	"willNavigate": {
		"allow": ["*"],
		"deny": ["phishing.example.org"]
	},
	"partitions": {
		"scope": "persist",
		"perAgent": false
	}
}
```

- Every key except `schemaVersion` is optional; omitted layers default to
  deny-all with the layer enabled (fail-closed).
- Host patterns follow the in-tree network-filter semantics
  (`networkFilterService.ts:26-35`): both lists empty = deny all; the denied
  list always wins; `*.example.com` covers subdomains AND the suffix itself;
  `*` allows everything not denied. Patterns accept bare hosts, URLs
  (authority wins), `user@host`, `host:port`, and bracketed IPv6 (`[::1]`);
  they are normalized and validated at load.
- `driver.fileRoots` (driver layer only): trusted `file://` roots, absolute
  POSIX or workspace-relative. `file://` outside them is denied at the driver
  layer (the engine-side analog of the tree's trusted-file-roots gate,
  `browserSession.ts:341-347`).
- `enabled: false` on a layer is the kill-switch used by the B1c insurance
  tests: the layer never denies and the OTHERS must carry every deny. Killing
  every gate on a path yields a fail-closed deny (never an open).
- `partitions.scope`: `persist` (default) -> `persist:flauz-<hash>` durable
  jar; `memory` -> in-memory `flauz-<hash>`. `partitions.perAgent: true`
  appends `-<agent-id>` (agent ids match `[A-Za-z0-9._-]{1,64}`). The
  workspace hash is sha256(root)[0..16].
- Missing file: builtin deny-all default (with a logged warning). Broken
  file: deny-all default + the typed error carried on every verdict
  (`[policy file invalid: FLAUZ_POLICY_SCHEMA]`).

## Semantics (pinned by tests)

1. **Deny at any layer wins.** The combined verdict reports the first denying
   layer in precedence order `partition > driver > webRequest > willNavigate`.
2. **The driver deny is authoritative** for agent-tool navigations: it wins
   even when every other layer allows. A driver ALLOW never overrides another
   layer's deny (the B1c insurance precondition).
3. **Layer firing model (B1c):** `agent-tool` navigations (CDP
   `Page.navigate` via the browser tool) consult driver + webRequest —
   will-navigate never fires for them. `user` navigations consult
   willNavigate + webRequest — the agent allowlist does not gate humans.
4. **Fail-closed everywhere:** missing/broken policy file, unparseable URL,
   non-drivable scheme at the driver layer (`data:`, `chrome:`, ...), file://
   outside trusted roots, and every-gate-kill-switched paths are all denied.
5. **Post-commit reconciliation:** `reconcileCommittedUrl` flags a violating
   committed URL and recommends the `about:blank` forced reset
   (SECURITY-MODEL section 4 F2).

Divergences from the tree filter (documented, deliberate): no implicit
localhost exemption (the tree exempts localhost only on rewritten tunnel
URLs, `browserToolHelpers.ts:239`); policy patterns require bracketed IPv6;
the driver layer denies schemes the raw filter would pass.

## Commands (activation: `onCommand:flauz.browser.*` only)

| Command | What it does |
|---|---|
| `flauz.browser.setPolicy` | Opens `.flauz/browser-policy.json`, creating a deny-all starter template if absent |
| `flauz.browser.showPolicy` | Dumps the effective policy (source, per-layer rules, warnings) to the output channel |
| `flauz.browser.verifyPolicy` | Re-validates the file; PASS, or FAIL with code + JSON path |
| `flauz.browser.checkUrl` | Evaluates a URL at every layer for BOTH initiator classes and logs the verdict table |
| `flauz.browser.evaluate` | Machine surface for the Agent Bridge: `{ url, initiator?, partition?, workspaceRoot? }` -> combined verdict object |

The activation log lines (`flauz.browser: effective policy ...`,
`flauz.browser: policy file INVALID ...`) are the grep targets of the
B-POLICY canary (`build/flauz/canaries/B-POLICY.md`).

## Evidence seam

`toEvidenceRow(verdict, taskId)` maps a verdict onto the flauz-workspace
ledger row shape (`{ kind: 'note', uri, sha256, note }`), with `sha256` over
the canonical verdict core (same canonicalization as
`extensions/flauz-workspace/src/api.ts`). The proposed flow (Agent Bridge ->
`flauz.workspace.appendEvidence`) is documented in `INTEGRATION-GAP.md`
section 5; nothing in flauz-workspace is modified.

## Development

Zero dependencies; Node >= 20 stdlib only (runs under plain `node --test`
type-stripping and inside the extension host).

```sh
cd extensions/flauz-browser
npm run typecheck   # tsc --noEmit (typescript 5.9.x)
npm run test        # node --test "test/*.test.ts"  (96 cases)
```

Fixtures live at the repo root: `test/fixtures/browser-policy/` (good/bad
policy files, the CDP-bypass case matrix, the partition-name matrix).
