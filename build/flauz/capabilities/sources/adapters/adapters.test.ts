// adapters.test.ts — CR-007 (Phase C-R, B2, wave 2)
// 54 tests over the adapter kit and the four bundled adapters.
// Run: node --test adapters.test.ts
//
// Hermetic by design: 52 of 54 tests run against in-file stub registries.
// The two "registry seam" smoke tests exercise the real CR-006 registry and
// fail loudly (AdapterError REGISTRY_UNAVAILABLE / REGISTRY_SEAM_MISMATCH /
// failed[] entries) if the assumed register/has/get seam is wrong —
// see REPORT.md.

import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  AdapterError,
  ENTRY_KINDS,
  discoverFrom,
  getAdapter,
  hasAdapter,
  importAll,
  importFrom,
  isEntryKind,
  listAdapters,
  registerAdapter,
  resetAdapterKit,
  stableChecksum,
  unregisterAdapter,
  type AdapterRecord,
  type ExternalAdapter,
} from './adapterKit.mjs'
import {
  bundledAdapters,
  composio,
  direct,
  installBundledAdapters,
  mcpSkills,
  printingPress,
} from './sources/adapters.ts'

const FIXED_NOW = 1_700_000_000_000
const fixedClock = () => FIXED_NOW

function createStubRegistry() {
  const entries = new Map<string, any>()
  return {
    entries,
    register(entry: any) {
      if (entries.has(entry.id)) throw new Error(`stub registry duplicate: ${entry.id}`)
      entries.set(entry.id, entry)
      return entry
    },
    has(id: string) {
      return entries.has(id)
    },
    get(id: string) {
      return entries.get(id)
    },
  }
}

before(() => {
  installBundledAdapters()
})

beforeEach(() => {
  direct.reset()
})

after(() => {
  resetAdapterKit()
})

// ---------------------------------------------------------------- 8 tests --
describe('adapter registration and lookup', () => {
  it('installBundledAdapters registers the four bundled sources', () => {
    installBundledAdapters()
    assert.deepEqual(listAdapters().map(a => a.id), ['composio', 'direct', 'mcpSkills', 'printingPress'])
  })

  it('installBundledAdapters is idempotent and reports newly installed ids', () => {
    resetAdapterKit()
    assert.deepEqual(installBundledAdapters(), ['printingPress', 'composio', 'mcpSkills', 'direct'])
    assert.deepEqual(installBundledAdapters(), [])
    assert.equal(listAdapters().length, 4)
  })

  it('getAdapter returns the exact registered adapter object', () => {
    assert.strictEqual(getAdapter('mcpSkills'), mcpSkills)
    assert.strictEqual(getAdapter('direct'), direct)
  })

  it('getAdapter throws UNKNOWN_SOURCE with the requested id in the message', () => {
    assert.throws(() => getAdapter('missingSource'), (err: any) =>
      err instanceof AdapterError && err.code === 'UNKNOWN_SOURCE' && err.source === 'missingSource')
  })

  it('registerAdapter rejects duplicate source ids', () => {
    assert.throws(() => registerAdapter(composio), (err: any) =>
      err instanceof AdapterError && err.code === 'DUPLICATE_ADAPTER' && err.source === 'composio')
  })

  it('registerAdapter reports every problem with a malformed adapter', () => {
    assert.throws(() => registerAdapter({ id: 'bad one' } as unknown as ExternalAdapter), (err: any) => {
      if (!(err instanceof AdapterError) || err.code !== 'INVALID_ADAPTER') return false
      return err.message.includes('id') && err.message.includes('displayName')
        && err.message.includes('description') && err.message.includes('discover')
    })
  })

  it('registerAdapter accepts a well-formed adapter; unregisterAdapter removes it', () => {
    const sample: ExternalAdapter = {
      id: 'sampleSource',
      displayName: 'Sample Source',
      description: 'Temporary adapter used only by this test suite.',
      discover: () => [],
    }
    registerAdapter(sample)
    assert.equal(hasAdapter('sampleSource'), true)
    assert.equal(unregisterAdapter('sampleSource'), true)
    assert.equal(unregisterAdapter('sampleSource'), false)
    assert.equal(hasAdapter('sampleSource'), false)
  })

  it('listAdapters exposes id, displayName, and description for every source', () => {
    const infos = listAdapters()
    assert.equal(infos.length, 4)
    for (const info of infos) {
      assert.equal(typeof info.id, 'string')
      assert.ok(info.id.length > 0)
      assert.equal(typeof info.displayName, 'string')
      assert.ok(info.displayName.length > 0)
      assert.equal(typeof info.description, 'string')
      assert.ok(info.description.length > 0)
    }
  })
})

