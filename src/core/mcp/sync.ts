export { applySync } from './sync/apply.js';
export {
  defaultSyncContext,
  isCurrentProjection,
  semantic,
  syncCommand,
} from './sync/definitions.js';
export { planSync } from './sync/plan.js';
export { publicSyncPlan } from './sync/public.js';
export type {
  BackupManifest,
  SyncContext,
  SyncOptions,
  SyncPlan,
  SyncRow,
  SyncTarget,
} from './sync/types.js';
