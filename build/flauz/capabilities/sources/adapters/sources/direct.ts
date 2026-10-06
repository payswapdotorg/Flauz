// sources/direct.ts — CR-007 (Phase C-R, B2, wave 2)
// Deterministic seed catalogue + runtime passthrough for directly supplied records.

import type { AdapterRecord, DirectAdapter } from '../adapterKit.mjs'

function cloneRecord(record: AdapterRecord): AdapterRecord {
  // Station seam-completion: only PLAIN-OBJECT payloads are spread-cloned;
  // anything else (arrays, null, primitives) passes through untouched so
  // the kit's discovery-time validation still rejects it (the spread of an
  // array used to silently convert it into a plain object).
  const payloadPass = record.payload === undefined
    || record.payload === null
    || Array.isArray(record.payload)
    || typeof record.payload !== 'object'
  return {
    ...record,
    tags: record.tags === undefined ? undefined : [...record.tags],
    payload: payloadPass ? record.payload : { ...record.payload },
  }
}

/** The deterministic seed catalogue (three notes). */
const seedRecords: readonly AdapterRecord[] = [
  {
    localId: 'note-001',
    kind: 'note',
    title: 'Registry Conventions — Onboarding Note',
    summary: 'How entries are named, namespaced, and checksummed before they reach the registry.',
    tags: ['conventions', 'meta'],
    payload: { authoredBy: 'cr-007', sticky: true },
  },
  {
    localId: 'note-002',
    kind: 'note',
    title: 'Glossary — Adapter Terminology',
    summary: 'Working definitions for source, adapter, catalogue, candidate, and import.',
    tags: ['glossary', 'meta'],
    payload: { terms: ['adapter', 'candidate', 'catalogue', 'import', 'source'] },
  },
  {
    localId: 'note-003',
    kind: 'note',
    title: 'Runbook — Manual Import Steps',
    summary: 'Step-by-step fallback procedure for driving an import by hand.',
    tags: ['runbook'],
    payload: { steps: ['discover', 'review', 'dry-run', 'import', 'verify'] },
  },
]

let records: AdapterRecord[] = seedRecords.map(cloneRecord)

/**
 * direct — passthrough source. Starts from the deterministic seed catalogue;
 * `add()` accepts records at runtime (they are cloned on insertion, so callers
 * cannot mutate the catalogue after the fact). Validation happens in the kit at
 * discovery time, so bad additions surface as `rejected`, never as throws.
 */
export const direct = {
  id: 'direct',
  displayName: 'Direct Entry',
  description: 'Passthrough source for records supplied at runtime; ships a deterministic seed catalogue.',
  discover() {
    return records.map(cloneRecord)
  },
  add(...incoming: AdapterRecord[]) {
    records.push(...incoming.map(cloneRecord))
    return records.length
  },
  clear() {
    records = []
  },
  reset() {
    records = seedRecords.map(cloneRecord)
  },
  size() {
    return records.length
  },
} satisfies DirectAdapter
