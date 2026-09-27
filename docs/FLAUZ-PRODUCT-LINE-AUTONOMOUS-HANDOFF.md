# Flauz Product-Line Autonomous Handoff

**Active implementation branch:** `flauz/main`  
**Repository:** `payswapdotorg/Flauz`  
**Companion lab:** `payswapdotorg/flauz-code-lab`

## Purpose

This document makes the Code OSS-based Flauz implementation line operable without chat history.

## Branch truth

- Default `main` is the upstream Code OSS line and may advance independently.
- `flauz/main` is the active Flauz product implementation line.
- Product work for this direction must target `flauz/main` until an explicit branch/default-base decision is recorded.
- Never describe an upstream-`main` checkout as the completed Flauz product.

## Architecture

Preserve native Code OSS capabilities wherever possible:
- editor
- workspace/project model
- terminal
- source control
- debugging
- tasks
- extensions
- command palette
- accessibility
- agent/chat primitives

Layer Flauz through additive extensions/services for:
- multi-model and multi-agent orchestration;
- durable workspace/task/context state;
- browser policy/control;
- environment registry and remote continuity;
- reusable workflows;
- evidence/decision records;
- provider routing and future collaboration.

Any core Code OSS divergence must carry an explicit rationale and upstream alternative.

## Current implementation surfaces

The Flauz line currently contains additive implementation for major agent, browser, model, environment, workflow, policy, evidence, and CI surfaces.

The canonical research/evidence handoff lives in:
`payswapdotorg/flauz-code-lab`

Use that lab for experiments and decisions; use this branch for integrated product code.

## Autonomous work loop

```
inspect flauz/main
→ read lab docs/CURRENT-STATE.md
→ select approved unresolved work
→ implement on a focused branch
→ test
→ record exact SHA/evidence
→ merge into flauz/main
→ update the lab decision/evidence record
```

## Completion law

A feature is integrated only when:
- it is present on `flauz/main`;
- tests pass;
- the exact SHA is recorded;
- the lab records what was proven;
- prototype-only claims are not presented as product functionality.

## Do not do

- do not create another Code OSS fork;
- do not silently replace mature Code OSS features;
- do not move Flauz product work back to upstream `main`;
- do not make a prototype look production-complete;
- do not introduce fork-critical core changes without a recorded decision.
