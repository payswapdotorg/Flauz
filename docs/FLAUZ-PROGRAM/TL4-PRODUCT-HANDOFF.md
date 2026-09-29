# TL4 Active Product-Phase Handoff

## Mission

Own the full-product acceptance and user-discovery audit. TL4 determines whether the existing Flauz architecture is actually usable as one product.

## Active work

### P2-002 — Full product acceptance
**Status: ACTIVE**

Exercise the integrated product end to end:

1. create/open workspace;
2. create mission/task;
3. start agent session;
4. choose a live provider/model;
5. edit/read workspace resources;
6. use browser;
7. create/use environment;
8. delegate to another agent;
9. require/handle approval or takeover;
10. produce artifact/evidence;
11. exercise provider/environment failure;
12. retry/cancel/recover;
13. restart;
14. resume task and inspect continuity/provenance.

### P2-003 — User discovery audit
**Status: ACTIVE**

Use the same product as a new and returning human. Check:

- Home/Tasks/Agent Sessions/Environments/Browser/Models discoverability;
- obvious next steps;
- capability discoverability;
- error and recovery grammar;
- approval/takeover comprehension;
- evidence/provenance comprehension;
- absence of dead ends and orphan states;
- accessible labels and keyboard/navigation expectations;
- consistency between desktop and web posture where applicable.

## Worker partition

- **Worker A — Journey runtime:** executes the end-to-end functional journey and records runtime evidence.
- **Worker B — Discovery/UX:** performs first-run and returning-user discovery audits and records UX findings.
- **Worker C — Independent verification:** replays failed/critical scenarios, checks compatibility/security/performance impact, and prepares the final acceptance matrix.

Workers must write separate evidence/findings artifacts to avoid concurrent edits.

## Finding protocol

When a problem is found:

- create a `P2-FIX-###` finding;
- label it with domain `TL1 | TL2 | TL3 | TL4`;
- do not patch another TL's implementation path;
- attach the exact reproduction and evidence level;
- route it to the owning TL;
- TL4 remains responsible for the final re-test and acceptance verdict.

TL4 may directly fix only TL4-owned UX/IA/accessibility/performance/release surfaces.

## Acceptance artifacts

Preferred locations:

- `docs/FLAUZ-PROGRAM/acceptance/` for journey evidence;
- `docs/FLAUZ-PROGRAM/findings/` for routed findings;
- `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md` for phase rules.

Use one artifact per worker/journey to avoid merge contention.

## Definition of done

P2-002/P2-003 are DONE when:

- all planned journeys are executed at the highest available evidence level;
- every non-pass is either fixed or converted into an explicit P2-FIX item;
- every P2-FIX has an owning TL;
- TL4 has re-run all fixed critical journeys;
- the final acceptance matrix is recorded in the repository;
- `WORK-REGISTRY.md` and `CURRENT-STATE.md` are updated in the final merge wave.

## Start here

Read:

1. `docs/FLAUZ-PROGRAM/PRODUCT-PHASE.md`
2. this file
3. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
4. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
