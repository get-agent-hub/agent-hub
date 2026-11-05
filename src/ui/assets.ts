import fs from 'node:fs/promises';
import type http from 'node:http';
import { fileURLToPath } from 'node:url';
const assets = new URL('../../ui/app/', import.meta.url);
const staticFiles: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/shared/html.js': ['shared/html.js', 'text/javascript; charset=utf-8'],
  '/shared/navigation.js': ['shared/navigation.js', 'text/javascript; charset=utf-8'],
  '/shared/view.js': ['shared/view.js', 'text/javascript; charset=utf-8'],
  '/shared/en.js': ['shared/en.js', 'text/javascript; charset=utf-8'],
  '/entities/resource.js': ['entities/resource.js', 'text/javascript; charset=utf-8'],
  '/entities/health.js': ['entities/health.js', 'text/javascript; charset=utf-8'],
  '/entities/history-conversation.js': [
    'entities/history-conversation.js',
    'text/javascript; charset=utf-8',
  ],
  '/pages/overview.js': ['pages/overview.js', 'text/javascript; charset=utf-8'],
  '/pages/sources.js': ['pages/sources.js', 'text/javascript; charset=utf-8'],
  '/pages/resources.js': ['pages/resources.js', 'text/javascript; charset=utf-8'],
  '/features/content.js': ['features/content.js', 'text/javascript; charset=utf-8'],
  '/features/quick.js': ['features/quick.js', 'text/javascript; charset=utf-8'],
  '/features/memory.js': ['features/memory.js', 'text/javascript; charset=utf-8'],
  '/features/projects.js': ['features/projects.js', 'text/javascript; charset=utf-8'],
  '/features/history.js': ['features/history.js', 'text/javascript; charset=utf-8'],
  '/features/import-mcp.js': ['features/import-mcp.js', 'text/javascript; charset=utf-8'],
  '/features/sync-mcp.js': ['features/sync-mcp.js', 'text/javascript; charset=utf-8'],
  '/features/check-mcp.js': ['features/check-mcp.js', 'text/javascript; charset=utf-8'],
  '/styles/primitives.css': ['styles/primitives.css', 'text/css; charset=utf-8'],
  '/styles/tables.css': ['styles/tables.css', 'text/css; charset=utf-8'],
  '/styles/resources.css': ['styles/resources.css', 'text/css; charset=utf-8'],
  '/styles/dialogs.css': ['styles/dialogs.css', 'text/css; charset=utf-8'],
  '/styles/history.css': ['styles/history.css', 'text/css; charset=utf-8'],
  '/styles/shell.css': ['styles/shell.css', 'text/css; charset=utf-8'],
  '/styles/pages.css': ['styles/pages.css', 'text/css; charset=utf-8'],
  '/styles/responsive.css': ['styles/responsive.css', 'text/css; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/base.css': ['base.css', 'text/css; charset=utf-8'],
};

export async function serveAsset(pathname: string, res: http.ServerResponse) {
  const entry = Object.hasOwn(staticFiles, pathname) ? staticFiles[pathname] : undefined;
  if (!entry) return false;
  const [file, mime] = entry;
  const body = await fs.readFile(fileURLToPath(new URL(file, assets)));
  res.writeHead(200, { 'Content-Type': mime });
  res.end(body);
  return true;
}
