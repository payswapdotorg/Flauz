# Fresh-Chat Handoff — TL-B

## Role
TL-B owns Engineering Lab, agent-native productivity, capability exchange, runtime activation and adaptive/domain-specific optimization.

## Read order
1. `FLAUZ-START-HERE.md`
2. `docs/FLAUZ-PROGRAM/MASTER-ROADMAP.md`
3. `docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md`
4. `docs/FLAUZ-PROGRAM/WORK-REGISTRY.md`
5. this file
6. current `main` tree and current tests/receipts

## Verified program frontier
- LAB-001..011: COMPLETE.
- ZC-001..010: COMPLETE as contracts/productization.
- CR-001, CR-006, CR-010/011: LANDED.
- CR-002, CR-007, CR-010b: LANDED.
- CR-001 activation-map audit/repair: 36/36.
- Current `main` has advanced through CR-008; inspect the registry before claiming remaining CR items.

## Primary strategic goal
Flauz must be able to turn into the **domain-specific work harness selected by a user during onboarding**.

The model is:

`industry selection -> harness instantiation -> domain workflows/roles/capabilities/policies -> real execution -> observation -> Lab optimization -> increasingly specialized harness`.

Never fork Flauz per industry. A harness is composable configuration + capabilities + workflows + agent organizations + domain knowledge/policy/evidence + UI projections over the universal Flauz core.

## Immediate runtime activation
Inspect `WORK-REGISTRY.md` and current `main` first. Complete whatever remains of:
- CR-003 live Hook Bus
- CR-004 Plan/Run Observatory + replay
- CR-005 persistent memory runtime
- CR-008 capability verification / permission gate
- CR-009 bounded agent-native command execution
- remaining CR-010/011 runtime parity and canonical journey legs
- CR-012 large-scale simulation / gap closure
- CR-013 final Phase-C-R acceptance

Do not create another scheduler, journal, permission broker, model router, resource registry or persistence authority.

## New workstream: Free Inference Fabric
Use the **tactics** of `tashfeenahmed/freellmapi` as a reference and integration candidate, but do not create a shared Flauz public gateway that pools other people's free-tier provider keys.

Preferred model:

`Flauz -> per-user inference fabric -> user-owned/direct provider accounts and permitted local/free providers`.

The user-facing Free plan promise is:

`unlimited Flauz usage`

not:

`unlimited provider tokens`.

Free capacity is inherently provider-dependent and must remain honest and observable.

### Inference-fabric requirements
- provider catalog and capability matrix;
- direct provider adapters where permitted;
- optional per-user/local FreeLLMAPI-compatible sidecar/adapter where appropriate;
- health scoring;
- quota/cooldown tracking;
- retry/backoff;
- automatic failover;
- context-window and capability matching;
- provenance of the selected provider/model;
- transparent capacity/reset state;
- per-user credential isolation and secret-safe storage;
- explicit provider-term/license eligibility checks;
- no automatic permission escalation through routing.

Treat upstream FreeLLMAPI as replaceable technology, not as Flauz's source of truth. Verify the current upstream license and every provider's current terms before enabling any live source.

## New workstream: Domain Harness
Build the reusable harness model around onboarding selection.

Every domain harness should be able to declare:
- domain ontology and terminology;
- company/work type;
- roles and Agent Bodies;
- default organizations;
- task types;
- workflows;
- documents/artifacts;
- capability packs;
- model preferences;
- approvals/policies;
- evidence requirements;
- KPIs;
- benchmark task worlds;
- Lab/simulation worlds;
- UI/navigation projections.

Support composition, because one user can have multiple roles and domain specializations.

Initial onboarding should at least support:
- industry;
- company/work type;
- role(s);
- primary workloads;
- optional existing tools/data/capabilities.

The output is a proposed harness the user can inspect/approve before activation.

## Product loop
`onboard -> instantiate harness -> use -> observe workload -> classify task -> search organization/model/capability -> simulate -> recommend -> approve -> execute -> observe -> calibrate -> improve harness`.

The Engineering Lab recommends and learns; Agent OS executes; Workspace OS persists/represents; policy/approval authorities govern.

