import assert from 'node:assert/strict';
import test from 'node:test';
import { readRoute } from '../ui/app/shared/navigation.js';
import { link } from '../ui/app/shared/html.js';
import { overviewPage } from '../ui/app/pages/overview.js';
import { historyConversation, chatSummary } from '../ui/app/entities/history-conversation.js';

test('old chat bookmarks keep the exact message window, revision and search after the UI rebuild', () => {
  const route = readRoute('#/sessions?chat=abc&revision=old&offset=50&q=cache+keys&view=events');
  assert.equal(route.page, 'data');
  assert.equal(route.resource, 'chats');
  const canonical = readRoute(link('sessions', Object.fromEntries(route.params)));
  assert.equal(canonical.resource, 'chats');
  for (const key of ['chat', 'revision', 'offset', 'q', 'view'])
    assert.equal(canonical.params.get(key), route.params.get(key));
});

test('resource bookmarks and folder context retain their destination without expanding main navigation', () => {
  for (const name of ['skills', 'mcp', 'instructions', 'memory']) {
    const route = readRoute(`#/${name}?name=a%26b&source=codex`);
    assert.equal(route.page, 'data');
    assert.equal(route.resource, name);
    assert.equal(route.params.get('name'), 'a&b');
    assert.equal(readRoute(link(name, Object.fromEntries(route.params))).resource, name);
  }
  assert.equal(readRoute('#/repos?file=NOW.md').resource, 'repos');
  assert.equal(readRoute('#/data?type=unknown').resource, 'chats');
  assert.equal(readRoute('#/unknown').page, 'overview');
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.equal(readRoute(`#/${key}`).page, 'overview');
    assert.equal(readRoute(`#/data?type=${key}`).resource, 'chats');
  }
});

test('unavailable history never looks like an empty archive on the overview', () => {
  const state = { status: { skills: [], mcp: [], clients: [], drift: [] } };
  const html = overviewPage(state, { error: '<script>private failure</script>' });
  assert.match(html, /History could not be read/);
  assert.match(html, /class="v">—/);
  assert.ok(!html.includes('<script>'));
  const empty = overviewPage(state, { status: { chats: 0 }, chats: [] });
  assert.match(empty, /class="v">0/);
  assert.ok(!empty.includes('History could not be read'));
});

test('conversation presentation keeps native markup inert and preserves technical access', () => {
  const chat = {
    id: 'chat',
    title: '<img onerror=evil()>',
    client: 'dsh',
    kind: 'chat',
    events: 1,
    content: 'complete',
    nativeId: 'native',
    projects: [],
    revisions: ['revision'],
    revision: 'revision',
    issues: [],
    assets: [],
  };
  const html = historyConversation({
    result: {
      chat,
      revision: 'revision',
      view: 'conversation',
      events: [
        {
          role: 'assistant',
          ordinal: 1,
          type: 'message',
          text: '<script>evil()</script>',
          textComplete: true,
          parts: [{ kind: 'reasoning', text: 'Hidden reasoning' }],
        },
      ],
      next: null,
    },
    status: { projects: [] },
    params: new URLSearchParams(),
    pager: () => '',
  });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /<details data-ui-key="part-1:0">/);
  assert.match(html, /All events/);
  assert.match(html, /Read original event/);
  assert.match(html, /Download preserved source/);
});

test('chat list rows show human labels and project context while technical counters stay inside details', () => {
  const chat = {
    id: 'chat-id',
    nativeId: 'native-id',
    title: 'Conversation native-id',
    client: 'claude-code',
    kind: 'chat',
    events: 57,
    content: 'complete',
    revisions: ['revision'],
    projects: ['project'],
  };
  const html = chatSummary(chat, [{ id: 'project', label: 'Example project' }]);
  assert.match(html, /Untitled conversation/);
  assert.match(html, /Claude Code · Example project/);
  for (const technical of ['native-id', '57 events', 'complete', 'version(s)', '↳', '↗'])
    assert.ok(!html.includes(technical));
  const partial = chatSummary({
    ...chat,
    title: '<script>inert</script>',
    kind: 'subagent',
    content: 'partial',
  });
  assert.match(partial, /Subagent/);
  assert.match(partial, /Incomplete archive/);
  assert.ok(!partial.includes('<script>'));
});

test('chat rows show native local time safely and never substitute the archive capture date', () => {
  const chat = {
    id: 'id',
    nativeId: 'native',
    title: 'Example',
    client: 'codex',
    kind: 'chat',
    content: 'complete',
    projects: [],
    observedAt: '2030-01-01T00:00:00Z',
  };
  const html = chatSummary({ ...chat, startedAt: '2026-11-03T09:30:00.000Z' });
  assert.match(html, /<time class="chat-time" datetime="2026-11-03T09:30:00.000Z"/);
  assert.match(html, /First recorded/);
  assert.ok(!html.includes('2030-01-01'));
  for (const startedAt of [undefined, null, 'invalid<script>']) {
    const missing = chatSummary({ ...chat, startedAt });
    assert.match(missing, /Time unavailable/);
    assert.ok(!missing.includes('<script>'));
    assert.ok(!missing.includes('<time'));
  }
});
