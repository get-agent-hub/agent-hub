import { execFileSync } from 'node:child_process';
import { hubRoot } from './paths.js';

function git(args: string[], cwd = hubRoot()): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function isRepo(cwd = hubRoot()): boolean {
  try {
    return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true' && git(['rev-parse', '--show-toplevel'], cwd) !== '' ;
  } catch {
    return false;
  }
}

/** True only if `dir` itself is the repo top-level (not a parent repo, e.g. a dotfiles repo in $HOME). */
export function isOwnRepo(dir = hubRoot()): boolean {
  try {
    return git(['rev-parse', '--show-toplevel'], dir) === dir;
  } catch {
    return false;
  }
}

export function initRepo(): void {
  git(['init', '-q', '-b', 'main']);
}

/** Stage everything and commit if there are changes. Returns short sha or undefined. */
export function commitAll(message: string): string | undefined {
  git(['add', '-A']);
  try {
    git(['diff', '--cached', '--quiet']);
    return undefined; // nothing staged
  } catch {
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', '--short', 'HEAD']);
  }
}

export function addRemote(url: string): void {
  git(['remote', 'add', 'origin', url]);
}
