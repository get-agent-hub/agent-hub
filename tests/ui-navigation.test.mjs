import assert from 'node:assert/strict';
import test from 'node:test';
import { readRoute } from '../ui/app/shared/navigation.js';
import { link } from '../ui/app/shared/html.js';
import { overviewPage } from '../ui/app/pages/overview.js';
import { historyConversation } from '../ui/app/entities/history-conversation.js';

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
