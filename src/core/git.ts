import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hubRoot } from './paths.js';

function git(args: string[], cwd = hubRoot()): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** True only if `dir` itself is the repo top-level (not a parent repo, e.g. a dotfiles repo in $HOME). */
export function isOwnRepo(dir = hubRoot()): boolean {
  try {
    return (
      fs.realpathSync(git(['rev-parse', '--show-toplevel'], dir)) ===
      fs.realpathSync(path.resolve(dir))
    );
  } catch {
    return false;
  }
}

export function initRepo(): void {
  git(['init', '-q', '-b', 'main']);
}

/** Commit only explicitly selected files; leave unrelated staged work untouched. */
export function commitPaths(paths: string[], message: string): string | undefined {
  git(['add', '--', ...paths]);
  try {
    git(['diff', '--cached', '--quiet', '--', ...paths]);
    return undefined; // nothing staged
  } catch {
    git(['commit', '--only', '-q', '-m', message, '--', ...paths]);
    return git(['rev-parse', '--short', 'HEAD']);
  }
}

export function addRemote(url: string): void {
  git(['remote', 'add', 'origin', url]);
}
