# build/flauz — Flauz product overlay + merge tooling

Wave 3 Lane F (task W3-F-R-b). Base tree: `payswapdotorg/Flauz` @ `9bf9ae764da438b1234a8243dc9e47173ef58ee7`.
Zero-dependency Node (v18.3+; sandbox uses v24). No npm installs, no vscode builds.

## Files

| File | Purpose |
|---|---|
| `../../product.flauz.json` | The Flauz **overlay** (repo root) — see key-by-key rationale below. |
| `merge-product.mjs` | CLI + library that merges the overlay onto the upstream `product.json` with **null-deletes** semantics. |
| `product.flauz.schema.json` | JSON Schema (draft-07) describing the overlay. |
| `merge-product.test.mjs` | 5 node:test tests (`node --test build/flauz/merge-product.test.mjs`). |
| `canaries/default-agent-checklist.md` | U-1/C-20 closure spec: the D1–D11 enumeration of warning/notice surfaces under a non-Copilot default agent. |
| `stage-delivery.mjs` | **Pre-existing** (not part of this task) — transit staging of the Lane F delivery. |

## merge-product.mjs

```
node build/flauz/merge-product.mjs [--base <path>] [--overlay <path>] [--out <path|->]
```

Defaults: `--base product.json --overlay product.flauz.json --out -` (stdout), resolved against
the current working directory — run from the repo root.

Behavior:

1. Parses both files as **strict JSON** (BOMs, comments, and trailing commas are rejected with
   an error naming the file).
2. Validates the overlay's known keys **before** merging (exit 1 on violation):
   `nameShort`/`nameLong` non-empty strings; `version` a string;
   `extensionEnabledApiProposals` an object of `"publisher.name"` → array-of-strings;
   `defaultChatAgent` `null` or an object. Unknown keys are allowed but each is warned on
   stderr: `warning: product.flauz.json sets unknown key <k> (no IProductConfiguration consumer
   at 9bf9ae764da — verify before relying on it)`.
3. Merges with **null-deletes** semantics:
   - overlay value `null` → the key is **DELETED** from the merged result;
   - both values plain objects → **recursive merge**;
   - anything else (arrays, scalars) → overlay value **replaces** wholesale;
   - overlay-only keys are added; base-only keys are kept.
4. Serializes with `JSON.stringify(merged, null, '\t')` + trailing newline (upstream
   `product.json` is TAB-indented).
5. `--out -` writes to stdout; a path writes the file (parent dirs created).

Programmatic API (used by the tests): `mergeProduct(base, overlay, options?)`,
`serializeProduct(merged)`, `validateOverlay(overlay, options?)`, plus the
`KNOWN_OVERLAY_KEYS` / `PINNED_BASE_COMMIT` constants.

**Null-deletes overlay semantics = decision proposal DL-16** (recorded in the Lane F REPORT to
the TL): the overlay needs to *remove* an upstream product key (`defaultChatAgent`), and JSON has
no "delete" spelling — an explicit `null` is the merge-level delete marker. The marker is
unambiguous (upstream `defaultChatAgent` is an object, never `null`) and is enforced by
validation.

## Overlay key-by-key rationale (`product.flauz.json`)

