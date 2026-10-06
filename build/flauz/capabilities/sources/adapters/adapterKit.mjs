// adapterKit.mjs — CR-007 · External Source Adapters (Phase C-R, B2, wave 2)
//
// The adapter kit: a registry of external source adapters plus the pipelines
// that run over the CR-006 registry:
//
//   discoverFrom(sourceId)          discover → validate → normalize
//   importFrom(sourceId, options?)  discover → filter → dedupe → register
//   importAll(options?)             importFrom for every registered source
//
// Runtime: plain ESM JavaScript (no build step, no dependencies).
// Types:   adapterKit.d.mts (hand-maintained — keep the two files in sync).
//
// CR-006 registry seam: this module lazily imports ./registry.mjs and calls
// exactly three functions on it — register(entry), has(id), get(id). Nothing
// else from the registry is touched. Failure modes are self-diagnosing:
//   REGISTRY_UNAVAILABLE     ./registry.mjs could not be loaded at all
//   REGISTRY_SEAM_MISMATCH   module loaded but the surface differs
// If the real CR-006 surface differs, fix bindRegistryModule() below; nothing
// else in this file needs to change.

export const ENTRY_KINDS = ['document', 'tool', 'skill', 'note']

const ENTRY_KIND_SET = new Set(ENTRY_KINDS)

export function isEntryKind(value) {
  return typeof value === 'string' && ENTRY_KIND_SET.has(value)
}

export class AdapterError extends Error {
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'AdapterError'
    this.code = code
    this.source = options.source === undefined ? null : options.source
  }
}

// Error codes thrown by this kit:
//   UNKNOWN_SOURCE, DUPLICATE_ADAPTER, INVALID_ADAPTER, DISCOVERY_FAILED,
//   INVALID_OPTIONS, REGISTRY_SEAM_MISMATCH, REGISTRY_UNAVAILABLE

// ---------------------------------------------------------------------------
// Deterministic checksums
// ---------------------------------------------------------------------------

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? 'null' : encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`
}

/** FNV-1a (32-bit) over the canonical JSON form, domain-prefixed. */
export function stableChecksum(value) {
  const input = `catalogue/v1|${canonicalize(value)}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Registry seam (CR-006) — assumed surface: register/has/get
// ---------------------------------------------------------------------------

const REGISTRY_MODULE = '../../registry/registry.mjs'
const REGISTRY_SEAM_FUNCTIONS = ['register', 'has', 'get']

// Station seam-completion: the REAL CR-006 surface is createRegistry(...)
// returning a RegistryRuntime (discover/register/inspect/...), not the
// module-level register/has/get this kit originally assumed. The kit's
// narrow three-function target interface stays (it is what callers and the
// 52 hermetic stub-registry tests speak); the DEFAULT target now binds the
// real runtime through the translation adapter below.

// Kit adapter family -> the frozen ZC-007 SOURCE_KINDS entry.
const SOURCE_KIND_BY_FAMILY = {
  printingPress: 'printing-press',
  composio: 'composio',
  mcpSkills: 'mcp-catalog',
  direct: 'user-spec',
}

// Kit entry kind -> the frozen ZC-006 pack artifact kind. 'document' and
// 'note' are NOT capability artifacts: they are DISCOVERED into the exchange
// (journaled, visible) but never registered — the registry's own frozen
// artifact-kind table is the authority.
const ARTIFACT_KIND_BY_KIND = {
  skill: 'skill-instructions',
  tool: 'mcp-server',
}

