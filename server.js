// Local dev server mirroring Vercel's /api + /public layout. `npm run dev`
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import search from './api/search.js';
import twin from './api/twin.js';
import feedback from './api/feedback.js';
import health from './api/health.js';

const routes = { '/api/search': search, '/api/twin': twin, '/api/feedback': feedback, '/api/health': health };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const PUB = join(import.meta.dirname, 'public');

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const route = routes[url.pathname];
    if (route) {
      req.query = Object.fromEntries(url.searchParams);
      if (req.method === 'POST') {
        let raw = ''; for await (const c of req) { raw += c; if (raw.length > 50000) break; }
        try { req.body = JSON.parse(raw || '{}'); } catch { req.body = null; }
      }
      return route(req, res);
    }
    const p = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    if (p.includes('..')) { res.statusCode = 400; return res.end(); }
    try {
      const data = await readFile(join(PUB, p));
      res.setHeader('content-type', TYPES[extname(p)] || 'application/octet-stream');
      res.end(data);
    } catch { res.statusCode = 404; res.end('Not found'); }
  });
}

if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(`Homegrown on http://localhost:${port}`));
}
