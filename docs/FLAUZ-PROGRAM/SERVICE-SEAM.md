# Flauz Service Seam — Wire Protocol Specification (TL1-003)

Status: AUTHORITATIVE for the client-to-Flauz-service integration seam.
Owner: TL1 (substrate, upstream compatibility, product integration).
Implemented at: `extensions/flauz-agent/core/protocol.mjs` (definition),
`extensions/flauz-agent/core/service.mjs` (service side), and
`extensions/flauz-agent/src/seamClient.ts` (client side).
Conformance: `extensions/flauz-agent/test/protocol.conformance.test.ts`
(spawns the REAL service over stdio; every rule below has a firing case).
Protocol versions: `flauz.seam/v0` (frozen), `flauz.seam/v1` (current).

## 1. What this seam is

The service seam is the ONE stable way feature teams (TL2/TL3/TL4) talk to a
Flauz service process: commands, events, health, lifecycle and (skeleton)
auth. It is deliberately the smallest stable surface — a stdio
newline-delimited JSON protocol a zero-dependency Node service speaks — so
every feature TL can integrate without importing service internals and
without coupling to an implementation (ARCHITECTURE-LOCK §4 placement: the
"separate Flauz service" rung; §5: cross-TL work flows through contract
families such as FlauzEventEnvelope, never shared internals).

Hard rule: **adopt namespaces, not implementations.** If your feature needs
something the registry below does not offer, you extend the protocol
additively (§5) — you never import `core/service.mjs` internals or reach
around the wire.

## 2. Transport and framing (all versions)

- The client spawns the service (`node core/service.mjs <workspaceRoot>`)
  and speaks newline-delimited JSON over stdio (one UTF-8 JSON value per
  line, `\n`-terminated).
- Handshake-first: NOTHING is dispatchable before `hello` except the legacy
  `ping` / `shutdown` bare commands (v0-carried exception). Any other
  pre-hello request answers `service not ready: send hello first`.
- Unknown/malformed input never kills the service: an unparseable line
  answers a `type: "error"` line and the session continues.
- Exit codes: `0` normal (stdin EOF, SIGTERM, shutdown command), `2` usage
  (no workspace root), `3` workspace init failure, `4` protocol version
  mismatch (`SEAM_EXIT_PROTOCOL_MISMATCH`).

## 3. Versioning policy

- **v0 (`flauz.seam/v0`) is frozen forever.** Its wire shapes (§6) are
  byte-compatible: a v0-only client keeps working against every future
  service, and a v0-only service keeps working against every future client.
  The conformance suite pins the v0 ready line byte-for-byte.
- **Versions are additive and negotiated.** A new version only ADDS:
  ready-message fields, methods, error structure, event kinds. It never
  removes or rewrites a v0 shape. v1 (§7) is the first such extension.
- **Negotiation rules** (`negotiateProtocolVersion`, pure, in protocol.mjs):
  - `hello` may carry `protocolVersions: string[]`.
  - Field absent / `null` / not an array → **v0** (the plain-v0-hello path).
  - Array: non-string entries are ignored; the service selects the HIGHEST
    entry present in both the client's list and the service's supported
    list (`flauz.seam/v0`, `flauz.seam/v1`, ...). Client list order is not
    significant.
  - Array with NO supported entry (including `[]`) → hard mismatch: the
    service answers ONE line
    `{"type":"error","code":"flauz.err.unsupported-version","message":...,"details":{"supported":[...],"requested":[...]}}`
    and exits `4`. A v0-only client can never trigger this (it sends no
    field).
  - A repeated `hello` re-runs the whole handshake (v0-carried behavior):
    the workspace seam is re-initialized and the version is re-negotiated.
- **Deprecation ladder:** a protocol version is deprecated by ANNOUNCEMENT
  (this document + the WORK-REGISTRY entry) plus ONE full release cycle of
  dual support — never by breakage. A deprecated version keeps answering
  until its announced removal version, and removal itself is a new
  negotiated version boundary (a client offering only the removed version
  gets the structured `flauz.err.unsupported-version` rejection, not
  garbage).

