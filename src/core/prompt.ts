import readline from 'node:readline/promises';

export const interactive = () => process.stdin.isTTY && process.stdout.isTTY;

export async function ask(question: string, def = ''): Promise<string> {
  if (!interactive()) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`${question}${def ? ` [${def}]` : ''} `)).trim();
    return a || def;
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, def = true): Promise<boolean> {
  const a = (await ask(`${question} (${def ? 'Y/n' : 'y/N'})`)).toLowerCase();
  if (!a) return def;
  return a.startsWith('y') || a.startsWith('д');
}

export async function choose<T extends string>(question: string, options: T[], def: T): Promise<T> {
  if (!interactive()) return def;
  const a = await ask(
    `${question} ${options.map((o, i) => `${i + 1}) ${o}`).join('  ')}`,
    String(options.indexOf(def) + 1),
  );
  const n = Number(a);
  return options[n - 1] ?? (options.includes(a as T) ? (a as T) : def);
}
