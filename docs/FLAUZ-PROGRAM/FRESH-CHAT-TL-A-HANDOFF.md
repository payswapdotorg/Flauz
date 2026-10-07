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
- TL-A frontier: sustained production operation / post-production reliability closure.

## Mission
Finish A-PROD-006 as a real production operating loop:

`deploy -> observe -> incident -> reproduce -> fix -> regression -> release -> post-release verify -> repeat`.

Do not reopen completed architecture unless production evidence proves an actual deficiency.

## A-PROD-006 completion graph
- [ ] Production deployment verification
- [ ] Production smoke / critical journey battery
- [ ] Operational observability
- [ ] Incident/problem lifecycle
- [ ] Failure / rollback drills
- [ ] Upgrade / migration verification
- [ ] Security / data-isolation operations
- [ ] Support / diagnostics workflow
- [ ] Post-release acceptance
- [ ] Reliability review
- [ ] Sustained production-operation closure

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