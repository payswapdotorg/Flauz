// sources/printingPress.ts — CR-007 (Phase C-R, B2, wave 2)
// Deterministic fixture adapter: press-production documents.
// Offline by design — no network, no clocks, stable order on every call.

import type { ExternalAdapter } from '../adapterKit.mjs'

export const printingPress = {
  id: 'printingPress',
  displayName: 'Printing Press',
  description: 'Fixture catalogue of press-production documents (specs, calibration sheets, checklists, logs).',
  discover() {
    return [
      {
        localId: 'pp-001',
        kind: 'document',
        title: 'Baseline Grid — Typesetting Spec',
        summary: 'Vertical rhythm and baseline-grid conventions for body text and display matter.',
        tags: ['layout', 'spec', 'typesetting'],
        payload: { pages: 12, edition: 'P-2024-11', format: 'pdf' },
      },
      {
        localId: 'pp-002',
        kind: 'document',
        title: 'Ink Density Calibration Sheet',
        summary: 'Solid-ink-density targets and tolerances for the four process inks.',
        tags: ['calibration', 'ink', 'qa'],
        payload: { pages: 2, edition: 'P-2024-11', format: 'pdf' },
      },
      {
        localId: 'pp-003',
        kind: 'document',
        title: 'Imposition Plan — 16pp Saddle Stitch',
        summary: 'Signature layout and imposition scheme for a 16-page saddle-stitched booklet.',
        tags: ['imposition', 'layout', 'spec'],
        payload: { pages: 16, edition: 'P-2025-02', format: 'pdf' },
      },
      {
        localId: 'pp-004',
        kind: 'document',
        title: 'Paper Stock Catalog — Uncoated Series',
        summary: 'Grammage, bulk, and opacity for the uncoated stock series.',
        tags: ['catalog', 'paper'],
        payload: { pages: 24, edition: 'P-2023-08', format: 'pdf' },
      },
      {
        localId: 'pp-005',
        kind: 'document',
        title: 'Preflight Checklist — Press-Ready PDF',
        summary: 'Pre-flight checks required before a PDF is released to plate.',
        tags: ['checklist', 'preflight', 'qa'],
        payload: { pages: 1, edition: 'P-2025-02', format: 'pdf' },
      },
      {
        localId: 'pp-006',
        kind: 'document',
        title: 'Colour Bar Tolerance Table (ISO 12647-2)',
        summary: 'Permissible colour deviations for the press control strip.',
        tags: ['colour', 'qa', 'spec'],
        payload: { pages: 3, edition: 'P-2024-05', format: 'pdf' },
      },
      {
        localId: 'pp-007',
        kind: 'document',
        title: 'Plate Registration Log — Template',
        summary: 'Blank log sheet for plate registration measurements per shift.',
        tags: ['log', 'plates', 'template'],
        payload: { pages: 4, edition: 'P-2025-02', format: 'csv' },
      },
    ]
  },
} satisfies ExternalAdapter