// ---------------------------------------------------------------- 7 tests --
describe('discoverFrom — bundled catalogues', () => {
  it('yields the expected number of candidates per source with the right kinds', async () => {
    const expected = [
      ['printingPress', 7, 'document'],
      ['composio', 6, 'tool'],
      ['mcpSkills', 6, 'skill'],
      ['direct', 3, 'note'],
    ] as const
    for (const [sourceId, count, kind] of expected) {
      const result = await discoverFrom(sourceId)
      assert.equal(result.source, sourceId)
      assert.equal(result.candidates.length, count)
      assert.equal(result.rejected.length, 0)
      for (const entry of result.candidates) assert.equal(entry.kind, kind)
    }
  })

  it('direct starts from its three seed notes', async () => {
    assert.equal(direct.size(), 3)
    const result = await discoverFrom('direct')
    assert.deepEqual(result.candidates.map(c => c.localId), ['note-001', 'note-002', 'note-003'])
    assert.equal(direct.size(), 3) // discovery does not mutate the source
  })

  it('candidate ids are namespaced and catalogue order is stable', async () => {
    const result = await discoverFrom('printingPress')
    assert.deepEqual(result.candidates.map(c => c.id), [
      'printingPress:pp-001', 'printingPress:pp-002', 'printingPress:pp-003', 'printingPress:pp-004',
      'printingPress:pp-005', 'printingPress:pp-006', 'printingPress:pp-007',
    ])
  })

  it('discovery is deterministic across repeated runs', async () => {
    const first = await discoverFrom('mcpSkills')
    const second = await discoverFrom('mcpSkills')
    assert.deepEqual(second, first)
  })

  it('checksums are 8-hex and unique within each catalogue', async () => {
    for (const sourceId of ['printingPress', 'composio', 'mcpSkills', 'direct']) {
      const { candidates } = await discoverFrom(sourceId)
      const checksums = candidates.map(c => c.checksum)
      for (const checksum of checksums) assert.match(checksum, /^[0-9a-f]{8}$/)
      assert.equal(new Set(checksums).size, checksums.length)
    }
  })

  it('tags are sorted and de-duplicated during normalization', async () => {
    direct.add({
      localId: 'tag-norm-1',
      kind: 'note',
      title: 'Tag normalization sample',
      summary: 'Checks sorting and de-duplication.',
      tags: ['zebra', 'alpha', 'zebra', 'beta'],
    })
    const { candidates } = await discoverFrom('direct')
    const entry = candidates.find(c => c.localId === 'tag-norm-1')
    assert.ok(entry, 'normalized candidate is present')
    assert.deepEqual(entry.tags, ['alpha', 'beta', 'zebra'])
  })

  it('omitted payloads default to an empty object (and summaries to an empty string)', async () => {
    direct.add({ localId: 'bare-1', kind: 'note', title: 'Bare record sample' })
    const { candidates } = await discoverFrom('direct')
    const entry = candidates.find(c => c.localId === 'bare-1')
    assert.ok(entry)
    assert.deepEqual(entry.payload, {})
    assert.equal(entry.summary, '')
  })
})

