#!/usr/bin/env python3
# FLAUZ-TL2-F1 — strengthen the serialized-append guard:
#   public appendRow throws when ANY async op holds/awaits the transition lock
#   (depth > 0 OR waiters > 0); in-lock call sites switch to appendRowInternal
#   (the guard-free half). Run from the repo root.

def rep(src, name, old, new, count=1):
    n = src.count(old)
    assert n == count, f"{name}: pattern count {n} (expected {count})"
    return src.replace(old, new)

p = 'extensions/flauz-agent/core/orchStore.mjs'
src = open(p).read()

# 1) strengthen the public guard + add appendRowInternal
src = rep(src, 'guard',
    "\tappendRow(type, fields) {\n\t\tif (this.lockDepth === 0 && this.lockWaiters > 0) {\n\t\t\tthrow new OrchestrationError(`${type} refused: the transition lock is contended (${String(this.lockWaiters)} waiter(s)) - a lock-free direct journal write is impossible under contention; route the append through the serialized store API (withTransitionLock / appendRowLocked / the locked public ops)`, 'lock-violation');\n\t\t}\n\t\tconst row = this.candidateRow(type, fields);\n\t\treturn this.appendCandidate(row);\n\t}",
    "\tappendRow(type, fields) {\n\t\tif (this.lockDepth > 0 || this.lockWaiters > 0) {\n\t\t\tthrow new OrchestrationError(`${type} refused: the transition lock is held (${String(this.lockDepth)} in-flight, ${String(this.lockWaiters)} waiting) - a lock-free direct journal write is impossible while a serialized operation is in flight; route the append through the serialized store API (appendRowLocked / the locked public ops)`, 'lock-violation');\n\t\t}\n\t\treturn this.appendRowInternal(type, fields);\n\t}\n\n\t/**\n\t * The guard-free append half for callers that ALREADY hold the transition\n\t * lock (the locked public ops and appendRowLocked). External code must\n\t * never call this directly - the public appendRow enforces the DL-75\n\t * lock-discipline guard.\n\t */\n\tappendRowInternal(type, fields) {\n\t\tconst row = this.candidateRow(type, fields);\n\t\treturn this.appendCandidate(row);\n\t}")

# 2) appendRowLocked rides the internal half
src = rep(src, 'locked-helper',
    "\tasync appendRowLocked(type, fields) {\n\t\treturn this.withTransitionLock(() => this.appendRow(type, fields));\n\t}",
    "\tasync appendRowLocked(type, fields) {\n\t\treturn this.withTransitionLock(() => this.appendRowInternal(type, fields));\n\t}")

# 3) every in-lock appendRow call site -> appendRowInternal
inlock = [
    ("\t\treturn this.withTransitionLock(() => this.appendRow('graph-approved', {", "\t\treturn this.withTransitionLock(() => this.appendRowInternal('graph-approved', {"),
    ("\t\treturn this.withTransitionLock(() => this.appendRow('graph-rejected', {", "\t\treturn this.withTransitionLock(() => this.appendRowInternal('graph-rejected', {"),
    ("\t\treturn this.withTransitionLock(() => this.appendRow('graph-completed', {", "\t\treturn this.withTransitionLock(() => this.appendRowInternal('graph-completed', {"),
    ("\t\treturn this.withTransitionLock(() => this.appendRow('graph-failed', {", "\t\treturn this.withTransitionLock(() => this.appendRowInternal('graph-failed', {"),
    ("\t\t\t\tconst row = this.appendRow('step-started', {", "\t\t\t\tconst row = this.appendRowInternal('step-started', {"),
    ("\t\t\t\treturn this.appendRow('step-succeeded', {", "\t\t\t\treturn this.appendRowInternal('step-succeeded', {"),
    ("\t\t\t\treturn this.appendRow('step-failed', {", "\t\t\t\treturn this.appendRowInternal('step-failed', {"),
    ("\t\treturn this.appendRow('step-retry-scheduled', {", "\t\treturn this.appendRowInternal('step-retry-scheduled', {"),
    ("\t\t\tthis.appendRow('cancel-requested', {", "\t\t\tthis.appendRowInternal('cancel-requested', {"),
    ("\t\t\t\t\t\tthis.appendRow('step-cancelled', {", "\t\t\t\t\t\tthis.appendRowInternal('step-cancelled', {"),
    ("\t\t\t\tthis.appendRow('graph-cancelled', {", "\t\t\t\tthis.appendRowInternal('graph-cancelled', {"),
    ("\t\treturn this.withTransitionLock(() => this.appendRow('route-decided', {", "\t\treturn this.withTransitionLock(() => this.appendRowInternal('route-decided', {"),
    ("\t\treturn this.withTransitionLock(() => this.appendRow('delegation-sent', {", "\t\treturn this.withTransitionLock(() => this.appendRowInternal('delegation-sent', {"),
    ("\t\t\tconst receipt = this.appendRow('result-received', {", "\t\t\tconst receipt = this.appendRowInternal('result-received', {"),
    ("\t\t\tconst row = await this.withTransitionLock(() => this.appendRow('graph-submitted', {", "\t\t\tconst row = await this.withTransitionLock(() => this.appendRowInternal('graph-submitted', {"),
]
for i, (old, new) in enumerate(inlock):
    src = rep(src, f'inlock-{i}', old, new)

open(p, 'w').write(src)
print('orchStore.mjs guard strengthened, in-lock call sites routed to appendRowInternal')

# 4) mirror: document appendRowInternal
p = 'extensions/flauz-agent/core/orchStore.d.mts'
src = open(p).read()
src = rep(src, 'mirror',
    "\t/** FLAUZ-TL2-F1 (DL-75): the serialized append for async call sites - transition lock -> appendRow. Refuses lock-free writes under contention. */\n\tappendRowLocked(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): Promise<JournalRow>;",
    "\t/** FLAUZ-TL2-F1 (DL-75): the serialized append for async call sites - transition lock -> appendRow. Refuses lock-free writes under contention. */\n\tappendRowLocked(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): Promise<JournalRow>;\n\t/** FLAUZ-TL2-F1 (DL-75): the guard-free append half for callers that already hold the transition lock. Never call directly - the public appendRow enforces the lock-discipline guard. */\n\tappendRowInternal(type: string, fields: { graphId: string; stepId?: string | null; actor: string; origin: string; attempt?: number | null; idempotencyKey?: string | null; ts?: number; payload: Record<string, unknown> }): JournalRow;")
open(p, 'w').write(src)
print('orchStore.d.mts mirror updated')
