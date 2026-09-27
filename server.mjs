// Minimal zero-dependency static file server for Kwenta.
// Serves the repo directory. Kwenta itself needs no server at all
// (open index.html directly and it works), but a server makes
// ES-module loading reliable across browsers and gives a stable URL.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Refuse dotfiles and dot-directories (.git/config, .env, ...) so that
    // serving this folder can never expose repository or credential metadata.
    if (pathname.split('/').some((seg) => seg.startsWith('.') && seg !== '.')) {
      return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    }

    // Resolve inside ROOT and refuse anything that escapes it. WHATWG URL
    // parsing already collapses dot-segments, so this is the second line.
    const target = resolve(join(ROOT, normalize(pathname)));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      return send(res, 403, 'Forbidden', { 'content-type': 'text/plain' });
    }

    const info = await stat(target).catch(() => null);
    if (!info) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });
    if (info.isDirectory()) return send(res, 404, 'Not found', { 'content-type': 'text/plain' });

    const body = await readFile(target);
    return send(res, 200, body, {
      'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(body.length),
    });
  } catch (err) {
    return send(res, 500, `Server error: ${err.message}`, { 'content-type': 'text/plain' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kwenta serving ${ROOT}`);
  console.log(`  local:   http://localhost:${PORT}/`);
  console.log(`  network: http://${HOST}:${PORT}/`);
});
