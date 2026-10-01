# P2-FIX-116 — A provider lane switch is durable in three places with no single linking event row

Finding domain: TL-A (dogfood-surfaced, the Model Fabric evidence/provenance) · Found by: A-PROD-003-W1 (the dogfood harness build, chat `0bd25529`) · Status: REGISTERED (not implemented — the A3 law: every dogfood defect becomes a registry item before implementation)

## Observable dogfood behavior

Switching a provider lane through the REAL Model Fabric (the dogfood
driver's provider-switch exercise, PR #110) performs:

1. `writeProviderOverrides` — rewrites the whole providers file;
2. the routing-policy rewrite;
3. a durable ModelRouter decision appended to the decision ledger.

Three durable artifacts, three different shapes, and NO single
"provider switch" event row linking them. The dogfood harness had to mint
its OWN evidence row per switch to give the switch a durable identity —
a workaround, not a fix.

## The friction

After the fact, answering "what switch happened, when, and what did it
change?" requires correlating three artifacts by hand. For the A-PROD-004
diagnostics/observability wave this is exactly the class of gap that makes
support/debug bundles weak: the switch — an operator-relevant event class —
has no first-class event identity.

## Evidence + runtime level

`local-real`: the real Model Fabric code paths (the real
openAiCompat-adapter lane machinery over a real local socket, the real
providers/policy/decision files), observed while building the harness's
provider-switch exercise (the worker's §6 disclosure, PR #110).

## Candidate acceptance shape (for the implementing wave)

A provider-lane switch mints ONE canonical typed event (evidence row or
ledger record) referencing the three artifacts it touches (before/after
provider ids, the policy delta, the decision id); the harness's
per-switch workaround row is then retired in favor of the product's own
event.
