import fs from 'node:fs/promises';
import type http from 'node:http';
import { fileURLToPath } from 'node:url';
const assets = new URL('../../ui/app/', import.meta.url);
const staticFiles: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/html.js': ['html.js', 'text/javascript; charset=utf-8'],
  '/health.js': ['health.js', 'text/javascript; charset=utf-8'],
  '/content.js': ['content.js', 'text/javascript; charset=utf-8'],
  '/quick.js': ['quick.js', 'text/javascript; charset=utf-8'],
  '/memory.js': ['memory.js', 'text/javascript; charset=utf-8'],
  '/projects.js': ['projects.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/base.css': ['base.css', 'text/css; charset=utf-8'],
};

export async function serveAsset(pathname: string, res: http.ServerResponse) {
  const entry = staticFiles[pathname];
  if (!entry) return false;
  const [file, mime] = entry;
  const body = await fs.readFile(fileURLToPath(new URL(file, assets)));
  res.writeHead(200, { 'Content-Type': mime });
  res.end(body);
  return true;
}
