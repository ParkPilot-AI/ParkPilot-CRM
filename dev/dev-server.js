#!/usr/bin/env node
'use strict';
// Local test server that behaves like the Netlify site: serves public/ and sends /api/* and /auth/*
// to the same handler the Netlify Function uses. Data is kept in ./data.
//   DEV_FAKE_LOGIN=you@example.com OWNER_EMAILS=you@example.com node dev/dev-server.js
// With DEV_FAKE_LOGIN set, "Sign in" skips Microsoft and signs you in as that address (testing only).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
process.env.COASTFIELDS_DATA = process.env.COASTFIELDS_DATA || path.join(__dirname, '..', 'data');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'local-dev-session-secret';
const { handle } = require('../server/handler');
const auth = require('../server/auth');

const PORT = Number(process.env.PORT) || 8888;
const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  if (u.pathname === '/auth/login' && process.env.DEV_FAKE_LOGIN) {
    const email = process.env.DEV_FAKE_LOGIN.toLowerCase();
    const session = auth.seal({ email, name: email, iat: Date.now(), exp: Date.now() + 14 * 864e5 });
    res.writeHead(302, { Location: u.searchParams.get('return') || '/', 'Set-Cookie': `cf_session=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax` });
    return res.end();
  }
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/auth/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle({ method: req.method, path: u.pathname, search: u.search, headers: req.headers, body: req.method === 'GET' ? null : Buffer.concat(chunks) });
    const headers = {};
    for (const [k, v] of Object.entries(r.headers || {})) headers[k] = v;
    res.writeHead(r.status, headers); return res.end(r.body);
  }
  let file = path.normalize(path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`Coastfields (Netlify build) on http://localhost:${PORT}`));