## 4. Method namespace registry

The single source of truth is `SEAM_METHODS` in `core/protocol.mjs`; the
service's version gate is DERIVED from it (a registered method requested
outside its versions answers `flauz.err.unknown-method`, exactly like an
unregistered name).

| Method | Namespace | Since | Dispatchable at | Status |
|---|---|---|---|---|
| `flauz.workspace.createTask` | flauz.workspace | v0 | v0, v1 | stable |
| `flauz.workspace.appendEvent` | flauz.workspace | v0 | v0, v1 | stable |
| `flauz.workspace.listTasks` | flauz.workspace | v0 | v0, v1 | stable |
| `flauz.workspace.getTask` | flauz.workspace | v0 | v0, v1 | stable |
| `flauz.workspace.appendEvidence` | flauz.workspace | v0 | v0, v1 | stable |
| `flauz.workspace.createCheckpoint` | flauz.workspace | v0 | v0, v1 | stable |
| `flauz.workspace.verifyLedger` | flauz.workspace | v0 | v0, v1 | stable |
| `flauz.a2a.post` | flauz.a2a | v0 | v0, v1 | stable |
| `flauz.a2a.collect` | flauz.a2a | v0 | v0, v1 | stable |
| `flauz.a2a.list` | flauz.a2a | v0 | v0, v1 | stable |
| `ping` | (legacy) | v0 | v0, v1 | legacy — twin: `flauz.health.ping` |
| `shutdown` | (legacy) | v0 | v0, v1 | legacy — twin: `flauz.lifecycle.shutdown` |
| `flauz.health.ping` | flauz.health | v1 | v1 | stable |
| `flauz.health.status` | flauz.health | v1 | v1 | stable |
| `flauz.lifecycle.initialize` | flauz.lifecycle | v1 | v1 | stable, idempotent |
| `flauz.lifecycle.shutdown` | flauz.lifecycle | v1 | v1 | stable, idempotent |
| `flauz.auth.status` | flauz.auth | v0 | v0, v1 | **skeleton, fail-closed** |
| `flauz.auth.login` | flauz.auth | v0 | v0, v1 | **skeleton, fail-closed** |
| `flauz.auth.logout` | flauz.auth | v0 | v0, v1 | **skeleton, fail-closed** |

Notes:

- **Health** (v1): `flauz.health.ping` → `{pong: true, ts, protocolVersion,
  uptimeMs}`. `flauz.health.status` → `{status: 'ok', service,
  serviceVersion, protocolVersion, uptimeMs, tasks, ledgerRows, relay}`.
- **Lifecycle** (v1), graceful and idempotent by contract:
  `flauz.lifecycle.initialize` → `{initialized: true, workspaceRoot, tasks,
  ledgerRows, replay}` where `replay: true` marks a repeat call (the call
  never fails and never mutates state — it affirms and reports). A re-hello
  resets the replay marker. `flauz.lifecycle.shutdown` → `{ok: true,
  shuttingDown: true}` then exit `0`; batched repeat shutdowns are all
  answered (single exit). The v0 bare `shutdown` keeps its exact behavior.
- **Auth is a fail-closed skeleton by design** (ARCHITECTURE-LOCK §3
  security posture): NO token logic, NO secrets, at any version. Every
  `flauz.auth.*` call answers `flauz.err.not-implemented` (structured under
  v1; the `"<code>: <message>"` string projection under v0). The auth
  namespace is INTENTIONALLY ABSENT from the capability advertisement: a
  skeleton that implements nothing advertises no capability. Real auth
  semantics arrive only through a future additive protocol version with an
  explicit security review.

## 5. How feature TLs adopt the seam (migration guide)

1. **Negotiate, don't assume.** Spawn the service through `SeamClient`
   (`extensions/flauz-agent/src/seamClient.ts`) or speak the wire directly;
   the client hello already offers `['flauz.seam/v1', 'flauz.seam/v0']` and
   falls back to v0 automatically against older services. Check
   `client.protocolVersion` and `client.capabilities` after `start()`
   before using v1-only namespaces; the typed v1 wrappers
   (`healthPing`, `healthStatus`, `lifecycleInitialize`,
   `lifecycleShutdown`) reject locally with a clear message against a
   v0-only service.
