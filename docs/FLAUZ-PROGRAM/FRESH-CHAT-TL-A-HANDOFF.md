# Fresh-Chat Handoff — TL-A

## Role
TL-A is the production owner for Flauz.

## Read order
1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`
3. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. this file
6. current `main` tree and current CI/release state

## Verified program frontier
- Foundation TL1/TL2/TL3/TL4: COMPLETE.
- P2 acceptance: COMPLETE.
- A-PROD-001..005: COMPLETE.
- A-PROD-003 dogfood W1..W8: COMPLETE; seven exercise dimensions are covered and the current live-provider drill is 4/4.
- Engineering Lab LAB-001..011: COMPLETE under TL-B.
- Phase-C contract layer ZC-001..010: COMPLETE under TL-B.
- Phase C-R runtime activation waves 1-2: LANDED and verified; current `main` has also advanced through CR-008.
- TL-A: **A-PROD-006 COMPLETE** (2026-10-17, the registry's W9 sustained-production-operation closure record — 5 local + 2 production-real revolutions, 6 release identities v0.1.0→v0.2.1, 2 real incidents through the frozen lifecycle). The post-closure TL-A surface: the sustained LIVE watch at 0.2.1 + TL-B's row-4 coordination (the production-real harness deployment evidence staged at the LIVE surface).

## Mission
Finish A-PROD-006 as a real production operating loop:

`deploy -> observe -> incident -> reproduce -> fix -> regression -> release -> post-release verify -> repeat`.

Do not reopen completed architecture unless production evidence proves an actual deficiency.

## A-PROD-006 completion graph — CLOSED 2026-10-17 (the W9 registry record carries each row's evidence citation)
- [x] Production deployment verification (production-real ×2: v0.2.0 + v0.2.1, both with the E2E boot receipt)
- [x] Production smoke / critical journey battery (GO ×6; the six-row LIVE battery 8/8 at both production identities)
- [x] Operational observability (the LIVE ledger census read at every cycle; the closure row banked)
- [x] Incident/problem lifecycle (2 real incidents through the frozen-stage machine end-to-end)
- [x] Failure / rollback drills (×4, the local cycles)
- [x] Upgrade / migration verification (×6, v0.1.0→v0.2.1; the byte-comparison receipt at 0.2.1)
- [x] Security / data-isolation operations (×5; the gates GREEN at every identity; SBOM byte-exact)
- [x] Support / diagnostics workflow (×5; healthz/status/evidence production-real)
- [x] Post-release acceptance (×5; every identity verified post-release)
- [x] Reliability review (the W9 closure review over the full inventory)
- [x] Sustained production-operation closure (the W9 record — the loop demonstrated at production-real twice)

## New inference-fabric responsibility
TL-A does not own the inference-fabric architecture. TL-B owns implementation. TL-A owns production/security/release validation of any inference path that reaches production.

The approved product promise is **unlimited Flauz usage on Free**, not literally unlimited provider tokens. Provider capacity remains subject to the user's available provider accounts/tiers and current provider terms.

Production validation must ensure:
- no shared pool of third-party free-tier API keys is exposed as a Flauz public gateway;
- user/provider credentials remain isolated and redacted;
- provider terms/licensing are checked before enabling a source;
- provider fallback/cooldown state is observable;
- model/provider changes are provenance-bearing;
- production releases identify exactly which inference-fabric version/configuration is deployed;
- failure and rollback paths work.

## TL-A/TL-B boundary
TL-A must not block on TL-B. TL-A should use typed/mock provider-capacity fixtures where necessary until TL-B supplies a runtime adapter.

TL-A must not edit TL-B implementation directories merely to make production tests pass. Route real defects to the owning lane.

## Final acceptance question
Can a real Flauz user use the deployed product for meaningful work, understand what the system is doing, recover from failures, and can the team operate the product through a repeatable production reliability loop?