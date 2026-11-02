import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.argv.includes('--dist') ? 'dist' : 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (path.relative(root, target).startsWith('..') || path.isAbsolute(path.relative(root, target))) { response.writeHead(403); response.end(); return; }
    const bytes = await fs.readFile(target);
    response.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404); response.end('File non trovato'); }
});
const port = Number(process.env.CONTO_PORT || 8791);
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `La porta ${port} è già occupata.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Anteprima: http://localhost:${server.address().port}/${process.argv.includes('--dist') ? '' : '?dev=1'}\nSolo sviluppo: la versione pubblicata non richiede questo server.`));
