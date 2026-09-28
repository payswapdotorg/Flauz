# Flauz Packaging Parity — Web vs Desktop (TL1-005)

Status: registry + gate + this report landed with TL1-005.
Machine contract: `build/flauz/packaging-parity.json` (the registry) checked by
`build/flauz/scripts/packaging-parity.mjs` (the gate).
This document is the human reading of that machine contract — where they
disagree, the registry wins and this document is wrong.

## 1. The question this answers

Flauz is a Code OSS fork, and Code OSS ships in two shapes: the desktop
(Electron) product and the web (server/browser) product. TL1-005 asks: what is
Flauz's story on each? Three failure modes are forbidden:

1. something desktop-only silently breaks the web build;
2. something web-shaped silently weakens a desktop capability;
3. nobody can say which surfaces are which.

The answer is a classification of every Flauz surface, pinned to evidence in
the tree, machine-checked for drift, and documented here.

## 2. The web build today, in plain language

**A web build of the current Flauz tree includes:**

- The full Code OSS web workbench (upstream, untouched — pillar 1, see
  ARCHITECTURE-LOCK section 2).
- The Flauz product identity: the `product.flauz.json` overlay rebrands the
  merged `product.json` (`nameShort`/`nameLong`), removes the Copilot default
  chat agent wiring (`defaultChatAgent: null`) and grants the proposed-API
  enables — all through the shared workbench layer, so a web product build
  would carry the same identity and the same sole-default-agent behavior
  (`flauz.agent`) as the desktop build.

**A web build of the current tree excludes:**

- Every Flauz extension. All seven `flauz-*` manifests are `main`-only with no
  `browser` entrypoint, and the web build's built-in set is filtered by
  upstream `isWebExtension()` (`build/lib/extensions.ts:351-367`): no `browser`
  field plus a `main` field means not-web. So today the web build is "Code OSS
  rebranded as Flauz with no Flauz surfaces" — honest, empty, and safe: the
  first failure mode above is structurally impossible right now because
  nothing Flauz reaches the web build at all.

**What degrades and why (the moment a browser entrypoint exists):**

The per-capability classes below are the interesting part. Each Flauz
extension already has a node-free core that is web-capable, and desktop-bound
edges that are not. The registry records, per capability:

| Class | Meaning | Examples in the current tree |
|---|---|---|
| `desktop-full` | Local-OS or desktop-workbench binding by design; the web form, when wanted, is a different provider class, not a degradation of this one | local-real environment execution (child_process), workflow shell execution, the proposed-API workbench browser tab |
| `web-degraded` | Web-capable core with a desktop-bound seam in its backing; the reduction is documented | the chat participant (task/evidence backing rides the stdio seam), the scmArtifactProvider (artifact content rides nodeFs) |
| `web-blocked` | Removable tree constraint: missing browser entrypoint, or a node: import in the current wiring | all seven packaging postures; the stdio seam transport; browser capture/journal sinks; nodeFs wiring; checkpoint signer; evidence artifacts |
| `web-full` | Zero desktop-only dependencies in the forcing surface; ships unchanged once packaged | policy engine, CDP WebSocket transport, environments registry/lifecycle core, the whole models and resources extensions, workflow envelope, task/ledger services |

The full 28-row table with per-row evidence is `build/flauz/packaging-parity.json`;
the per-extension summary is one gate run:

```sh
node build/flauz/scripts/packaging-parity.mjs --root .
```

### Per-extension posture (current tree)

- **flauz-agent** — packaging web-blocked. Participant/view surface is
  web-degraded (grants ingest host-agnostically; backing rides the seam). The
  stdio seam transport and local-disk evidence artifacts are web-blocked.
- **flauz-browser** — packaging web-blocked. Policy engine and CDP transport
  are web-full (the transport speaks the stable global WebSocket); runtime
  capture/journal sinks are web-blocked; the workbench browser-tab adapter is
  desktop-full by design.
- **flauz-environments** — packaging web-blocked. The registry/descriptor/
  lifecycle core is port-injected and web-full; local-real execution is
  desktop-full by definition (remote environment classes are separate
  providers, not a web degradation).
- **flauz-models** — packaging web-blocked, and that is the ONLY blocker: the
  entire extension is node-free. The cleanest first candidate for the Flauz
  web story.
