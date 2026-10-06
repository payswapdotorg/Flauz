// adapterKit.d.mts — hand-maintained types for adapterKit.mjs (CR-007, wave 2).
// Keep in sync with the runtime module. No runtime code lives here.
//
// AdapterError codes thrown by the kit: 'UNKNOWN_SOURCE', 'DUPLICATE_ADAPTER',
// 'INVALID_ADAPTER', 'DISCOVERY_FAILED', 'INVALID_OPTIONS',
// 'REGISTRY_SEAM_MISMATCH', 'REGISTRY_UNAVAILABLE'.

export type EntryKind = 'document' | 'tool' | 'skill' | 'note'

export const ENTRY_KINDS: readonly EntryKind[]

export function isEntryKind(value: unknown): value is EntryKind

export class AdapterError extends Error {
  readonly code: string
  readonly source: string | null
  constructor(code: string, message: string, options?: { source?: string; cause?: unknown })
}

/** FNV-1a-32 over canonical JSON (sorted keys), domain-prefixed with "catalogue/v1". */
export function stableChecksum(value: unknown): string

/** Raw record shape returned by an adapter's discover(). */
export interface AdapterRecord {
  localId: string
  kind: EntryKind
  title: string
  summary?: string
  tags?: readonly string[]
  payload?: Record<string, unknown>
}

/** Validated + normalized candidate produced by discoverFrom(). */
export interface CatalogueEntry {
  readonly id: string
  readonly localId: string
  readonly source: string
  readonly kind: EntryKind
  readonly title: string
  readonly summary: string
  readonly tags: readonly string[]
  readonly payload: Record<string, unknown>
  readonly checksum: string
}

export interface RejectedRecord {
  readonly localId: string
  readonly reason: string
}

export interface DiscoveryResult {
  readonly source: string
  readonly candidates: readonly CatalogueEntry[]
  readonly rejected: readonly RejectedRecord[]
}

export interface RegistryEntry extends CatalogueEntry {
  readonly importedAt: number
}

/**
 * The CR-006 registry seam. The kit calls exactly these three functions;
 * `get` results are only read for their `checksum` (if present).
 */
export interface RegistryTarget {
  register(entry: RegistryEntry): unknown
  has(id: string): boolean
  get(id: string): RegistryEntry | undefined
}

export interface ImportedRef {
  readonly id: string
  readonly checksum: string
}

export interface SkippedRef {
  readonly id: string
  readonly reason: 'duplicate' | 'stale-duplicate'
}

export interface ImportOptions {
  /** Override the registry target (default: the CR-006 registry). */
  registry?: RegistryTarget
  /** Read-only run: reports planned ids, writes nothing. */
  dryRun?: boolean
  /** Injectable clock used for importedAt (default: Date.now). */
  now?: () => number
  kinds?: readonly EntryKind[]
  /** Any-match semantics: an entry imports if it carries at least one listed tag. */
  tags?: readonly string[]
  /** Full candidate ids ("source:localId"). */
  ids?: readonly string[]
}

export interface ImportResult {
  readonly source: string
  readonly dryRun: boolean
  readonly imported: readonly ImportedRef[]
  readonly planned: readonly ImportedRef[]
  readonly skipped: readonly SkippedRef[]
  readonly failed: readonly RejectedRecord[]
  readonly unmatched: readonly string[]
}

export interface ExternalAdapter {
  /** Must not contain ':' — reserved as the namespace separator. */
  readonly id: string
  readonly displayName: string
  readonly description: string
  discover(): AdapterRecord[] | Promise<AdapterRecord[]>
}

/** direct extends the contract with runtime passthrough. */
export interface DirectAdapter extends ExternalAdapter {
  add(...records: AdapterRecord[]): number
  clear(): void
  reset(): void
  size(): number
}

export interface AdapterInfo {
  readonly id: string
  readonly displayName: string
  readonly description: string
}

export function registerAdapter(adapter: ExternalAdapter): void
export function unregisterAdapter(id: string): boolean
export function hasAdapter(id: string): boolean
export function getAdapter(id: string): ExternalAdapter
export function listAdapters(): AdapterInfo[]
export function resetAdapterKit(): void

export function discoverFrom(sourceId: string): Promise<DiscoveryResult>
export function importFrom(sourceId: string, options?: ImportOptions): Promise<ImportResult>
export function importAll(options?: ImportOptions): Promise<ImportResult[]>
