export interface CommandLine {
  executable: string;
  args: string[];
  env?: Record<string, string>;
}
export type Shell = 'posix' | 'powershell';

export function formatCommand(
  command: CommandLine,
  shell: Shell = process.platform === 'win32' ? 'powershell' : 'posix',
): string {
  const quote =
    shell === 'powershell'
      ? (value: string) => `'${value.replace(/'/g, "''")}'`
      : (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  const invocation = [command.executable, ...command.args].map(quote).join(' ');
  const env = Object.entries(command.env ?? {});
  if (env.some(([key]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))
    throw new Error('Invalid environment variable name.');
  if (shell === 'powershell')
    return [...env.map(([key, value]) => `$env:${key}=${quote(value)};`), '&', invocation].join(
      ' ',
    );
  return [...env.map(([key, value]) => `${key}=${quote(value)}`), invocation].join(' ');
}

export function hubCommand(
  context: { root: string; node: string; cli: string },
  args: string[],
): string {
  return formatCommand({
    executable: context.node,
    args: [context.cli, ...args],
    env: { AGENT_HUB_HOME: context.root },
  });
}
