# P2-FIX-107 — URLs (including query-string credentials) are recorded verbatim in verdict notes, journal tab URLs, popup-gate records and navigation events

Observed by the TL3-P2 partition-A readiness audit (worker chat c4aa3f08,
A10 canary-secret observation) on the pinned base `c27de198e1`; routed as
P2-FIX-107 by TL4 (2026-10-01 routing record), TL3 + TL2.

- **Observable behavior:** a planted canary URL
  `…?token=glauz-p2-canary-token-9f31c7aa4d` appears verbatim in navigation
  verdict notes, the session journal's tab URLs and `navigated` records
  (requested/committed URLs), and popup-gate records. The architecture's
  declared redaction control point — the continuity export
  (SECRET-REDACTION) — sits OUTSIDE the browser partition and redacts on
  export; the at-rest evidence files in the workspace root
  (`.flauz/browser-sessions.jsonl`) carry the raw values.
- **Evidence + runtime level:** local-real — the canary-secret audit run on
  the audit tree: the DENY path put the canary NOWHERE on the wire (zero
  CDP commands for denied operations, asserted across every transport's
  sent-command log) while the persistence surfaces above carried it
  verbatim.
- **Owning domain:** the evidence/continuity contract lanes (TL3 continuity
  + TL2 journal consumers); the at-record vs at-export decision is made as
  **DL-80** before implementation.
- **Proposed contract change (per DL-80, the two-layer law):** at-record
  secret-shaped query-param VALUE redaction in the browser journal tab URLs,
  `navigated` records and popup-gate records (URL structure and param NAMES
  preserved; secret-shaped values redacted — the flauz-resources
  `SECRET_SHAPED_PATTERNS` detector class); the continuity export REMAINS
  the authoritative full-redaction boundary (unchanged, belt-and-braces).
- **Acceptance test:** a canary-bearing URL (`?token=<canary>`) in an
  allowed navigation leaves the journal `navigated` record with the URL
  structure intact but the canary value redacted; the DENY path still puts
  the canary nowhere on the wire; the continuity export redaction law
  unchanged (its tests untouched); the full browser suite green.
- **Architecture impact:** small — evidence-contract wording + a
  normalization helper at the journal/popup-gate write boundary; no runtime
  navigation semantics change; TL2's journalBridge consumers read structure,
  not query values (compatibility verified by the bridge probe).