2. **Use the namespaces.** TL2 (orchestration, a2a, memory): the
   `flauz.workspace.*` and `flauz.a2a.*` families plus the event envelope
   for state observation. TL3 (browser/environments/resources): health for
   sidecar liveness, lifecycle for graceful bring-up/teardown, events for
   surface refresh. TL4 (UX/verification): `flauz.health.status` for
   connectivity/degradation rows, events for live view updates.
3. **Never import service internals.** `core/service.mjs` and
   `core/contracts.mjs` implementations are not API. The typed contract
   mirrors are `core/protocol.d.mts`, `core/contracts.d.mts`,
   `core/a2a.d.mts` (types only — the .mjs files are never loaded from
   shipped extension code) and `src/types.ts`.
4. **Handling errors.** Under v1 a failed request rejects (client side)
   with `SeamProtocolError` — an `Error` subclass whose `.message` is the
   plain service message (existing `.message` matching keeps working) and
   whose `.code` / `.details` are machine-readable (§8). Under v0 the
   rejection is a plain `Error` with the string message.
5. **Extending the protocol (the ONLY sanctioned path for new surface).**
   Add the method to `SEAM_METHODS` with the version that introduces it;
   implement the handler in `core/service.mjs`; add the typed result to
   `src/types.ts` (+ `core/protocol.d.mts` when the definition module
   grows); add conformance cases; update this document (registry table,
   event catalog, error table) IN THE SAME CHANGE. New namespaces land at
   a NEW negotiated version or as additions to the current one — never by
   editing a v0 shape.
6. **Events.** Subscribe with the `onEvent` seam-client callback (v1+):
   you receive `{type: 'event', event, payload, ts}` envelopes
   (§9). Without a callback the client logs and drops them — events are
   never fatal. The v0 file-based relay (`relay.jsonl` in the extension
   globalStorage) keeps running unchanged alongside the wire events.

## 6. Wire specification — v0 (FROZEN)

Exactly the original vertical-slice contract; pinned byte-for-byte by the
conformance suite:

```
F -> G  {"type":"hello","client":"flauz-agent","version":"0.1.0","globalStoragePath":"..."}
G -> F  {"type":"ready","service":"flauz-core-service","version":"0.1.0","schema":"flauz.tasks/v0"}
F -> G  {"id":1,"cmd":"flauz.workspace.createTask","args":{"title":"..."}}
G -> F  {"id":1,"ok":true,"result":{"taskId":"T-001"}}
G -> F  {"id":2,"ok":false,"error":"<plain string message>"}        (failure)
G -> F  {"type":"error","message":"unparseable line"}               (bad input)
F -> G  {"id":3,"cmd":"shutdown"}
G -> F  {"id":3,"ok":true,"result":{"ok":true}}                     (then exit 0)
```

