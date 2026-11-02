const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  dim: wrap('2'),
  bold: wrap('1'),
  green: wrap('32'),
  yellow: wrap('33'),
  red: wrap('31'),
  cyan: wrap('36'),
};

// eslint-disable-next-line no-control-regex
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

export function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(visible(h), ...rows.map((r) => visible(r[i] ?? ''))));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell + ' '.repeat(widths[i] - visible(cell)))
      .join('  ')
      .trimEnd();
  return [c.bold(line(head)), ...rows.map(line)].join('\n');
}

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}
