# LAB · the Engineering Lab family (`build/flauz/lab/`)

The Engineering Lab is the Flauz simulation/acceptance/evidence lane: the
versioned contract set (`labContracts.ts`, zero-dependency by law), the
deterministic fixture learners/searchers/engines and the task-world registry
(LAB-003) that the DH harness families bind their benchmark legs against.
The Lab recommends and learns; Agent OS executes; Workspace OS persists;
policy/approval authorities govern (the ARCHITECTURE-LOCK laws).

This README was added by the DH residue wave 1 delivery (GAP-1, the lab
industry task-worlds): the family pre-dated the DH README convention and
carried no README; this file establishes the one-row-per-delivery index in
the DH family style, back-filled honestly from the WORK-REGISTRY landing
records.

## The delivery index (one row per delivery)

| delivery | module(s) | what landed |
| --- | --- | --- |
| LAB-001 | `common/labContracts.ts` | the versioned Lab contracts and the LabRun status machine (zero-dependency by law) |
| LAB-002 | `common/workloadLearning.ts` | the deterministic workload/task-type learner, fixture lane (opt-in gate, retention, scope discipline) |
| LAB-003 | `common/taskWorlds.ts` | the task-world builder and the SE fixture world (`world-se-fixtures`, three scenarios), the deterministic instance engine, the information-boundary law |
| LAB-004 | `common/agentBodies.ts` | the Agent Body library, fixture catalog |
| LAB-005 | `common/orgSearch.ts` | the organization search, fixture lane |
| LAB-006 | `common/occupancySearch.ts` | the model/tool/capability occupancy search, fixture lane |
| LAB-007 | `common/runEngine.ts` | the simulation and learning ladder run engine, fixture lane |
| LAB-008 | `common/calibration.ts` | calibration plus real-task observation |
| LAB-009 | `extensions/flauz-lab` (outside this tree) | the lab console W1, landed as the flauz-lab extension |
| LAB-010 | `common/taskBridge.ts` | the recommendation-to-Agent-OS bridge, fixture lane |
| LAB-011 | `common/closedLoop.ts` | the calibration + closed-loop proof — the LAB lane complete (001..011) |
| DH residue wave 1 / GAP-1 | `common/financeTaskWorld.ts` · `common/healthcareTaskWorld.ts` · `common/constructionTaskWorld.ts` · `common/industryTaskWorlds.ts` | the three industry task-worlds (finance · healthcare · construction), composed exactly like the SE world through the REAL LAB-003 engine (imported, never re-implemented), plus this README and the scoped family tsconfig |

## THE REGISTRY-EXTENSION DISCLOSURE (the GAP-1 wave's honesty)

The landed `TASK_WORLDS` registry is census-pinned to the single SE fixture
world by landed batteries in two families (the lab suite and the benchmarks
contract suite). The three industry worlds therefore live in the industry
extension registry (`industryTaskWorlds.ts`: `INDUSTRY_TASK_WORLDS`), and
the combined catalog (`ALL_TASK_WORLDS`) is composed by import from the
REAL landed registry — the SE entry stays referentially the landed
registry's own descriptor, no catalog injection exists anywhere, and the
landed lookups resolve exactly as before. THE IMPORT LAW holds: the
per-instance engine is the REAL imported `generateInstance` — no second
simulation engine, no new authority. THE COMPOSITION-NOT-FORK LAW holds: the
industries differ only in data (three pure-data modules; a further industry
is a new data module plus one registry row, never a code path).

## THE CONTENT LAW + THE EVIDENCE LAW (binding)

The industry task-world content is CURATED FIXTURE-LEVEL content —
representative, deliberately modest, honestly labeled; NOT a claim of
comprehensive domain truth, NOT promoted evidence. Every world records
`evidenceLevel: 'fixture'` and an honest provenance sentence over its
synthetic layout; no real telemetry, no real customer/patient/project data
and no live system snapshots are involved, and nothing in this family
claims the simulated/local-real/runtime-real/live-provider/production-real
rungs.

## Run commands (from the worktree root)

```sh
~/toolchain/node_modules/.bin/tsc -p build/flauz/lab/tsconfig.json --noEmit
bunx --bun mocha --ui tdd 'build/flauz/lab/test/common/*.test.ts'
grep -nE "Date\.now|Math\.random|new Date\(|process\.env" build/flauz/lab/common/*.ts   # law-comment lines only
```

### Receipt table

| gate | expected |
| --- | --- |
| `tsc -p build/flauz/lab/tsconfig.json` | exit 0 |
| `test/common/*.test.ts` | 331 passing, 0 failing (210 landed + 121 industry-wave) |
| the determinism greps over `common/*.ts` | law-comment lines only |

### Battery map

| suite | file | passing |
| --- | --- | --- |
| lab contracts | `test/common/labContracts.test.ts` | 9 |
| workload learning | `test/common/workloadLearning.test.ts` | 15 |
| task bridge | `test/common/taskBridge.test.ts` | 28 |
| organization search | `test/common/orgSearch.test.ts` | 21 |
| calibration | `test/common/calibration.test.ts` | 36 |
| closed loop | `test/common/closedLoop.test.ts` | 19 |
| task worlds (landed SE) | `test/common/taskWorlds.test.ts` | 15 |
| agent bodies | `test/common/agentBodies.test.ts` | 25 |
| occupancy search | `test/common/occupancySearch.test.ts` | 19 |
| run engine | `test/common/runEngine.test.ts` | 23 |
| industry task-worlds (GAP-1) | `test/common/industryTaskWorlds.test.ts` | 49 |
| finance task world (GAP-1) | `test/common/financeTaskWorld.test.ts` | 24 |
| healthcare task world (GAP-1) | `test/common/healthcareTaskWorld.test.ts` | 24 |
| construction task world (GAP-1) | `test/common/constructionTaskWorld.test.ts` | 24 |
| **family total** | `test/common/*.test.ts` | **331** |