// ---------------------------------------------------------------- 8 tests --
describe('discoverFrom — failure handling', () => {
  it('rejects unknown sources with UNKNOWN_SOURCE', async () => {
    await assert.rejects(discoverFrom('missingSource'), (err: any) =>
      err instanceof AdapterError && err.code === 'UNKNOWN_SOURCE' && err.source === 'missingSource')
  })

  it('wraps adapter exceptions as DISCOVERY_FAILED preserving the cause', async () => {
    const broken: ExternalAdapter = {
      id: 'brokenSource',
      displayName: 'Broken Source',
      description: 'Throws from discover().',
      discover: () => { throw new Error('boom') },
    }
    registerAdapter(broken)
    try {
      await assert.rejects(discoverFrom('brokenSource'), (err: any) =>
        err instanceof AdapterError && err.code === 'DISCOVERY_FAILED'
          && err.cause instanceof Error && err.cause.message === 'boom')
    } finally {
      unregisterAdapter('brokenSource')
    }
  })

  it('rejects adapters whose discover() returns a non-array', async () => {
    const notAnArray: ExternalAdapter = {
      id: 'nonArraySource',
      displayName: 'Non-array Source',
      description: 'Returns a number.',
      discover: () => 42 as unknown as AdapterRecord[],
    }
    registerAdapter(notAnArray)
    try {
      await assert.rejects(discoverFrom('nonArraySource'), (err: any) =>
        err instanceof AdapterError && err.code === 'DISCOVERY_FAILED' && err.message.includes('array'))
    } finally {
      unregisterAdapter('nonArraySource')
    }
  })

  it('collects invalid records in rejected instead of throwing', async () => {
    direct.add(
      { localId: 'bad-kind-1', kind: 'chapter', title: 'Invalid kind sample' } as unknown as AdapterRecord,
      { localId: 'extra-note-1', kind: 'note', title: 'Valid record alongside a bad one', summary: 'Still discovered.' },
    )
    const result = await discoverFrom('direct')
    assert.equal(result.rejected.length, 1)
    assert.equal(result.rejected[0].localId, 'bad-kind-1')
    assert.match(result.rejected[0].reason, /kind/)
    assert.equal(result.candidates.length, 4) // 3 seeds + extra-note-1
  })

  it('reports (missing) for records without a usable localId', async () => {
    direct.add({ kind: 'note', title: 'No local id' } as unknown as AdapterRecord)
    const result = await discoverFrom('direct')
    assert.equal(result.rejected.length, 1)
    assert.equal(result.rejected[0].localId, '(missing)')
  })

  it('rejects blank titles', async () => {
    direct.add({ localId: 'blank-title-1', kind: 'note', title: '   ' })
    const result = await discoverFrom('direct')
    assert.equal(result.rejected.length, 1)
    assert.match(result.rejected[0].reason, /title/)
  })

  it('rejects non-string tags', async () => {
    direct.add({ localId: 'bad-tags-1', kind: 'note', title: 'Bad tags sample', tags: ['ok', 7] } as unknown as AdapterRecord)
    const result = await discoverFrom('direct')
    assert.equal(result.rejected.length, 1)
    assert.match(result.rejected[0].reason, /tags/)
  })

  it('rejects non-object payloads', async () => {
    direct.add({ localId: 'bad-payload-1', kind: 'note', title: 'Bad payload sample', payload: [1, 2] } as unknown as AdapterRecord)
    const result = await discoverFrom('direct')
    assert.equal(result.rejected.length, 1)
    assert.match(result.rejected[0].reason, /payload/)
  })
})

// ---------------------------------------------------------------- 2 tests --
describe('stableChecksum', () => {
  it('is deterministic and insensitive to key order', () => {
    const a = stableChecksum({ a: [1, 2], b: 'x', c: { d: null } })
    const b = stableChecksum({ c: { d: null }, b: 'x', a: [1, 2] })
    assert.equal(a, b)
    assert.equal(stableChecksum({ a: [1, 2], b: 'x', c: { d: null } }), a)
    assert.notEqual(a, stableChecksum({ a: [1, 3], b: 'x', c: { d: null } }))
  })

  it('separates records that differ only by payload', async () => {
    direct.add(
      { localId: 'chk-a', kind: 'note', title: 'Checksum sample', summary: 'Identical text, different payloads.', payload: { n: 1 } },
      { localId: 'chk-b', kind: 'note', title: 'Checksum sample', summary: 'Identical text, different payloads.', payload: { n: 2 } },
    )
    const { candidates } = await discoverFrom('direct')
    const a = candidates.find(c => c.localId === 'chk-a')
    const b = candidates.find(c => c.localId === 'chk-b')
    assert.ok(a && b)
    assert.notEqual(a.checksum, b.checksum)
  })
})

