// sources/composio.ts — CR-007 (Phase C-R, B2, wave 2)
// Deterministic fixture adapter: integration tools.

import type { ExternalAdapter } from '../adapterKit.mjs'

export const composio = {
  id: 'composio',
  displayName: 'Composio',
  description: 'Fixture catalogue of integration tools exposed through the composio surface.',
  discover() {
    return [
      {
        localId: 'cmp-001',
        kind: 'tool',
        title: 'GitHub — Create Issue',
        summary: 'Creates an issue in a repository with title, body, and labels.',
        tags: ['github', 'issues', 'write'],
        payload: { appName: 'github', action: 'CREATE_ISSUE', auth: 'OAUTH2', scopes: ['repo'] },
      },
      {
        localId: 'cmp-002',
        kind: 'tool',
        title: 'Slack — Send Channel Message',
        summary: 'Posts a message to a Slack channel.',
        tags: ['messaging', 'slack', 'write'],
        payload: { appName: 'slack', action: 'SEND_CHANNEL_MESSAGE', auth: 'OAUTH2', scopes: ['chat:write'] },
      },
      {
        localId: 'cmp-003',
        kind: 'tool',
        title: 'Notion — Append Blocks to Page',
        summary: 'Appends content blocks to the end of a Notion page.',
        tags: ['docs', 'notion', 'write'],
        payload: { appName: 'notion', action: 'APPEND_BLOCK_CHILDREN', auth: 'OAUTH2', scopes: ['pages:write'] },
      },
      {
        localId: 'cmp-004',
        kind: 'tool',
        title: 'Linear — Create Ticket',
        summary: 'Creates a ticket in a Linear team and assigns a status cycle.',
        tags: ['issues', 'linear', 'write'],
        payload: { appName: 'linear', action: 'CREATE_TICKET', auth: 'OAUTH2', scopes: ['issues:create'] },
      },
      {
        localId: 'cmp-005',
        kind: 'tool',
        title: 'Google Sheets — Upsert Row',
        summary: 'Inserts or updates a row keyed by the first column.',
        tags: ['data', 'sheets', 'write'],
        payload: { appName: 'gsheets', action: 'UPSERT_ROW', auth: 'OAUTH2', scopes: ['spreadsheets'] },
      },
      {
        localId: 'cmp-006',
        kind: 'tool',
        title: 'Webhook — Relay Signed Payload',
        summary: 'Relays an HMAC-signed payload to a configured HTTPS endpoint.',
        tags: ['relay', 'webhook', 'write'],
        payload: { appName: 'webhook', action: 'RELAY_SIGNED', auth: 'HMAC', scopes: [] },
      },
    ]
  },
} satisfies ExternalAdapter
