import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

/** Hub root: $AGENT_HUB_HOME or ~/.agent-hub */
export function hubRoot(): string {
  return expandHome(process.env.AGENT_HUB_HOME ?? path.join(HOME, '.agent-hub'));
}

export function expandHome(p: string): string {
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

/** Inverse of expandHome, for display and portable config. */
export function tildify(p: string): string {
  return p === HOME || p.startsWith(HOME + path.sep) ? '~' + p.slice(HOME.length) : p;
}

export const clientPaths = {
  claudeJson: () => path.join(HOME, '.claude.json'),
  claudeHome: () => expandHome(process.env.CLAUDE_CONFIG_DIR ?? '~/.claude'),
  codexHome: () => expandHome(process.env.CODEX_HOME ?? '~/.codex'),
  agentsSkills: () => path.join(HOME, '.agents', 'skills'),
  dshHome: () => expandHome(process.env.DSH_HOME ?? '~/.dsh'),
};
