import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { recoveryRoot } from './recovery-paths.js';
import { readOptionalText, snapshot, writeChecked } from './file-store.js';
import { HubError } from './errors.js';

/** Called under the Hub lock when creating/rotating authority; recovery never rewinds this file. */
export async function automationAuthority(root: string, create = false): Promise<string | null> {
  const directory = recoveryRoot(root);
  try {
    const stat = await fs.lstat(directory);
    const ownerStat = await fs.lstat(path.join(directory, 'owner.json'));
    const owner = JSON.parse(await fs.readFile(path.join(directory, 'owner.json'), 'utf8')) as {
      root?: string;
    };
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !ownerStat.isFile() ||
      ownerStat.isSymbolicLink() ||
      owner.root !== path.resolve(root)
    )
      throw new Error();
  } catch {
    throw new HubError('Cannot verify memory automation authority storage.');
  }
  const file = path.join(directory, 'memory-authority.json');
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new HubError('Memory authority must be a real private file.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const text = await readOptionalText(file);
  if (text === null) {
    if (!create) return null;
    const epoch = randomBytes(16).toString('hex');
    await fs.writeFile(file, JSON.stringify({ version: 1, epoch }), { flag: 'wx', mode: 0o600 });
    return epoch;
  }
  try {
    const value = JSON.parse(text) as { version?: unknown; epoch?: unknown };
    if (
      value.version !== 1 ||
      typeof value.epoch !== 'string' ||
      !/^[a-f0-9]{32}$/.test(value.epoch)
    )
      throw new Error();
    return value.epoch;
  } catch {
    throw new HubError('Invalid memory automation authority.');
  }
}

export async function revokeAutomationCheckpoints(root: string) {
  if (await automationAuthority(root)) {
    const file = path.join(recoveryRoot(root), 'memory-authority.json');
    await writeChecked(
      await snapshot(file),
      JSON.stringify({ version: 1, epoch: randomBytes(16).toString('hex') }),
    );
  }
}
