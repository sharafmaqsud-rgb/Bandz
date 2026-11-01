// A small static file server for development on this Mac only. The app has no backend:
// this just hands files to the browser, and it only listens on this machine.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.argv[2] ?? 8123);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};
// These folders hold private data and must never be served, even locally.
// They are compared in lower case because Mac file names ignore case, so /LOCAL would work too.
const BLOCKED = new Set(['local', 'reference', '.tools', '.git', 'node_modules']);
const ALLOWED_HOSTS = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

createServer(async (req, res) => {
  // Refuses other host names, so a web page cannot reach this server by pointing its own
  // domain name at this Mac.
  if (!ALLOWED_HOSTS.has(req.headers.host)) { res.writeHead(403).end(); return; }
  try {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const parts = path.split(sep).filter(Boolean);
    if (parts.some((p) => p === '..' || BLOCKED.has(p.toLowerCase()))) { res.writeHead(404).end(); return; }
    const file = await readFile(join(root, path.endsWith(sep) ? `${path}index.html` : path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(file);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