- **flauz-resources** — packaging web-blocked; the resource graph is node-free
  and web-full. (Note: this seventh extension post-dates the work order's
  "six extensions" wording; the gate's glob-driven coverage found it and the
  registry classifies it like every other surface.)
- **flauz-workflow** — packaging web-blocked. Envelope/messaging core is
  web-full; shell execution is desktop-full; the checkpoint signer is
  web-blocked (node:crypto → WebCrypto port).
- **flauz-workspace** — packaging web-blocked. Task/ledger services are
  web-full behind the FileSystemPort; the nodeFs wiring is web-blocked; the
  scmArtifactProvider is web-degraded. This extension owns the activity-bar
  shell, so on web the whole Flauz shell is absent until this row recovers.

## 3. Capability boundaries that may NEVER be weakened

These come from ARCHITECTURE-LOCK and are restated here because web work is
exactly where they come under pressure. The parity gate is deliberately
structured so that weakening any of them shows up as DRIFT or violation:

1. **The browser two-stage strategy (ARCHITECTURE-LOCK section 3).** Stage 1
   uses existing Code OSS browser/webview mechanisms; stage 2 runs
   Chromium/CDP as a Flauz-controlled sidecar exposed through a native Flauz
   surface. TL1-005 maps this strategy; it does not revise it. In particular:
   no deep-fork of Electron to obtain a browser. The web recovery for browser
   surfaces is the endpoint-host path (a remote Flauz browser service), never
   an embedded-engine fork.
2. **The extension/core placement law (ARCHITECTURE-LOCK section 4).**
   Preferred order: stable Code OSS API, built-in Flauz extension, separate
   Flauz service, additive contrib integration, core patch only with an
   architecture decision. Every recovery path in the registry stays inside
   steps 1-3: ports, entrypoints, and services — zero `src/vs` changes.
3. **Upstream compatibility (ARCHITECTURE-LOCK section 6).** Flauz behavior
   stays isolated in additive directories; the fork-critical ledger stays
   empty (the FORK-CRITICAL guard runs in CI before anything expensive). A
   web-compatibility patch to shared upstream code would be a fork-critical
   change and is out of bounds for parity work.
4. **Fail-closed security (ARCHITECTURE-LOCK section 3, Security).** Agent
   side effects fail closed; browser policy is enforced at authoritative
   control points; agent and human browser sessions remain distinguishable.
   A web port that would route around a policy control point (e.g. moving
   CDP enforcement client-side to "make it work on web") weakens a boundary
   and is forbidden — the control point moves into the service, or it does
   not move.
5. **No regression of Code OSS capabilities (ARCHITECTURE-LOCK section 2,
   pillar 1).** Nothing about the web story may remove or degrade editor,
   terminal, git, debug, tasks, notebooks, extensions, settings,
   accessibility or remote facilities on desktop. The compat battery
   (TL4-003) is the machine check for this boundary; the parity gate is its
   packaging-shaped sibling.
6. **The proposed-API discipline (DL-4).** Grants go through
   `extensionEnabledApiProposals` in the product overlay, never through
   promotion or forks of the API surface. The registry pins all three grants
   (agent: defaultChatParticipant + chatParticipantAdditions; workspace:
   scmArtifactProvider; browser: browser) as manifest-key evidence, so any
   grant change drifts the gate until the registry is consciously updated.

## 4. Recovery paths (how web-blocked becomes web-capable without forking core)

Every recovery below stays inside the placement law: no `src/vs` changes, no
fork, no weakened boundary. Order is by leverage per effort, not by priority.

