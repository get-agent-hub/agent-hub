import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { recoveryRoot } from '../../shared/recovery-paths.js';

type Storage = { root: string; directory: string };
const selected = new AsyncLocalStorage<Storage>();
const mirror = new AsyncLocalStorage<Storage>();

/** Only baseline payloads and write journals move; locks, ownership and archives stay canonical. */
export function recoveryStorage(root: string) {
  const storage = selected.getStore();
  return storage?.root === path.resolve(root) ? storage.directory : recoveryRoot(root);
}
export function withRecoveryStorage<T>(root: string, directory: string, action: () => Promise<T>) {
  return selected.run({ root: path.resolve(root), directory }, action);
}
export function mirrorRecoveryWrites<T>(root: string, directory: string, action: () => Promise<T>) {
  return mirror.run({ root: path.resolve(root), directory }, action);
}
export async function mirrorRecovery(root: string, action: () => Promise<unknown>) {
  const storage = mirror.getStore();
  if (storage?.root === path.resolve(root) && !selected.getStore())
    await withRecoveryStorage(root, storage.directory, action);
}
