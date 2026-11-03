import { collectStatus, type Col, type SkillCell } from '../core/status.js';
import { c, printJson, table } from '../core/output.js';
import { readiness } from '../core/readiness.js';
import { tildify } from '../core/paths.js';

const skillMark: Record<SkillCell, string> = {
  ok: c.green('✓'),
  missing: c.dim('·'),
  broken: c.red('✗'),
  'other-copy': c.yellow('≠'),
};

export async function statusCommand(opts: { json?: boolean }): Promise<void> {
  const r = await collectStatus();
  const ready = await readiness({ status: r });
  if (opts.json) return printJson({ ...r, readiness: ready });
  console.log(
    `${ready.label}\nConfiguration: ${ready.configuration} · MCP connections: ${ready.connections} · Project memory: ${ready.memory.state}`,
  );
  for (const issue of ready.issues) console.log(`Review: ${issue}`);
  if (ready.next) console.log(`Next: ${ready.next}`);

  const cols: Col[] = ['hub', ...r.clients.filter((x) => x.installed).map((x) => x.id)];
  const head = (first: string) => [first, ...cols];

  console.log(
    c.bold('Hub   ') +
      (r.hub.exists
        ? tildify(r.hub.root)
        : c.yellow(`${tildify(r.hub.root)} (not initialized — run \`ahub quick\`)`)),
  );
  for (const cl of r.clients) {
    console.log(
      `${c.bold(cl.label.padEnd(18))}${cl.installed ? c.green('found') : c.dim('not found')}`,
    );
  }

  console.log('\n' + c.cyan(`Skills (${r.skills.length})`));
  console.log(
    table(
      head('name'),
      r.skills.map((s) => [s.name, ...cols.map((col) => skillMark[s.cells[col]])]),
    ),
  );

  console.log(
    '\n' +
      c.cyan(`MCP servers (${r.mcp.length})`) +
      c.dim('  letters = effective definitions; same letter = equivalent launch'),
  );
  console.log(
    table(
      [...head('name'), ''],
      r.mcp.map((m) => [
        m.name,
        ...cols.map((col) => {
          const v = m.cells[col];
          if (!v) return c.dim('·');
          return m.variants > 1 ? c.yellow(v) : c.green(v);
        }),
        m.inlineSecret ? c.yellow('inline secret') : '',
      ]),
    ),
  );

  const counts = r.drift.reduce<Record<string, number>>(
    (acc, d) => ((acc[d.kind] = (acc[d.kind] ?? 0) + 1), acc),
    {},
  );
  console.log(
    '\n' +
      (r.drift.length === 0
        ? c.green('No drift.')
        : c.yellow(
            `Drift: ${Object.entries(counts)
              .map(([k, n]) => `${n} ${k}`)
              .join(', ')}`,
          ) + c.dim('  (details: --json)')),
  );
}
