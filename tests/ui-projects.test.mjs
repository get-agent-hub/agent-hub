import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPrimaryPath, savedProjectsView } from '../ui/app/entities/history-project.js';

const project = {
  id: 'repository',
  key: 'git:/work/example/.git',
  label: 'Example',
  kind: 'repository',
  chats: 12,
  excluded: false,
  locations: [
    '/work/example/src/main',
    '/work/example/node_modules/pkg',
    '/work/example/.tool/worktrees/fix',
    '/work/example',
  ],
};
test('project cards use the recorded Git root instead of a first observed dependency or working folder', () => {
  assert.equal(projectPrimaryPath(project), '/work/example');
  const before = structuredClone(project);
  const html = savedProjectsView([project]);
  assert.match(html, /project-location">\/work\/example<\/p>/);
  assert.match(html, /<details class="related-folders"[^>]*><summary>Related folders \(3\)/);
  assert.ok(!/<details class="related-folders"[^>]*\bopen\b/.test(html));
  assert.match(html, /node_modules\/pkg/);
  assert.match(html, /worktrees\/fix/);
  assert.match(html, /data-history-connect="repository"/);
  assert.deepEqual(project, before);
});
test('representative paths respect boundaries, linked worktrees, custom metadata layouts and Windows separators', () => {
  assert.equal(
    projectPrimaryPath({
      ...project,
      key: 'git:/main/.git',
      locations: ['/linked/src', '/linked'],
    }),
    '/linked',
  );
  assert.equal(
    projectPrimaryPath({
      ...project,
      key: 'git:/metadata',
      locations: ['/work/example/src', '/work/example2', '/work/example'],
    }),
    '/work/example',
  );
  assert.equal(
    projectPrimaryPath({
      ...project,
      key: 'git:C:\\work\\example\\.git',
      locations: ['C:\\work\\example\\src', 'C:\\work\\example'],
    }),
    'C:\\work\\example',
  );
  assert.equal(projectPrimaryPath({ ...project, locations: [] }), '');
});
test('ordinary and missing working locations stay separate and expandable without changing their identities', () => {
  const folder = {
    ...project,
    id: 'folder',
    kind: 'folder',
    key: 'folder:/work',
    locations: ['/work'],
    label: 'Working directory',
  };
  const missing = {
    ...project,
    id: 'missing',
    kind: 'missing',
    key: 'folder:/work/example/build/removed',
    locations: ['/work/example/build/removed'],
    label: 'Removed folder',
  };
  const html = savedProjectsView([project, folder, missing]);
  assert.match(html, /1 project<\/p>/);
  assert.match(html, /Other working folders \(1\)/);
  assert.match(html, /Unavailable or unverified locations \(1\)/);
  assert.ok(!/<details class="project-group[^>]*\bopen\b/.test(html));
  for (const id of ['repository', 'folder', 'missing'])
    assert.ok(html.includes(`data-history-connect="${id}"`));
  const onlyFolders = savedProjectsView([folder]);
  assert.match(onlyFolders, /<details class="project-group[^>]*\bopen\b/);
});
test('search reaches collapsed child paths without merging clones, nested repositories or uncertain folders', () => {
  const nested = {
    ...project,
    id: 'nested',
    key: 'git:/work/example/nested/.git',
    locations: ['/work/example/nested'],
    label: 'Nested project',
  };
  const all = savedProjectsView([project, nested]);
  assert.match(all, /2 projects<\/p>/);
  assert.match(savedProjectsView([project], 'node_modules'), /data-ui-key="locations-[^"]+" open/);
  assert.match(savedProjectsView([project], '<unknown>'), /No matching projects/);
  assert.ok(
    !savedProjectsView([{ ...project, label: '<script>bad</script>' }]).includes('<script>'),
  );
});