- Unknown hello keys (e.g. a v1 client's `protocolVersions`) are IGNORED
  by a v0 service — this is what makes the v1 client's v0 fallback work.
- Errors are PLAIN STRINGS with their exact legacy texts
  (`unknown command: <cmd>`, `service not ready: send hello first`,
  workspace validation messages).
- No wire events: stdout carries ready/error/response lines only. The
  event relay is the append-only `relay.jsonl` in the extension
  globalStorage.

## 7. Wire specification — v1 (negotiated; additive delta over v0)

Everything in §6 keeps its shape unless stated. The delta:

- **Handshake.** `hello` gains `protocolVersions: string[]` (§3). On a
  v1 negotiation the ready line gains two fields AFTER the four v0 keys:
  `{"type":"ready","service":"flauz-core-service","version":"0.1.0","schema":"flauz.tasks/v0","protocolVersion":"flauz.seam/v1","capabilities":["flauz.a2a","flauz.health","flauz.lifecycle","flauz.workspace"]}`.
  A v0 negotiation (plain hello, or an offer whose best mutual version is
  v0) answers the EXACT v0 ready line — no extra fields.
- **Structured errors.** A failed request answers
  `{"id":N,"ok":false,"error":{"code":"<flauz.err.*>","message":"...","details":{...}?}}`
  (§8). The `message` texts are the SAME strings as v0 where a v0
  equivalent exists.
- **Server-initiated events** (§9): `{"type":"event","event":...,"payload":...,"ts":...}`
  lines interleaved on stdout, only under v1.
- **New namespaces:** `flauz.health.*`, `flauz.lifecycle.*` (§4). The
  legacy `ping`/`shutdown` keep working under v1.
- **Auth skeleton:** dispatchable at every version, always
  not-implemented (§4).

## 8. Error-code table (v1; closed set)

| Code | Meaning | Fired by | v0 projection |
|---|---|---|---|
| `flauz.err.unsupported-version` | hello offered no mutually supported protocol version | handshake mismatch (error line + exit 4) | n/a (v0 clients never trigger it) |
| `flauz.err.unknown-method` | unregistered method name, or a registered method requested outside its versions | `flauz.nope`, `flauz.health.ping` under v0 negotiation | `unknown command: <cmd>` |
| `flauz.err.invalid-params` | malformed/missing argument values, or a request invalid for the current protocol state | `createTask` without a title; `appendEvent` with a bad actor; requests before hello (`details.reason: "handshake-required"`); unparseable/unrecognized lines (as `type:"error"` lines) | the exact legacy string message |
| `flauz.err.internal` | unexpected handler failure (service-side) | a2a bus rejections until the bus grows typed errors (TL2 follow-up) | the exact legacy string message |
| `flauz.err.not-implemented` | a registered skeleton method: exists, refuses, will never act | every `flauz.auth.*` call | `flauz.err.not-implemented: <message>` |

Client-side surfacing: `SeamProtocolError` (`.code`, `.message`,
`.details`); `.message` matching is unchanged from v0.

## 9. Event catalog (v1 wire events)

Envelope (field-aligned with the FlauzEventEnvelope contract family,
ARCHITECTURE-LOCK §5; stable key order):

```
G -> F  {"type":"event","event":"<name>","payload":{...},"ts":<epoch ms>}
```

Emitted exactly when the v0 file relay fires (same actions, same payload
facts, same timestamp); the `relay.jsonl` mirror keeps running unchanged.

| Event | Payload | Emitted by |
|---|---|---|
| `task-created` | `{taskId}` | `flauz.workspace.createTask` |
| `task-event` | `{taskId, type, actor, status}` | `flauz.workspace.appendEvent` |
| `evidence-row` | `{taskId, seq, kind}` | `flauz.workspace.appendEvidence` |
| `checkpoint` | `{taskId, checkpointRef}` | `flauz.workspace.createCheckpoint` |
| `a2a-message` | `{id, seq, kind, from, to}` | `flauz.a2a.post` |

New events may only be ADDED (new `event` names), never repurposed —
consumers must ignore unknown event names (the seam client does).

## 10. Compatibility proofs (what the conformance suite pins)

- v0 client ↔ v1 service: plain hello → the v0 ready line is
  BYTE-IDENTICAL (`raw` line equality), v0 string errors, v0-only offer →
  byte-exact v0 ready, no wire events on stdout, bare `shutdown` → exit 0.
- v1 client ↔ v0-only service: the frozen v0 stub
  (`test/harness/v0Service.ts`, pinned from the TL1-003 base commit)
  proves the client falls back to `flauz.seam/v0`, keeps its v0 method
  surface working, and guards the v1 wrappers locally.
- Version mismatch → structured `flauz.err.unsupported-version` + exit 4.
- Every error code, both event examples, lifecycle idempotence, malformed
  line tolerance (both versions), and the registry == dispatch consistency
  each have a dedicated firing case.

## 11. Security posture

Fail closed for agent side effects (ARCHITECTURE-LOCK §3): the auth
namespace carries no token logic and no secrets by design; no credential
material crosses this seam; events and errors never include secrets; the
service exits on protocol mismatch rather than guessing a version.