// --------------------------------------------------------------- 13 tests --
describe('importFrom — stub registry', () => {
  it('imports a full catalogue into a stub registry', async () => {
    const registry = createStubRegistry()
    const result = await importFrom('printingPress', { registry, now: fixedClock })
    assert.equal(result.dryRun, false)
    assert.equal(result.imported.length, 7)
    assert.equal(result.skipped.length, 0)
    assert.equal(result.planned.length, 0)
    assert.equal(result.failed.length, 0)
    assert.deepEqual(result.unmatched, [])
    for (const ref of result.imported) assert.match(ref.id, /^printingPress:pp-\d{3}$/)
    assert.equal(registry.entries.size, 7)
  })

  it('stores complete registry entries with the injected clock importedAt', async () => {
    const registry = createStubRegistry()
    await importFrom('printingPress', { registry, now: fixedClock })
    const stored = registry.entries.get('printingPress:pp-001')
    assert.ok(stored)
    const { candidates } = await discoverFrom('printingPress')
    const candidate = candidates.find(c => c.id === 'printingPress:pp-001')
    assert.ok(candidate)
    assert.equal(stored.importedAt, FIXED_NOW)
    assert.equal(stored.checksum, candidate.checksum)
    assert.equal(stored.source, 'printingPress')
    assert.equal(stored.kind, 'document')
    assert.equal(stored.title, 'Baseline Grid — Typesetting Spec')
  })

  it('re-imports skip duplicates', async () => {
    const registry = createStubRegistry()
    await importFrom('composio', { registry, now: fixedClock })
    const second = await importFrom('composio', { registry, now: fixedClock })
    assert.equal(second.imported.length, 0)
    assert.equal(second.skipped.length, 6)
    for (const skip of second.skipped) assert.equal(skip.reason, 'duplicate')
    assert.equal(registry.entries.size, 6)
  })

  it('flags stale duplicates when the stored checksum diverges', async () => {
    const registry = createStubRegistry()
    await importFrom('printingPress', { registry, now: fixedClock })
    const stored = registry.entries.get('printingPress:pp-001')
    assert.ok(stored)
    stored.checksum = 'deadbeef'
    const second = await importFrom('printingPress', { registry, now: fixedClock })
    const stale = second.skipped.find(s => s.id === 'printingPress:pp-001')
    assert.ok(stale)
    assert.equal(stale.reason, 'stale-duplicate')
    assert.equal(second.skipped.length, 7)
  })

  it('dryRun plans imports without touching the registry', async () => {
    const registry = createStubRegistry()
    const result = await importFrom('mcpSkills', { registry, dryRun: true })
    assert.equal(result.dryRun, true)
    assert.equal(result.imported.length, 0)
    assert.equal(result.planned.length, 6)
    assert.equal(result.skipped.length, 0)
    assert.equal(registry.entries.size, 0)
  })

  it('dryRun still reports already-present entries as duplicates', async () => {
    const registry = createStubRegistry()
    await importFrom('mcpSkills', { registry, now: fixedClock })
    const dry = await importFrom('mcpSkills', { registry, dryRun: true })
    assert.equal(dry.planned.length, 0)
    assert.equal(dry.skipped.length, 6)
    assert.equal(registry.entries.size, 6)
  })

  it('kinds filter restricts what is imported', async () => {
    direct.add({ localId: 'mixed-tool-1', kind: 'tool', title: 'Cross-kind tool sample', summary: 'Should be filtered out.' })
    const registry = createStubRegistry()
    const result = await importFrom('direct', { registry, kinds: ['note'] })
    assert.equal(result.imported.length, 3)
    assert.equal(registry.has('direct:mixed-tool-1'), false)
    assert.equal(registry.entries.size, 3)
  })

  it('tags filter imports entries matching a requested tag', async () => {
    const registry = createStubRegistry()
    const result = await importFrom('printingPress', { registry, tags: ['spec'] })
    assert.deepEqual(result.imported.map(r => r.id), [
      'printingPress:pp-001', 'printingPress:pp-003', 'printingPress:pp-006',
    ])
  })

  it('tags filter accepts several tags with any-match semantics', async () => {
    const registry = createStubRegistry()
    const result = await importFrom('printingPress', { registry, tags: ['ink', 'imposition'] })
    assert.deepEqual(result.imported.map(r => r.id), ['printingPress:pp-002', 'printingPress:pp-003'])
  })

  it('ids filter imports only selected entries and reports unmatched ids', async () => {
    const registry = createStubRegistry()
    const result = await importFrom('composio', { registry, ids: ['composio:cmp-001', 'composio:cmp-999'] })
    assert.deepEqual(result.imported.map(r => r.id), ['composio:cmp-001'])
    assert.deepEqual(result.unmatched, ['composio:cmp-999'])
  })

  it('importedAt follows the injected clock', async () => {
    const registryA = createStubRegistry()
    const registryB = createStubRegistry()
    await importFrom('direct', { registry: registryA, now: () => 111 })
    await importFrom('direct', { registry: registryB, now: () => 222 })
    assert.equal(registryA.entries.get('direct:note-001').importedAt, 111)
    assert.equal(registryB.entries.get('direct:note-001').importedAt, 222)
  })

  it('registry.register failures are recorded as failed, not thrown', async () => {
    const registry = createStubRegistry()
    const original = registry.register
    registry.register = (entry: any) => {
      if (entry.id === 'printingPress:pp-002') throw new Error('stub register exploded')
      return original(entry)
    }
    const result = await importFrom('printingPress', { registry, now: fixedClock })
    assert.equal(result.imported.length, 6)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].localId, 'pp-002')
    assert.match(result.failed[0].reason, /register/)
    assert.equal(registry.entries.size, 6)
  })

  it('invalid options fail fast with INVALID_OPTIONS', async () => {
    await assert.rejects(importFrom('printingPress', { registry: {} as any }), (err: any) =>
      err instanceof AdapterError && err.code === 'INVALID_OPTIONS' && err.message.includes('register'))
    await assert.rejects(importFrom('printingPress', { now: 123 as any }), (err: any) =>
      err instanceof AdapterError && err.code === 'INVALID_OPTIONS' && err.message.includes('now'))
    await assert.rejects(importFrom('printingPress', { tags: 'spec' as any }), (err: any) =>
      err instanceof AdapterError && err.code === 'INVALID_OPTIONS' && err.message.includes('tags'))
  })
})

