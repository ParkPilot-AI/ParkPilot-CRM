// Netlify Function: every /api/* and /auth/* request arrives here.
// Listed here so Netlify packages these libraries with the function (the server code loads them).
import '@netlify/blobs';
import 'sql.js';
import core from '../../server/handler.js';

process.env.COASTFIELDS_STORE = process.env.COASTFIELDS_STORE || 'netlify';

export default async req => {
  const u = new URL(req.url);
  const headers = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  headers['x-forwarded-proto'] = u.protocol.replace(':', '');
  headers['x-forwarded-host'] = headers['x-forwarded-host'] || u.host;
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : Buffer.from(await req.arrayBuffer());
  const r = await core.handle({ method: req.method, path: u.pathname, search: u.search, headers, body });
  const h = new Headers();
  for (const [k, v] of Object.entries(r.headers || {})) {
    if (Array.isArray(v)) v.forEach(x => h.append(k, x));
    else if (v !== undefined && v !== null) h.set(k, String(v));
  }
  return new Response(r.body === undefined || r.body === null ? '' : r.body, { status: r.status, headers: h });
};

export const config = { path: ['/api/*', '/auth/*'] };
