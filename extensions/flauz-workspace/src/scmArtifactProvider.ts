/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — src/scmArtifactProvider.ts
 *
 *  Exposes evidence ledger rows as SCM artifacts through the proposed
 *  `scmArtifactProvider` API (registry: extensionsApiProposals.ts:414; in-tree
 *  consumer pattern: extensions/git/src/artifactProvider.ts + repository.ts:1000).
 *
 *  Four STATIC kind groups (changeset / screenshot / command-output / note) are
 *  returned from provideArtifactGroups(); provideArtifacts(group) maps that group's
 *  ledger rows to artifacts carrying the row timestamp and an `openEvidence` command
 *  bound to the evidence id. onDidChangeArtifacts fires the changed group ids after
 *  evidence appends (wired in src/commands.ts).
 *
 *  The provider attaches to a SourceControl created by src/extension.ts:
 *      sourceControl.artifactProvider = artifacts;
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import { type EvidenceKind, type LedgerRow } from './api.ts';
import { evidenceIdOf } from './ledger.ts';

export interface ArtifactGroupSpec {
        readonly kind: EvidenceKind;
        readonly id: string;
        readonly name: string;
}

/** The 4 static kind groups — one per evidence kind, ids equal the kind. */
export const ARTIFACT_GROUPS: readonly ArtifactGroupSpec[] = [
        { kind: 'changeset', id: 'changeset', name: 'Changesets' },
        { kind: 'screenshot', id: 'screenshot', name: 'Screenshots' },
        { kind: 'command-output', id: 'command-output', name: 'Command Outputs' },
        { kind: 'note', id: 'note', name: 'Notes' },
];

/** Short human label for a URI: last path segment, else the URI itself. */
function shortLabel(uri: string): string {
        const withoutQuery = uri.split('?')[0] ?? uri;
        const segments = withoutQuery.split('/');
        return segments[segments.length - 1] !== '' ? (segments[segments.length - 1] as string) : uri;
}

export function artifactForRow(row: LedgerRow): vscode.SourceControlArtifact {
        return {
                id: evidenceIdOf(row.seq),
                name: shortLabel(row.uri),
                description: `${row.taskId} \u2022 seq ${row.seq}`,
                timestamp: row.ts,
                command: { title: 'Open Evidence', command: 'flauz.workspace.openEvidence', arguments: [evidenceIdOf(row.seq)] },
        };
}

export class FlauzArtifactProvider implements vscode.SourceControlArtifactProvider {
        private readonly getRows: () => Promise<LedgerRow[]>;
        private readonly emitter: vscode.EventEmitter<string[]>;
        readonly onDidChangeArtifacts: vscode.Event<string[]>;

        constructor(getRows: () => Promise<LedgerRow[]>) {
                this.getRows = getRows;
                const api = vscodeApi();
                this.emitter = new api.EventEmitter<string[]>();
                this.onDidChangeArtifacts = this.emitter.event;
        }

        provideArtifactGroups(_token?: vscode.CancellationToken): vscode.SourceControlArtifactGroup[] {
                return ARTIFACT_GROUPS.map(group => ({ id: group.id, name: group.name }));
        }

        async provideArtifacts(group: string, _token?: vscode.CancellationToken): Promise<vscode.SourceControlArtifact[]> {
                const rows = await this.getRows();
                return rows.filter(row => row.kind === group).map(artifactForRow);
        }

        /** Fires the changed group ids (command seam calls this after evidence appends). */
        notifyChanged(kinds: Iterable<EvidenceKind>): void {
                const ids = new Set<string>();
                for (const kind of kinds) {
                        ids.add(kind);
                }
                if (ids.size > 0) {
                        this.emitter.fire([...ids]);
                }
        }

        dispose(): void {
                this.emitter.dispose();
        }
}