// ---------------------------------------------------------------- 3 tests --
describe('importAll', () => {
  it('imports every registered source into the target registry', async () => {
    const registry = createStubRegistry()
    const results = await importAll({ registry, now: fixedClock })
    assert.deepEqual(results.map(r => r.source), ['composio', 'direct', 'mcpSkills', 'printingPress'])
    assert.equal(results.reduce((sum, r) => sum + r.imported.length, 0), 22)
    assert.equal(registry.entries.size, 22)
  })

  it('honours dryRun across all sources', async () => {
    const registry = createStubRegistry()
    const results = await importAll({ registry, dryRun: true })
    assert.equal(results.length, 4)
    assert.equal(results.reduce((s, r) => s + r.planned.length, 0), 22)
    assert.equal(results.reduce((s, r) => s + r.imported.length, 0), 0)
    assert.equal(registry.entries.size, 0)
  })

  it('returns an empty array when no adapters are registered', async () => {
    resetAdapterKit()
    try {
      const results = await importAll({ registry: createStubRegistry() })
      assert.deepEqual(results, [])
    } finally {
      installBundledAdapters()
    }
  })
})

// ---------------------------------------------------------------- 2 tests --
describe('registry seam — default CR-006 target', () => {
  // SEAM-DEPENDENT: exercises the assumed CR-006 surface (register/has/get via
  // the default target). Failure here means the seam needs reconciliation —
  // expected failure shapes are AdapterError REGISTRY_UNAVAILABLE (module
  // missing), REGISTRY_SEAM_MISMATCH (surface differs), or failed[] entries
  // (register rejects the entry shape). See REPORT.md paste requests.
  it('importFrom without an override writes through the default registry (smoke)', async () => {
    const result = await importFrom('mcpSkills')
    assert.equal(result.failed.length, 0)
    assert.equal(result.imported.length + result.skipped.length, 6)
    for (const ref of [...result.imported, ...result.skipped]) assert.match(ref.id, /^mcpSkills:mcp-\d{3}$/)
  })

  it('a second default-registry import reports duplicates', async () => {
    // Depends on the previous smoke test having run (sequential execution).
    const second = await importFrom('mcpSkills')
    assert.equal(second.imported.length, 0)
    assert.equal(second.skipped.length, 6)
  })
})

