import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HubError } from '../../shared/errors.js';
import { isAbsoluteLocalPath } from '../../shared/paths.js';
import { hash } from '../../shared/values.js';

export interface HistoryStartupContext {
  platform: string;
  home: string;
  configHome: string;
  node: string;
  worker: string;
}
export function historyStartupContext(): HistoryStartupContext {
  return {
    platform: process.platform,
    home: os.homedir(),
    configHome: process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    node: process.execPath,
    worker: fileURLToPath(new URL('../../workers/history-login.js', import.meta.url)),
  };
}
export type StartupFile =
  | { file: string; kind: 'file'; content: string }
  | { file: string; kind: 'symlink'; target: string };

export function startupDefinition(root: string, binding: string, context: HistoryStartupContext) {
  for (const value of [root, context.home, context.configHome, context.node, context.worker])
    if (!isAbsoluteLocalPath(value))
      throw new HubError('Login startup requires absolute local paths.');
  if (!/^\d+:\d+$/.test(binding)) throw new HubError('Invalid Hub startup binding.');
  const name = `agent-hub-history-${hash(path.resolve(root)).slice(0, 20)}`;
  const args = [context.node, context.worker, root, binding];
  const files: StartupFile[] = [];
  if (context.platform === 'darwin') {
    const xml = (value: string) =>
      value.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
      );
    files.push({
      file: path.join(context.home, 'Library', 'LaunchAgents', `${name}.plist`),
      kind: 'file',
      content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${name}</string><key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/></dict></plist>\n`,
    });
  } else if (context.platform === 'linux') {
    // systemd expands specifiers and environment references even without a shell.
    const quote = (value: string) =>
      '"' +
      value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/%/g, '%%')
        .replace(/\$/g, () => '$$') +
      '"';
    const file = path.join(context.configHome, 'systemd', 'user', `${name}.service`);
    files.push({
      file,
      kind: 'file',
      content: `[Unit]\nDescription=Agent Hub selected history\n\n[Service]\nType=simple\nExecStart=${args.map(quote).join(' ')}\nRestart=no\nStandardOutput=null\nStandardError=null\n\n[Install]\nWantedBy=default.target\n`,
    });
    files.push({
      file: path.join(
        context.configHome,
        'systemd',
        'user',
        'default.target.wants',
        `${name}.service`,
      ),
      kind: 'symlink',
      target: `../${name}.service`,
    });
  } else
    throw new HubError('Login startup supports macOS launchd and Linux systemd user sessions.');
  return { name, files };
}