| Key | Value | In-tree evidence | Rationale |
|---|---|---|---|
| `nameShort` / `nameLong` | `"Flauz"` | Real product keys: `product.json:2-3`; type decl `src/vs/base/common/product.ts:105-106` | Identity rebrand of the IDE (window title, about dialog, etc.). |
| `version` | `"0.1.0"` | **NOT** a key of the shipped upstream `product.json` — version is stamped at build time from `package.json` by `build/gulpfile.vscode.ts:176-205` (runtime fallback `platform/product/common/product.ts:53-60`, W3-F-r1) | Included per the v0 work-order spec; **flagged as DL-18** (version stamping conflict): the gulp build overwrites `json.version` at `:205`, so CI must reconcile the overlay value with the build stamping or the overlay's version is silently replaced in packaged builds. |
| `identifier` | *(omitted)* | No such field exists in `IProductConfiguration` (`src/vs/base/common/product.ts:99-306`) and no consumer (`grep product.identifier` → 0 hits, worklog W3-F-r1) | Deliberately **omitted** — documented as **DL-17**. The merger also warns on any such unknown key. |
| `extensionEnabledApiProposals` | `{ "flauz.flauz-agent": ["defaultChatParticipant", "chatParticipantAdditions"] }` | `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts:43-55` (product-key ingestion, keys are `"publisher.name"` case-insensitive), `:80-102` (the product list **REPLACES** the extension's own — empty — declaration; unknown proposal names are dropped with a warning at `:46-52`); participant parsing gates: `src/vs/workbench/contrib/chat/browser/chatParticipant.contribution.ts:268-274` (isDefault/modes require `defaultChatParticipant`; locations require `chatParticipantAdditions`) | Force-enables the two proposals for the `flauz.flauz-agent` built-in so its statically-contributed `isDefault` participant + `locations`/`modes` parse. This is the **DL-4** pattern: enable-for-built-ins via product overlay, zero promotion / zero fork. |
| `defaultChatAgent` | `null` | Merger null-deletes the upstream key (`product.json:90-157`: `extensionId: "GitHub.copilot"`, `chatExtensionId: "GitHub.copilot-chat"`, entitlement URLs, provider map). With the key absent, `src/vs/workbench/services/chat/common/chatEntitlementService.ts:458-460` returns early and the whole Copilot setup/entitlement stack no-ops; `src/vs/workbench/contrib/chat/common/participants/chatAgents.ts:478-484` then resolves the (non-core) `flauz.agent` participant as the sole default agent | Removes the Copilot wiring so **flauz.agent becomes the sole default agent**. Every surface this touches is enumerated with citations in `canaries/default-agent-checklist.md` (D1–D11). |
| `extensionsGallery` | *(not set)* | Upstream base ships **without** a gallery (see Deviations below); `src/vs/base/common/product.ts:147-155` (optional field) | v0 intentionally neither sets nor strips a gallery — the merged output keeps the base's (absent) posture. |

## Schema

`product.flauz.schema.json` (draft-07) describes the overlay: `nameShort`/`nameLong`/`version`
strings, `extensionEnabledApiProposals` as object of string→array-of-string, `defaultChatAgent`
as `["object", "null"]`, and `additionalProperties: true` (v0 permissive — the merger warns on
unknown keys). The schema's `description` documents the null-deletes merge semantics.

## Canary

`canaries/default-agent-checklist.md` is the U-1/C-20 closure spec (wave1/c capability matrix,
preserved read: `/home/z/my-project/tool-results/read_1790349700889_1bae23ec0ede.txt`): 11 items
(D1–D11) with per-surface expected behavior, `file:line` citations, and closure status —
5 CLOSED-BY-DESIGN, 2 VERIFY-IN-CI (D5 `chatIsEnabled`, D6 status-bar entry — Worker G / CI
scope, MIGRATION-PLAN §5), 2 N/A, 2 DOCUMENTED-DEBT.

## Deviations from the work order (documented)

- **`extensionsGallery` posture (test 4 / verification):** the work order asserted the real base
  `product.json` "has extensionsGallery". The verified in-tree evidence says otherwise — the
  upstream `product.json` @ 9bf9ae764da has **46 top-level keys and NO `extensionsGallery`**
  (worklog W3-F-r1: "no version/identifier/quality/extensionsGallery/extensionEnabledApiProposals
  keys"; re-verified during this task by direct key enumeration). The merged v0 product therefore
  also has no gallery. `merge-product.test.mjs` (test 4) pins the **actual** posture
  (`'extensionsGallery' in base === false`, and the merge preserves the base's gallery posture
  exactly); if the base ever gains a gallery, that assertion failing is the tripwire to re-check
  canary item D4. This also makes D4's documentation concretely relevant: any *future* overlay
  that re-adds `defaultChatAgent` without adding a gallery would hit the D4 setup-failure
  surfaces immediately.

## Transit staging

`stage-delivery.mjs` (pre-existing, owned by the main lane worker — do not modify here) handles
the transit staging of the Lane F delivery; this README's files are inputs to that staging, not
part of its logic.
