// Injects the shared sidebar into <aside class="sidebar" data-active="...">. Mockup-only helper.
(function () {
  const i = (d) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const items = [
    [
      'overview',
      'index.html',
      'Overview',
      i(
        '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
      ),
      '<span class="count warn">20</span>',
    ],
    [
      'skills',
      'skills.html',
      'Skills',
      i('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>'),
      '<span class="count">11</span>',
    ],
    [
      'mcp',
      'mcp.html',
      'MCP servers',
      i(
        '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01M7 17h.01"/>',
      ),
      '<span class="count">12</span>',
    ],
    [
      'instructions',
      'instructions.html',
      'Instructions',
      i('<path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h6M9 18h3"/>'),
      '',
    ],
    [
      'memory',
      'memory.html',
      'Memory',
      i(
        '<path d="M9 4a3 3 0 00-3 3v.5A3 3 0 004 10.3 3 3 0 005 15a3 3 0 003 3.9V20h0M15 4a3 3 0 013 3v.5a3 3 0 012 2.8 3 3 0 01-1 4.7 3 3 0 01-3 3.9V20"/><path d="M12 4v16"/>',
      ),
      '<span class="count">5</span>',
    ],
    [
      'repos',
      'repos.html',
      'Repos & tasks',
      i(
        '<path d="M6 3v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9a9 9 0 01-9 9"/>',
      ),
      '<span class="count">7</span>',
    ],
    [
      'sessions',
      'sessions.html',
      'Sessions',
      i('<path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z"/>'),
      '<span class="count">510</span>',
    ],
  ];
  const el = document.querySelector('aside.sidebar');
  if (!el) return;
  const active = el.dataset.active;
  el.innerHTML = `
    <div class="brand"><span class="logo">◆</span>agent-hub<span class="ver">v0.1</span></div>
    <div class="nav-label">Hub</div>
    <nav class="nav">${items
      .map(
        ([id, href, label, icon, extra]) =>
          `<a href="${href}" class="${id === active ? 'active' : ''}">${icon}${label}${extra}</a>`,
      )
      .join('')}</nav>
    <div class="nav-label">Clients</div>
    <nav class="nav">
      <a href="index.html#clients"><span class="dot" style="color:var(--ok)"></span>Claude Code</a>
      <a href="index.html#clients"><span class="dot" style="color:var(--ok)"></span>Codex CLI</a>
      <a href="index.html#clients"><span class="dot" style="color:var(--warn)"></span>DeepSeek Harness</a>
    </nav>
    <div class="foot mono">~/.agent-hub · main · 3 uncommitted</div>`;
})();