async function createDefaultRegistryTarget() {
  let moduleNamespace
  try {
    moduleNamespace = await import(REGISTRY_MODULE)
  } catch (cause) {
    throw new AdapterError(
      'REGISTRY_UNAVAILABLE',
      `Could not load the CR-006 registry module "${REGISTRY_MODULE}". ` +
        'Pass options.registry to importFrom/importAll to bind an explicit registry runtime.',
      { cause },
    )
  }
  if (typeof moduleNamespace.createRegistry !== 'function') {
    throw new AdapterError(
      'REGISTRY_SEAM_MISMATCH',
      `The CR-006 module at "${REGISTRY_MODULE}" does not export createRegistry (the runtime factory).`,
    )
  }
  // In-memory fsPort (the registry test's own hermetic pattern): the REAL
  // eight-state machine + journal/snapshot discipline, session-scoped
  // persistence. Runtime-real lanes bind their own disk-backed runtime via
  // options.registry. Deterministic clock: no Date.now (the kit's law).
  const files = new Map()
  const enoent = path => {
    const err = new Error("ENOENT: no such file or directory, open '" + path + "'")
    err.code = 'ENOENT'
    return err
  }
  const fsPort = {
    async readFile(path) {
      const text = files.get(path)
      if (text === undefined) throw enoent(path)
      return text
    },
    async writeFile(path, text) {
      files.set(path, text)
    },
    async appendFile(path, text) {
      files.set(path, (files.get(path) ?? '') + text)
    },
    async mkdir() {},
    async readdir() {
      return []
    },
  }
  const registry = moduleNamespace.createRegistry({
    root: '/cr007-default-registry',
    clock: () => 0,
    fsPort,
    scope: { workspaceId: 'workspace-local', tenantId: 'tenant-local' },
  })
  const loaded = await registry.load()
  if (loaded !== null && typeof loaded === 'object' && loaded.ok === false) {
    throw new AdapterError(
      'REGISTRY_UNAVAILABLE',
      'The default CR-006 registry refused load: ' + JSON.stringify(loaded.refusal),
    )
  }
  // kit id -> the import record (the kit-side view of the registry entry).
  const importedById = new Map()

  return {
    async has(id) {
      return importedById.has(id)
    },
    async get(id) {
      const record = importedById.get(id)
      return record === undefined ? null : record
    },
    async register(entry) {
      const sourceKind = SOURCE_KIND_BY_FAMILY[entry.source]
      if (sourceKind === undefined) {
        throw new AdapterError(
          'REGISTRY_SEAM_MISMATCH',
          `No frozen ZC-007 source kind for adapter family "${entry.source}".`,
        )
      }
      const artifactKind = ARTIFACT_KIND_BY_KIND[entry.kind]
      const discovery = {
        sourceKind,
        name: entry.title,
        ...(artifactKind !== undefined ? { artifactKind } : {}),
        provenance: {
          origin: 'cr007-adapter-kit',
          family: entry.source,
          localId: entry.localId,
          kitChecksum: entry.checksum,
        },
      }
      const discovered = await registry.discover(discovery)
      if (discovered.ok !== true) {
        throw new AdapterError(
          'REGISTRY_REFUSED',
          'discover refused: ' + JSON.stringify(discovered.refusal),
          { source: entry.source },
        )
      }
      if (artifactKind === undefined) {
        // Discovered-only: visible in the exchange, never registered (the
        // frozen artifact-kind table is the admission authority).
        importedById.set(entry.id, {
          checksum: entry.checksum,
          registryEntryId: discovered.entryId,
          state: discovered.state,
        })
        return {
          registered: false,
          reason: 'discovered-only (not a frozen capability artifact kind)',
          registryEntryId: discovered.entryId,
        }
      }
      // The registry derives the content hash from the discovery record when
      // absent; replicate the exact derivation (canonicalJSON + sha256Hex,
      // both re-exported by the registry module) so the register digest
      // matches the discovered entry byte-for-byte.
      const digest = moduleNamespace.sha256Hex(moduleNamespace.canonicalJSON(discovery))
      const registered = await registry.register({
        entryId: discovered.entryId,
        digest,
        version: (entry.payload && typeof entry.payload.version === 'string' && entry.payload.version !== '') ? entry.payload.version : '1.0.0',
        // Fixture-grade import metadata, DISCLOSED through provenance: the
        // catalogues are deterministic fixtures, so the declared license /
        // minimal permissions / lane platform are fixture defaults — the
        // CR-008 verification gate is where real metadata must be proven.
        license: 'fixture:' + entry.source,
        permissions: ['read-files'],
        platforms: ['linux-x64'],
        endpoints: [],
        artifactKind,
        provenance: {
          origin: 'cr007-adapter-kit',
          family: entry.source,
          localId: entry.localId,
          kitChecksum: entry.checksum,
          importedAt: entry.importedAt,
        },
      })
      if (registered.ok !== true) {
        throw new AdapterError(
          'REGISTRY_REFUSED',
          'register refused: ' + JSON.stringify(registered.refusal),
          { source: entry.source },
        )
      }
      importedById.set(entry.id, {
        checksum: entry.checksum,
        registryEntryId: registered.entryId,
        state: registered.state,
      })
      return { registered: true, registryEntryId: registered.entryId, state: registered.state }
    },
  }
}

let defaultRegistryTarget = null
let defaultRegistryPromise = null

