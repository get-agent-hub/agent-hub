import fs from 'node:fs/promises';
import {
  memoryRegistry,
  memoryLocation,
  memoryCheckout,
  memoryCheckoutBinding,
} from './memory-projects.js';
import { queryMemory } from './memory-store.js';
import { readAutomation } from './memory-auto-config.js';
import { HubError } from './errors.js';

export async function projectCatalog(root: string) {
  const { registry } = await memoryRegistry(root, true);
  return registry.projects.map((project) => ({
    id: project.id,
    connected: project.connected !== false,
    checkouts: project.checkouts.map((checkout) => checkout.path),
  }));
}

/** The browser selects a registered ID, never an arbitrary filesystem path. */
export async function registeredWorkspace(root: string, id: string) {
  const project = (await memoryRegistry(root, true)).registry.projects.find(
    (project) => project.id === id,
  );
  if (!project) throw new HubError('Choose a project registered in this Hub.');
  for (const checkout of project.checkouts) {
    try {
      const current = await memoryCheckoutBinding(checkout.path);
      if (current.identity !== checkout.identity) continue;
      if (project.connected !== false) await memoryLocation(root, { workspace: checkout.path });
      return checkout.path;
    } catch {
      /* Try another explicitly registered checkout, never infer a new binding. */
    }
  }
  throw new HubError(
    'No verified checkout is available for this project. Restore its directory or review an explicit rebind.',
  );
}

export async function memoryOverview(root: string, workspace: string) {
  const result = {
    sharedRecords: 0,
    projectRecords: 0,
    projectId: null as string | null,
    projectDirectory: null as string | null,
    defaultScope: 'shared' as 'shared' | 'project',
    automation: false,
    issues: [] as string[],
  };
  try {
    const shared = await memoryLocation(root, { shared: true });
    result.sharedRecords = (await queryMemory([shared], '', 1)).total;
  } catch (error) {
    if (error instanceof HubError && !/not initialized/.test(error.message))
      result.issues.push(error.message);
  }
  let checkout: string;
  try {
    checkout = await memoryCheckout(workspace);
  } catch {
    return result;
  }
  result.projectDirectory = await fs.realpath(checkout);
  const project = (await projectCatalog(root)).find((project) =>
    project.checkouts.includes(checkout),
  );
  if (!project) return result;
  try {
    const location = await memoryLocation(root, { workspace: checkout });
    result.projectRecords = (await queryMemory([location], '', 1)).total;
    result.projectId = project.id;
    result.defaultScope = 'project';
    result.automation = (await readAutomation(root, checkout)).policy.enabled;
  } catch (error) {
    result.issues.push(
      error instanceof HubError ? error.message : 'Project memory could not be inspected.',
    );
  }
  return result;
}
