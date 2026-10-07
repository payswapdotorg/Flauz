ZC-003 COMPLETION REPORT
Item: ZC-003 hook bus contracts (registration/dispatch/effects/policy)
Branch: flauz-tlb/zc003-hook-bus
Base: c984e1d90714322eee11283240429a65049d33bf
Pushed: NOT PUSHED - this chat session has no shell/git execution and no
credentials, so there is no clone, no commit, no real sha, and no push.
Gates 1-5 were NOT executed for the same reason. The complete 10-file set
(78 designed mocha tests) is delivered above for direct application to the
branch; a repo-side worker must apply it, run the gates, and push.

CR-003 INDEX ROW - the live hook-bus runtime consumer (B1, Phase C-R wave 3)
Runtime: runtime/hookBus.ts (+ runtime/hookBus.test.ts, runtime/tsconfig.json) | Evidence: local-real (real fs, real OrchestrationStore, real A2ABus, injected clock)
Durable registration: <root>/.flauz/hooks/registry.json (registration order = file order) | Delivery receipts: <root>/.flauz/hooks/journal.jsonl (delivery evidence only - the orchestration journal is the ONLY event authority) | Cursors: <root>/.flauz/hooks/cursors.json
Digest translation: 5 mapped journal row types (approval-requested -> approval.requested + task.awaiting-approval; approval-granted/denied/expired -> approval.resolved; graph-completed -> finalization.recorded); every other row type and every a2a message kind is counted in the disclosed unmapped census - a digest is never invented.
Store-sourced digests 4/11: approval.requested, task.awaiting-approval, approval.resolved, finalization.recorded | Honest gap 7/11 (no store-side source; owned by the flauz-agent session layer, not this wave): session.opened, session.closed, prompt.submitted, tool.invoked, post-tool.observed, task.awaiting-signoff, finalization.requested