async function resolveRegistryTarget(override) {
  if (override !== undefined) return override
  if (defaultRegistryTarget !== null) return defaultRegistryTarget
  if (defaultRegistryPromise === null) {
    defaultRegistryPromise = createDefaultRegistryTarget()
    // On failure, drop the cached promise so a later call retries.
    defaultRegistryPromise.then(
      target => { defaultRegistryTarget = target },
      () => { defaultRegistryPromise = null },
    )
  }
  return defaultRegistryPromise
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

const adapters = new Map()

function show(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function validateAdapter(adapter) {
  if (adapter === null || typeof adapter !== 'object') return ['adapter must be a non-null object']
  const problems = []
  if (typeof adapter.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(adapter.id)) {
    problems.push(`id must match /^[A-Za-z][A-Za-z0-9_-]*$/ (got ${show(adapter.id)})`)
  }
  if (typeof adapter.displayName !== 'string' || adapter.displayName.trim() === '') {
    problems.push('displayName must be a non-empty string')
  }
  if (typeof adapter.description !== 'string' || adapter.description.trim() === '') {
    problems.push('description must be a non-empty string')
  }
  if (typeof adapter.discover !== 'function') {
    problems.push('discover must be a function')
  }
  return problems
}

export function registerAdapter(adapter) {
  const problems = validateAdapter(adapter)
  if (problems.length > 0) {
    throw new AdapterError('INVALID_ADAPTER', `Adapter rejected: ${problems.join('; ')}`)
  }
  if (adapters.has(adapter.id)) {
    throw new AdapterError(
      'DUPLICATE_ADAPTER',
      `An adapter is already registered for source "${adapter.id}".`,
      { source: adapter.id },
    )
  }
  adapters.set(adapter.id, adapter)
}

export function unregisterAdapter(id) {
  return adapters.delete(id)
}

export function hasAdapter(id) {
  return adapters.has(id)
}

export function getAdapter(id) {
  const adapter = adapters.get(id)
  if (adapter === undefined) {
    const known = [...adapters.keys()].sort()
    throw new AdapterError(
      'UNKNOWN_SOURCE',
      `No adapter registered for source ${show(id)}. Registered sources: ${known.length > 0 ? known.join(', ') : '(none)'}.`,
      { source: typeof id === 'string' ? id : null },
    )
  }
  return adapter
}

export function listAdapters() {
  return [...adapters.values()]
    .map(adapter => ({ id: adapter.id, displayName: adapter.displayName, description: adapter.description }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Test/utility hook: clears registered adapters and the cached registry target. */
export function resetAdapterKit() {
  adapters.clear()
  defaultRegistryTarget = null
  defaultRegistryPromise = null
}

// ---------------------------------------------------------------------------
// Record validation and normalization
// ---------------------------------------------------------------------------

const LOCAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function validateRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return ['record must be a non-null object']
  }
  const problems = []
  if (typeof record.localId !== 'string' || !LOCAL_ID_PATTERN.test(record.localId)) {
    problems.push(`localId must be a string matching ${LOCAL_ID_PATTERN} (got ${show(record.localId)})`)
  }
  if (!isEntryKind(record.kind)) {
    problems.push(`kind must be one of: ${ENTRY_KINDS.join(', ')} (got ${show(record.kind)})`)
  }
  if (typeof record.title !== 'string' || record.title.trim() === '') {
    problems.push('title must be a non-empty string')
  }
  if (record.summary !== undefined && typeof record.summary !== 'string') {
    problems.push('summary must be a string when provided')
  }
  if (record.tags !== undefined) {
    const tags = record.tags
    if (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || tag.trim() === '')) {
      problems.push('tags must be an array of non-empty strings when provided')
    }
  }
  if (record.payload !== undefined &&
      (typeof record.payload !== 'object' || record.payload === null || Array.isArray(record.payload))) {
    problems.push('payload must be a plain object when provided')
  }
  return problems
}

function describeLocalId(record) {
  if (record !== null && typeof record === 'object' && typeof record.localId === 'string') return record.localId
  return '(missing)'
}

function normalizeRecord(sourceId, record) {
  const tags = [...new Set(record.tags ?? [])].sort()
  const entry = {
    id: `${sourceId}:${record.localId}`,
    localId: record.localId,
    source: sourceId,
    kind: record.kind,
    title: record.title.trim(),
    summary: typeof record.summary === 'string' ? record.summary.trim() : '',
    tags,
    payload: record.payload === undefined ? {} : structuredClone(record.payload),
  }
  entry.checksum = stableChecksum({
    source: entry.source,
    localId: entry.localId,
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    payload: entry.payload,
  })
  return entry
}

// ---------------------------------------------------------------------------
// discoverFrom
// ---------------------------------------------------------------------------

export async function discoverFrom(sourceId) {
  const adapter = getAdapter(sourceId)
  let records
  try {
    records = await adapter.discover()
  } catch (cause) {
    throw new AdapterError('DISCOVERY_FAILED', `Adapter "${sourceId}" failed during discover().`, { cause, source: sourceId })
  }
  if (!Array.isArray(records)) {
    throw new AdapterError(
      'DISCOVERY_FAILED',
      `Adapter "${sourceId}".discover() must return an array of records (got ${show(records)}).`,
      { source: sourceId },
    )
  }
  const candidates = []
  const rejected = []
  for (const record of records) {
    const problems = validateRecord(record)
    if (problems.length > 0) {
      rejected.push({ localId: describeLocalId(record), reason: problems.join('; ') })
      continue
    }
    try {
      candidates.push(normalizeRecord(sourceId, record))
    } catch (cause) {
      rejected.push({
        localId: record.localId,
        reason: `normalization failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  }
  return { source: sourceId, candidates, rejected }
}

// ---------------------------------------------------------------------------
// importFrom / importAll
// ---------------------------------------------------------------------------

function validateImportOptions(options) {
  if (options.registry !== undefined) {
    const target = options.registry
    const problems = []
    if (target === null || typeof target !== 'object') {
      problems.push('registry must be an object')
    } else {
      for (const name of REGISTRY_SEAM_FUNCTIONS) {
        if (typeof target[name] !== 'function') problems.push(`registry.${name} must be a function`)
      }
    }
    if (problems.length > 0) throw new AdapterError('INVALID_OPTIONS', `Invalid import options: ${problems.join('; ')}`)
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new AdapterError('INVALID_OPTIONS', 'Invalid import options: now must be a function returning a number')
  }
  for (const key of ['kinds', 'tags', 'ids']) {
    if (options[key] !== undefined && !Array.isArray(options[key])) {
      throw new AdapterError('INVALID_OPTIONS', `Invalid import options: ${key} must be an array when provided`)
    }
  }
  if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') {
    throw new AdapterError('INVALID_OPTIONS', 'Invalid import options: dryRun must be a boolean when provided')
  }
}

function applyFilters(candidates, options) {
  const { kinds, tags, ids } = options
  if (kinds === undefined && tags === undefined && ids === undefined) return candidates
  const kindSet = kinds === undefined ? null : new Set(kinds)
  const tagSet = tags === undefined ? null : new Set(tags)
  const idSet = ids === undefined ? null : new Set(ids)
  return candidates.filter(entry =>
    (kindSet === null || kindSet.has(entry.kind)) &&
    (tagSet === null || entry.tags.some(tag => tagSet.has(tag))) &&
    (idSet === null || idSet.has(entry.id)))
}

function duplicateReason(existing, entry) {
  if (existing !== null && typeof existing === 'object' && typeof existing.checksum === 'string') {
    return existing.checksum === entry.checksum ? 'duplicate' : 'stale-duplicate'
  }
  return 'duplicate'
}

export async function importFrom(sourceId, options = {}) {
  validateImportOptions(options)
  getAdapter(sourceId) // fail fast on UNKNOWN_SOURCE before touching the registry
  const registry = await resolveRegistryTarget(options.registry)
  const discovery = await discoverFrom(sourceId)
  const selected = applyFilters(discovery.candidates, options)
  const unmatched = options.ids === undefined
    ? []
    : options.ids.filter(id => !selected.some(entry => entry.id === id))
  const now = options.now === undefined ? Date.now() : options.now()
  const imported = []
  const planned = []
  const skipped = []
  const failed = [...discovery.rejected]
  const dryRun = options.dryRun === true
  for (const entry of selected) {
    if (await registry.has(entry.id)) {
      skipped.push({ id: entry.id, reason: duplicateReason(await registry.get(entry.id), entry) })
      continue
    }
    if (dryRun) {
      planned.push({ id: entry.id, checksum: entry.checksum })
      continue
    }
    try {
      const outcome = await registry.register({ ...entry, importedAt: now })
      // The binding may report a discovered-only outcome (not a frozen
      // capability artifact): those entries are visible in the exchange
      // but never registered — reported as skipped, not imported.
      if (outcome !== null && typeof outcome === 'object' && outcome.registered === false) {
        skipped.push({ id: entry.id, reason: outcome.reason ?? 'discovered-only' })
      } else {
        imported.push({ id: entry.id, checksum: entry.checksum })
      }
    } catch (cause) {
      failed.push({
        localId: entry.localId,
        reason: `registry.register threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  }
  return { source: sourceId, dryRun, imported, planned, skipped, failed, unmatched }
}

export async function importAll(options = {}) {
  const results = []
  for (const info of listAdapters()) {
    results.push(await importFrom(info.id, options))
  }
  return results
}
