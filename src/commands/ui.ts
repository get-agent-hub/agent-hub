import { execFile } from 'node:child_process';
import { startUiServer } from '../ui/server.js';

export async function uiCommand(opts: { port: string; open: boolean }) {
  if (!/^\d+$/.test(opts.port) || Number(opts.port) > 65535) throw new Error('Port must be between 0 and 65535.');
  let ui: Awaited<ReturnType<typeof startUiServer>>;
  try { ui = await startUiServer({ port: Number(opts.port) }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new Error(`Port ${opts.port} is busy. Try \`ahub ui --port 3083\`.`);
    throw e;
  }
  console.log(`Agent Hub → ${ui.url}\nPress Ctrl+C to stop.`);
  if (opts.open) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    execFile(command, [ui.url], (e) => { if (e) console.error(`Open ${ui.url} in your browser.`); });
  }
  const stop = () => { ui.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
