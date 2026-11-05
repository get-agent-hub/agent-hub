import { escape, pill, mark } from '../shared/html.js';
import { clientLabels } from '../shared/navigation.js';

export function resourceSources(cells, columns) {
  const short = { hub: 'Hub', 'claude-code': 'Claude', codex: 'Codex', dsh: 'DSH' };
  return `<div class="tags resource-sources">${columns
    .filter((id) => cells[id] && cells[id] !== 'missing')
    .map(
      (id) =>
        `<span class="source-tag" title="${escape(clientLabels[id])}">${escape(short[id] || id)}</span>`,
    )
    .join('')}</div>`;
}

export function resourceComparison(cells, columns, kind) {
  const description = {
    ok: 'Linked',
    'other-copy': 'Separate copy',
    broken: 'Broken link',
    missing: 'Missing',
  };
  return `<details class="card-b" data-ui-key="comparison">
      <summary>Compare clients</summary>
      <table class="table section-gap">
      <thead>
      <tr>
      <th>Location</th>
      <th>${kind === 'skills' ? 'File connection' : 'Definition'}</th>
      </tr>
      </thead>
      <tbody>${columns
        .map(
          (id) => `<tr>
      <td>${escape(clientLabels[id])}</td>
      <td>${kind === 'skills' ? `${mark(cells[id])} ${description[cells[id]] || 'Missing'}` : cells[id] ? pill(cells[id]) : 'Missing'}</td>
      </tr>`,
        )
        .join('')}</tbody>
      </table>${kind === 'mcp' ? '<p class="small-note">The same letter means an equivalent launch definition. Connection checks are separate.</p>' : ''}</details>`;
}
