import { randomBytes } from 'node:crypto';
import { runDoctor } from '../core/diagnostics/doctor.js';
import { applyImport, planImport } from '../core/mcp/import-plan.js';
import { applySync, planSync } from '../core/mcp/sync.js';
import { createMemorySession, type MemorySession } from '../core/memory/session.js';
import { discoverProjects } from '../core/projects/discovery.js';
import { planContent, type ContentOperation, type ContentOptions } from '../core/setup/content.js';
import {
  applyProjectConnect,
  applyQuick,
  planProjectConnect,
  planQuick,
} from '../core/setup/quick.js';
import { hubRoot } from '../shared/paths.js';
import { skillDocument, uiState } from './data.js';
import { mcpDetails } from './mcp-details.js';
import { revealDirectory } from './project-discovery.js';
import type { HistorySource } from '../contracts/history.js';
import type { SyncContext } from '../core/mcp/sync.js';
export type UiOptions = {
  port?: number;
  cwd?: string;
  services?: {
    quickPlan?: typeof planQuick;
    quickApply?: typeof applyQuick;
    projectPlan?: typeof planProjectConnect;
    projectApply?: typeof applyProjectConnect;
    state?: (cwd?: string) => Promise<unknown>;
    plan?: typeof planImport;
    apply?: typeof applyImport;
    skill?: typeof skillDocument;
    mcp?: typeof mcpDetails;
    syncPlan?: typeof planSync;
    syncApply?: typeof applySync;
    doctor?: typeof runDoctor;
    contentPlan?: typeof planContent;
    memory?: MemorySession;
    discoverProjects?: typeof discoverProjects;
    revealDirectory?: typeof revealDirectory;
    historySources?: () => Promise<HistorySource[]>;
    historySyncContext?: () => Promise<SyncContext>;
  };
};
export function createUiSession(options: UiOptions) {
  const previewStores = new Set<{ clear(): void }>();
  const startupWorkspace = options.cwd ?? process.cwd();
  let selectedWorkspace = startupWorkspace;
  let selectedProject: string | null | undefined;
  const memorySession = () =>
    createMemorySession({
      root: hubRoot(),
      workspace: selectedWorkspace,
      includeShared: true,
      project: selectedProject !== null,
      writable: true,
      sharedWritable: true,
    });
  const services = {
    quickPlan: planQuick,
    quickApply: applyQuick,
    projectPlan: planProjectConnect,
    projectApply: applyProjectConnect,
    state: (cwd = selectedWorkspace) => uiState(cwd),
    plan: planImport,
    apply: applyImport,
    skill: skillDocument,
    mcp: mcpDetails,
    syncPlan: planSync,
    syncApply: applySync,
    doctor: runDoctor,
    contentPlan: (
      operation: ContentOperation,
      contentOptions: ContentOptions,
      cwd = selectedWorkspace,
    ) => planContent(operation, contentOptions, cwd),
    memory: memorySession(),
    discoverProjects,
    revealDirectory,
    ...options.services,
  };

  return {
    trackPreviews: (store: { clear(): void }) => {
      previewStores.add(store);
    },
    clearPreviews: () => {
      for (const store of previewStores) store.clear();
    },
    services,
    token: randomBytes(32).toString('hex'),
    startupWorkspace,
    applying: false,
    get selectedWorkspace() {
      return selectedWorkspace;
    },
    set selectedWorkspace(value: string) {
      selectedWorkspace = value;
    },
    get selectedProject() {
      return selectedProject;
    },
    set selectedProject(value: string | null | undefined) {
      selectedProject = value;
    },
    newMemorySession: memorySession,
  };
}
export type UiSession = ReturnType<typeof createUiSession>;
