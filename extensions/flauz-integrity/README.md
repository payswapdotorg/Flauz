# flauz-integrity — the signing and integrity plane (A-PROD-005-W2)

The wave the W1 production gate's `signingIntegrity` NOT-YET row names: the
signing machinery for the release artifacts — **detached ed25519 signatures
over the pinned bundle artifacts**, the **signature ledger**, and the
**one-command verify** with the typed verdict table.

## The command surface (command-only activation: `onCommand:flauz.integrity.*`)

| Command | What it does |
|---|---|
| `flauz.integrity.sign` | Produces/refreshes the detached-signature ledger over the PINNED bundle artifacts (`build/flauz/security/bundle-manifest.json`): every artifact's sha256 is **re-derived live over the real bytes** (never trusted from the manifest; a live hash that disagrees with the pin = the typed `FLAUZ_INTEGRITY_PIN_MISMATCH` refusal), one ed25519 detached signature per artifact through the injected KeyPort, the ledger record binding (artifact path, re-derived sha256, algorithm id, key fingerprint, signature, clock-port timestamp), and the **self-signed chain** (the ledger's own sha256 + signature over its chain-free canonical bytes — any later edit breaks the verify-time chain check). Persists `.flauz/integrity/ledger-<stamp>.json` (`flauz.integrity-ledger/v1`), swept fail-closed, banked census-visible (evidence-ledger note row, taskId `flauz-integrity`). |
| `flauz.integrity.verify` | The one-command integrity verdict: per pinned artifact — re-hash the bytes, compare against the manifest pin (tamper signal), verify the ledger signature against the **ledger's recorded public key** (authenticity — verification is key-store-independent), check the ledger coverage. The typed verdict table: `green` / `tampered` / `unsigned` / `torn`, plus the ledger-chain row and the key-binding row. **Absent key store / absent ledger = typed degradation (`ok=false`), the record persists — never a silent green.** Persists `.flauz/integrity/verify-<stamp>.json` (`flauz.integrity-verify/v1`), swept + banked. |
| `flauz.integrity.status` | The read-only state view: the pinned artifact count, the signed coverage, the key fingerprint, the last verify verdict summary. **No state change** — nothing written, nothing banked, the key store only peeked (proven by the write-refusing fs port in the suite). |

## The key-posture disclosure (the honest boundary)

The signing key is a **LOCAL-DEV key posture**: a workspace-local ed25519
keypair generated on first sign through the injected **KeyPort** (node:crypto
on the desktop lane). The private key lives **only** in the port-owned
workspace-local store (`.flauz/integrity/keys/ed25519-local-dev.json`) — never
committed, never banked, never rendered; only the **public key + fingerprint**
appear in records. **Production signing keys are the operator's, held outside
the product** — this extension proves the VERIFICATION machinery, not key
custody. The KeyPort is the seam an operator-key deployment drives.

## The unsigned-coverage truth at the pinned base

The ledger starts **empty by design**: the first sign run is the operator's.
At the pinned base a fresh workspace verifies `16 × unsigned` (every pinned
artifact, no ledger) with the typed degradation recorded — the honest
NOT-GREEN, never a faked green. In a pre-install tree the pinned dist
artifacts do not exist (`dist/` is build output): `sign` refuses typed
(`FLAUZ_INTEGRITY_ARTIFACT_MISSING`) and `verify` reports torn rows — the
same honest-degradation posture.

## The STATION-PENDING doctrine

This extension **never regenerates** `build/flauz/security/bundle-manifest.json`.
The CI packaging-reproducibility bundle-manifest row **fails by design** on
worker branches (the pin is minted at the integration station at landing;
this wave's own pin lands there). The wave's two disclosed additive
shared-file edits: the packaging-parity triad rows (56 → 59) and the SBOM
component row (16 → 17, instrument-regenerated).

## Evidence level

**local-real**: the real committed bundle manifest is the pin source; fixture
products carry real `dist/` artifact bytes with pins re-derived from those
bytes; ed25519 runs through real node:crypto (the desktop lane's own surface)
in the round-trip, tamper, determinism and privacy suites. Never claim
runtime-real for production key custody.

## The suite (mocha tdd, 47 tests)

`sign` (12: the round-trip, the re-derivation law, the fail-closed refusals,
the key lifecycle, the determinism law — byte-identical ledgers modulo the
injected clock, the banking) · `verify` (14: the green round-trip, the tamper
detections — flipped artifact bytes, doctored ledger entries, edited
signatures, removed entries — the typed degradations: unsigned coverage,
torn artifacts, torn ledger, absent/mismatched/torn key store, extra
entries) · `status` (4: the read-only law proven with a write-refusing fs
port) · `contract` (9: the DL-32 pins vs flauz-release/flauz-production/node:crypto
+ the REAL committed manifest, station-stable shape invariants) ·
`privacy` (8: the canary sweep + the key-store boundary — public keys in
records, private-key material NEVER).

The isolated-runner recipe (no repo install):

```sh
mkdir -p /tmp/labrun && cd /tmp/labrun && npm init -y >/dev/null && \
  npm i --silent --no-audit --no-fund mocha tsx @types/mocha
cd <repo-root>/extensions/flauz-integrity
NODE_PATH=/tmp/labrun/node_modules \
  NODE_OPTIONS="--import file:///tmp/labrun/node_modules/tsx/dist/loader.mjs" \
  /tmp/labrun/node_modules/.bin/mocha --ui tdd test/*.test.ts
```

(The `@types/mocha` install + a gitignored `node_modules` symlink into the
extension dir — the `.gitignore` line 5 pattern — is what makes
`npm run typecheck-tests` resolve the mocha types in a pre-install tree; the
repo-root install carries them at the station.)
