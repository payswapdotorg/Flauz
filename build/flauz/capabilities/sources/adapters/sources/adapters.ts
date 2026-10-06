// sources/adapters.ts — CR-007 (Phase C-R, B2, wave 2)
// Barrel for the four bundled adapters + explicit installer.
// Importing this module has no side effects — call installBundledAdapters().

import {
  hasAdapter,
  registerAdapter,
  type DirectAdapter,
  type ExternalAdapter,
} from '../adapterKit.mjs'
import { printingPress } from './printingPress.ts'
import { composio } from './composio.ts'
import { mcpSkills } from './mcpSkills.ts'
import { direct } from './direct.ts'

export { printingPress, composio, mcpSkills, direct }
export type { DirectAdapter, ExternalAdapter }

/** The four bundled adapters, in canonical bundle order. */
export const bundledAdapters: readonly ExternalAdapter[] = [
  printingPress,
  composio,
  mcpSkills,
  direct,
]

/**
 * Registers every bundled adapter that is not already present.
 * Returns the ids that were newly installed (bundle order). Idempotent.
 */
export function installBundledAdapters(): string[] {
  const installed: string[] = []
  for (const adapter of bundledAdapters) {
    if (!hasAdapter(adapter.id)) {
      registerAdapter(adapter)
      installed.push(adapter.id)
    }
  }
  return installed
}
