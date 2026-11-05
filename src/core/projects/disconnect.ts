import path from 'node:path';
import { inspectArtifact } from '../../shared/artifacts.js';
import { HubError } from '../../shared/errors.js';
import { autoJson, autoRow, parseAutomation } from '../memory/automation/config.js';
import { memoryFile, memoryId } from '../memory/store.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from '../recovery/managed-plan.js';
import { memoryRegistry } from './memory-bindings.js';

/** Keep bindings and knowledge so reconnect uses the same project ID after an identity check. */
export async function planProjectDisconnect(root: string, id: string) {
  memoryId(id);
  const { registry, snapshot } = await memoryRegistry(root);
  const project = registry.projects.find((entry) => entry.id === id);
  if (!project) throw new HubError('Choose a registered project ID to disconnect.');
  const rows: ManagedRow[] = project.checkouts.map((checkout) => ({
    path: checkout.path,
    client: 'memory',
    name: id,
    action: project.connected === false ? 'keep' : 'replace',
    note: 'Disconnect this project binding. Knowledge, repository notes and shared client hooks are retained.',
  }));
  const requests: ArtifactRequest[] = [];
  if (project.connected !== false) {
    project.connected = false;
    requests.push({
      before: snapshot,
      client: 'memory',
      value: { kind: 'file', content: JSON.stringify(registry, null, 2) + '\n', mode: 0o600 },
    });
  }
  const policyFile = await memoryFile(
    root,
    path.join(root, 'memory/projects', id, 'automation/policy.json'),
  );
  const policy = parseAutomation(policyFile.text);
  if (policy.enabled) {
    const request = autoJson(policyFile, { ...policy, enabled: false })!;
    requests.push(request);
    rows.push(autoRow(request, 'Disable project automation'));
  }
  // Remove transient checkpoint tokens even when reconnect is followed by a fresh setup.
  const sessions = await inspectArtifact(
    path.join(root, 'memory/projects', id, 'automation/sessions'),
  );
  if (sessions.kind !== 'missing') {
    requests.push({ before: sessions, client: 'memory', value: { kind: 'missing' } });
    rows.push({
      path: sessions.path,
      client: 'memory',
      name: 'Pending checkpoints',
      action: 'remove',
      note: 'Old session tokens cannot be replayed on reconnect.',
    });
  }
  return managedPlan(
    { root, rows, requests, sources: [], command: ['project', 'disconnect', id] },
    { registry },
  );
}
