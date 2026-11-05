import path from 'node:path';
import { inspectArtifact } from '../../shared/artifacts.js';
import { HubError } from '../../shared/errors.js';
import { autoJson, autoRow, parseAutomation } from '../memory/automation/config.js';
import { memoryFile, memoryId } from '../memory/store.js';
import { managedPlan, type ArtifactRequest, type ManagedRow } from '../recovery/managed-plan.js';
import { memoryRegistry } from './memory-bindings.js';
import { readHistory, ownedHistoryPath } from '../history/storage.js';

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
  const history = await readHistory(root);
  const historyProjects = history.projects
    .filter((item) =>
      [...item.locations, ...item.aliases].some((location) =>
        project.checkouts.some((checkout) => checkout.path === location),
      ),
    )
    .map((item) => item.id);
  if (
    history.grants.some((grant) => grant.projects.some((item) => historyProjects.includes(item)))
  ) {
    history.grants = history.grants.filter(
      (grant) => !grant.projects.some((item) => historyProjects.includes(item)),
    );
    const before = await inspectArtifact(await ownedHistoryPath(root, 'catalog.json'));
    requests.push({
      before,
      client: 'history',
      value: { kind: 'file', content: JSON.stringify(history) + '\n', mode: 0o600 },
    });
    rows.push({
      path: before.path,
      client: 'history',
      name: 'Archive grants',
      action: 'replace',
      note: 'Revoke history connections associated with this project. Preserved conversations remain in the Hub.',
    });
  }
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