1. **flauz-models gets a browser entrypoint (the pilot).** The whole
   extension is node-free (`node-free extensions/flauz-models/src`). Adding
   `"browser": "./dist/web/extension.js"` (plus the web build wiring in the
   extension's build script) makes the provider seam the first Flauz surface
   on web and proves the pipeline end to end.
2. **flauz-workspace: a workspace.fs FileSystemPort.** The port seam already
   exists (`src/api.ts`); implement it over `vscode.workspace.fs` with
   Uri-relative paths for the browser entry, keep `nodeFs` for desktop. Task
   and ledger services are node-free and their on-disk formats do not change.
   This also restores the activity-bar shell on web (the container is a
   manifest contribution) and un-degrades the scmArtifactProvider.
3. **flauz-agent: a seam transport port.** `core/service.mjs` is a standalone
   zero-dep Node program; the stdio `SeamClient` is one transport
   implementation. A remote transport (websocket against a server-side
   service instance — the TL1-003 client-service seam is the designed
   integration point) restores full participant backing on web; until then
   the participant degrades to conversation + view state. Evidence artifacts
   port to workspace.fs/WebCrypto with unchanged formats.
4. **flauz-browser: sinks and id minting.** Session ids move from
   `node:crypto` randomBytes to WebCrypto; captures and the PIN-1 session
   journal write through workspace.fs or the service-side store. The policy
   engine and the CDP transport are already web-full. On web the browser
   surface goes through the endpoint host against a remote Flauz browser
   service (stage-2 architecture); the workbench browser-tab adapter stays
   the desktop premium surface.
5. **flauz-environments: registry first, remote executors later.** The
   registry/descriptor/lifecycle core is port-injected and web-full — ship it
   from a browser entrypoint for read/plan/status surfaces. Execution on web
   means remote environment classes (SSH, container, cloud — TL3-004) behind
   the same `EnvironmentExecutor` port; local-real execution stays
   desktop-full by definition.
6. **flauz-workflow: envelope everywhere, remote dispatch for execution.**
   Author/validate/list workflows on web (envelope + messaging are node-free);
   dispatch shell steps to a remote executor behind the existing
   `ToolExecutorPort`. The checkpoint signer ports to WebCrypto behind the
   existing signer boundary.
7. **flauz-resources: packaging only.** The resource graph is node-free;
   a browser entrypoint ships it unchanged.

**The discipline that keeps this honest:** any browser entrypoint added to a
flauz-* manifest must land in the SAME commit as a registry update (the gate
drifts otherwise: the posture row, the web-product row and possibly
class-implication rows all cite the absent `browser` key). The gate's
`--require` mode is what CI-flips the SKIP family; the report-only CI job
surfaces drift as data for the Lead.

## 5. What the gate checks (the machine contract)

`build/flauz/scripts/packaging-parity.mjs` — zero-dependency (node >= 20
stdlib), fixture-verified (`build/flauz/packaging-parity.test.mjs`,
`test/fixtures/packaging-parity/`), wired into
`build/flauz/scripts/verify-fixtures.sh` and CI (`.github/workflows/flauz-hygiene.yml`,
report-only `--no-fail`):

- **PP1** a tree with flauz-* manifests must carry a parseable, shape-valid
  registry — unclassified surfaces are violations, not blank slates;
- **PP2** glob-driven coverage: every live `extensions/flauz-*` has rows;
  rows citing vanished surfaces are DRIFT;
- **PP3** every citation re-derives from the live tree (manifest key paths
  and pinned values, `node:` imports, node-free subtrees);
- **PP4** class consistent with the constraint: `node-import` evidence forces
  `desktop-full|web-blocked`, `node-free` forces `web-full|web-degraded`, and
  the per-extension packaging posture is re-derived from the live manifest
  (main-only means web-blocked, full stop);
- **PP5** per-extension posture summary (the readable web build story).

Exit codes follow the house convention: 0 clean/SKIP, 1 drift/violation,
2 usage. The SKIP family (zero flauz manifests found) keeps the gate green on
non-Flauz trees; `--require` flips it.

## 6. Known limitations (honest list)

- This is classification + gate + docs, fixture-driven — no actual web build
  was produced or run (that is the Lead's station / TL1-002's build shell).
- The registry pins the CURRENT posture; it does not predict what upstream
  will do to `isWebExtension()` or the web packaging pipeline at future
  syncs. The sync runbook's post-sync gate sweep should include this gate.
- `compat-battery.mjs`'s positive-control list (`FLAUZ_BUILTIN_EXTENSIONS`)
  still names six extensions — it predates flauz-resources (TL3-005). That is
  a pre-existing gap in a sibling tool, outside this work order's scope;
  flagged to the Lead as follow-up.
- The `desktop-full` classification of the workbench browser-tab adapter
  rests on the vendored proposed-API surface; if upstream lands a web-side
  browser tab implementation, that row's class and evidence should be
  revisited (the gate will not drift on its own — the citation is the grant,
  not the host availability — so this is a documented judgment call).