## External capability ecosystem
Printing Press, Composio, MCP/skills catalogs and direct/community sources are adapters/discovery sources. Flauz owns normalization, verification, provenance, permissioning and execution.

## Worker split
- B1: runtime/product patterns + domain-harness runtime contracts.
- B2: capability exchange + inference fabric + provider/source adapters.
- B3: product surfaces, onboarding, simulation, acceptance and evidence.

Workers may proceed independently using fixtures/mock adapters. No worker waits for TL-A.

## Quality laws
- Evidence must be truthful: fixture | simulated | local-real | runtime-real | live-provider | production-real.
- External capability/provider metadata is untrusted until verified.
- No shared third-party free-tier key pool.
- No hidden provider/model substitution.
- No second runtime authority.
- No `src/vs/**` changes without a new architecture decision.
- No protected TL-A production/release surface edits.

## Final strategic acceptance question
Can a new user select an industry during onboarding and receive a credible, usable, safe and increasingly adaptive domain-specific Flauz harness, while the universal Agent OS/Workspace OS remain underneath and the inference fabric transparently supplies whatever permitted model capacity is available?

## Verified frontier refresh — 2026-10-15 (TL-B)

Reconciliation of this handoff to the registry and current `main` (head `1430141c358f6460b437346bfc794076fc43b781`):

- LAB-001..011: COMPLETE (unchanged).
- ZC-001..010: COMPLETE (unchanged).
- CR-001..013: COMPLETE — Phase C-R closed; the ledger retains three exercised-but-unresolved and two unexercised integration gaps as open rows.
- INF-001..009: COMPLETE as an implementation workstream (fixture evidence); the live-provider acceptance canary is an env-gated clean-SKIP — no live exchange verified until a configured successful run is recorded.
- DH-001..007: COMPLETE (938 family tests, PRs #193..#198) — contracts and composition layers; no per-industry content shipped yet (the CONTENT LAW disclosures in each family README).
- TL-A: the first production-real deployment is closed at v0.2.0 (https://flauz-web.vercel.app); sustained production-operation closure remains TL-A's open gate.

### The outstanding TL-B sequence

DH-008 policy/approval/evidence/KPI profiles → DH-009 domain benchmark/simulation worlds → DH-010 domain UI/navigation projections → DH-011 end-to-end onboarding and activation → DH-012 Lab-driven harness optimization → DH-013 cross-industry harness acceptance.

Every family binds to the REAL landed modules and the REAL Flauz authorities — no new permission broker, approval engine, evidence ledger, execution authority, scheduler, journal, model router, resource registry or persistence authority. The evidence law holds: fixture | simulated | local-real | runtime-real | live-provider | production-real, never promoted by wording.

Consult `WORK-REGISTRY.md` and the family READMEs under `build/flauz/harness/` for the landed patterns (staged records, PIN-2 persistence, the import law, the no-dangling-ref boundaries).

## Addendum — 2026-10-15 (later, TL-B): Wave 8 landed

DH-008 (profiles, PR #199) + DH-009 (benchmarks, PR #200) are DONE — see the registry wave-8 landing record. The outstanding TL-B sequence is now **DH-010 → DH-011 → DH-012 → DH-013**.

## Addendum — 2026-10-15 (later, TL-B): Wave 9 landed

DH-010 (PR #201) + DH-011 (PR #202) are DONE — see the registry wave-9 landing record. The outstanding TL-B sequence is now **DH-012 → DH-013**.

## Addendum — 2026-10-15 (later, TL-B): Wave 10 landed

DH-012 (PR #203) is DONE — see the registry wave-10 landing record. The outstanding TL-B item is now **DH-013 (cross-industry harness acceptance)** — the final row of the DH sequence.

## Final state — 2026-10-15 (TL-B): the DH sequence complete

**DH-001 through DH-013 are ALL LANDED** (the wave records in the registry; PRs #193–#198, #199, #200, #201, #202, #203, #204). Thirteen families, 1,868 passing tests at the merged head. The outstanding items for any future TL-B session: the DH gap ledger's six rows (the LAB industry task-worlds coverage first among them — the acceptance family's honest residue), and the coordination surfaces with TL-A (sustained production-operation closure; the INF live-provider exchange). The evidence law holds — nothing promoted, nothing faked.
