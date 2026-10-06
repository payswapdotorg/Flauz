// sources/mcpSkills.ts — CR-007 (Phase C-R, B2, wave 2)
// Deterministic fixture adapter: MCP skills.

import type { ExternalAdapter } from '../adapterKit.mjs'

export const mcpSkills = {
  id: 'mcpSkills',
  displayName: 'MCP Skills',
  description: 'Fixture catalogue of Model Context Protocol skills (tools and prompts).',
  discover() {
    return [
      {
        localId: 'mcp-001',
        kind: 'skill',
        title: 'codebase-search',
        summary: 'Searches symbols and full text across the repository index.',
        tags: ['code', 'read-only', 'search'],
        payload: { protocol: 'mcp', capability: 'tools', version: '1.2.0', invocations: ['search_symbols', 'search_text'] },
      },
      {
        localId: 'mcp-002',
        kind: 'skill',
        title: 'test-runner',
        summary: 'Runs test files or whole suites and returns structured results.',
        tags: ['execution', 'test'],
        payload: { protocol: 'mcp', capability: 'tools', version: '1.1.0', invocations: ['run_file', 'run_suite'] },
      },
      {
        localId: 'mcp-003',
        kind: 'skill',
        title: 'schema-migration',
        summary: 'Plans and applies forward database schema migrations.',
        tags: ['database', 'migration', 'write'],
        payload: { protocol: 'mcp', capability: 'tools', version: '0.9.2', invocations: ['plan_migration', 'apply_migration'] },
      },
      {
        localId: 'mcp-004',
        kind: 'skill',
        title: 'dependency-audit',
        summary: 'Audits the lockfile against published advisories.',
        tags: ['audit', 'deps', 'read-only'],
        payload: { protocol: 'mcp', capability: 'tools', version: '1.0.4', invocations: ['audit_lockfile'] },
      },
      {
        localId: 'mcp-005',
        kind: 'skill',
        title: 'log-triage',
        summary: 'Tails service logs and classifies recurring failure signatures.',
        tags: ['logs', 'read-only', 'triage'],
        payload: { protocol: 'mcp', capability: 'tools', version: '0.7.1', invocations: ['tail', 'classify'] },
      },
      {
        localId: 'mcp-006',
        kind: 'skill',
        title: 'doc-synthesis',
        summary: 'Synthesises a topic brief from indexed documentation.',
        tags: ['docs', 'synthesis'],
        payload: { protocol: 'mcp', capability: 'prompts', version: '1.3.0', invocations: ['synthesize_topic'] },
      },
    ]
  },
} satisfies ExternalAdapter
