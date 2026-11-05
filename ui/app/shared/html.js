export const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function link(page, params = {}) {
  if (['sessions', 'skills', 'mcp', 'instructions', 'memory'].includes(page)) {
    params = { ...params, type: page === 'sessions' ? 'chats' : page };
    page = 'data';
  }
  return `#/${page}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
}
export function pill(text, type = '') {
  return `<span class="pill ${type}">${escape(text)}</span>`;
}
export function mark(cell) {
  const types = {
    ok: ['✓', 'ok', 'Linked'],
    missing: ['·', 'miss', 'Missing'],
    broken: ['✗', 'err', 'Broken'],
    'other-copy': ['≠', 'warn', 'Different location'],
  };
  const [text, type, title] = types[cell] || types.missing;
  return `<span class="mark ${type}" title="${title}" aria-label="${title}">${text}</span>`;
}
export function empty(title, text, action = '') {
  return `<div class="empty"><div class="empty-symbol">◇</div><h3>${escape(title)}</h3><p>${escape(text)}</p>${action}</div>`;
}
export function intro(title, text, actions = '') {
  return `<div class="page-intro"><div><h2>${escape(title)}</h2><p>${escape(text)}</p></div><div class="page-actions">${actions}</div></div>`;
}