// ---------------------------------------------------------------- 6 tests --
describe('bundled adapters — fixture invariants', () => {
  it('bundles exactly the four expected adapters in a fixed order', () => {
    assert.deepEqual(bundledAdapters.map(a => a.id), ['printingPress', 'composio', 'mcpSkills', 'direct'])
  })

  it('printingPress fixtures are well-formed documents', async () => {
    const records = await printingPress.discover()
    assert.equal(records.length, 7)
    const localIds = records.map(r => r.localId)
    assert.equal(new Set(localIds).size, 7)
    for (const record of records) {
      assert.equal(record.kind, 'document')
      assert.match(record.localId, /^pp-\d{3}$/)
      assert.equal(typeof record.payload?.pages, 'number')
      assert.ok((record.payload?.pages as number) > 0)
      assert.ok(['pdf', 'csv'].includes(record.payload?.format as string))
    }
  })

  it('composio fixtures are well-formed tools', async () => {
    const records = await composio.discover()
    assert.equal(records.length, 6)
    for (const record of records) {
      assert.equal(record.kind, 'tool')
      assert.match(record.localId, /^cmp-\d{3}$/)
      assert.equal(typeof record.payload?.appName, 'string')
      assert.ok((record.payload?.appName as string).length > 0)
    }
  })

  it('mcpSkills fixtures are well-formed skills', async () => {
    const records = await mcpSkills.discover()
    assert.equal(records.length, 6)
    for (const record of records) {
      assert.equal(record.kind, 'skill')
      assert.match(record.localId, /^mcp-\d{3}$/)
      assert.equal(record.payload?.protocol, 'mcp')
      const invocations = record.payload?.invocations
      assert.ok(Array.isArray(invocations) && invocations.length > 0)
    }
  })

  it('every bundled record carries non-empty title, summary, and tags', async () => {
    for (const adapter of bundledAdapters) {
      const records = await adapter.discover()
      assert.ok(Array.isArray(records), `${adapter.id} discover() returned a non-array`)
      for (const record of records) {
        assert.equal(typeof record.title, 'string')
        assert.ok(record.title.length > 0)
        assert.equal(typeof record.summary, 'string')
        assert.ok((record.summary ?? '').length > 0)
        assert.ok(Array.isArray(record.tags))
        for (const tag of record.tags ?? []) assert.ok(typeof tag === 'string' && tag.length > 0)
      }
    }
  })

  it('adapter metadata (ids, display names, descriptions) is sane', () => {
    for (const adapter of bundledAdapters) {
      assert.match(adapter.id, /^[A-Za-z][A-Za-z0-9_-]*$/)
      assert.ok(!adapter.id.includes(':'))
      assert.ok(adapter.displayName.length > 0)
      assert.ok(adapter.description.length > 0)
    }
  })
})

// ---------------------------------------------------------------- 4 tests --
describe('direct adapter — runtime behaviour', () => {
  it('add() appends records and reports the new size', async () => {
    assert.equal(direct.size(), 3)
    const size = direct.add({ localId: 'runtime-1', kind: 'note', title: 'Runtime-added note', summary: 'Added through direct.add().' })
    assert.equal(size, 4)
    assert.equal(direct.size(), 4)
    const { candidates } = await discoverFrom('direct')
    assert.equal(candidates.length, 4)
    assert.ok(candidates.some(c => c.id === 'direct:runtime-1'))
  })

  it('clear() empties the catalogue', async () => {
    direct.clear()
    assert.equal(direct.size(), 0)
    const result = await discoverFrom('direct')
    assert.equal(result.candidates.length, 0)
    assert.equal(result.rejected.length, 0)
  })

  it('reset() restores the deterministic seed catalogue', async () => {
    direct.add({ localId: 'flotsam-1', kind: 'note', title: 'Flotsam' })
    direct.clear()
    direct.reset()
    assert.equal(direct.size(), 3)
    const { candidates } = await discoverFrom('direct')
    assert.deepEqual(candidates.map(c => c.localId), ['note-001', 'note-002', 'note-003'])
  })

  it('records added at runtime import like any other candidate', async () => {
    direct.add({ localId: 'runtime-2', kind: 'note', title: 'Importable runtime note', summary: 'Imported via importFrom.', tags: ['runtime'] })
    const registry = createStubRegistry()
    const result = await importFrom('direct', { registry, now: fixedClock })
    assert.equal(result.imported.length, 4)
    assert.ok(result.imported.some(r => r.id === 'direct:runtime-2'))
  })
})

// ---------------------------------------------------------------- 1 test ---
describe('entry kinds', () => {
  it('ENTRY_KINDS lists the canonical kinds and isEntryKind guards them', () => {
    assert.deepEqual(ENTRY_KINDS, ['document', 'tool', 'skill', 'note'])
    assert.equal(isEntryKind('tool'), true)
    assert.equal(isEntryKind('toolkit'), false)
    assert.equal(isEntryKind(42), false)
    assert.equal(isEntryKind(null), false)
  })
})
