'use strict';
// "Sign in with Microsoft" for the portal (OpenID Connect, authorisation code flow with PKCE).
//
//  /auth/login            -> sends you to Microsoft's sign-in page for your organisation
//  /auth/signin-callback  -> Microsoft sends you back here; the portal checks who you are and
//                            sets an encrypted session cookie (14 days, renewed as you use it)
//  /auth/logout           -> clears the session
//
// Only accounts in your organisation (GRAPH_TENANT_ID) can sign in, and if OWNER_EMAILS is set,
// only those people. The ID token is taken straight from Microsoft's token endpoint over TLS using
// the app's client secret, so its contents can be trusted without a separate signature check
// (OpenID Connect Core 1.0, section 3.1.3.7); the audience, tenant, nonce and expiry are still checked.
const crypto = require('node:crypto');

const LOGIN = process.env.LOGIN_BASE || 'https://login.microsoftonline.com';
const SESSION_COOKIE = 'cf_session';
const LOGIN_COOKIE = 'cf_login';
const SESSION_DAYS = 14;

function cfg() {
  return {
    clientId: (process.env.GRAPH_CLIENT_ID || '').trim(),
    secret: (process.env.GRAPH_CLIENT_SECRET || '').trim(),
    tenant: (process.env.GRAPH_TENANT_ID || '').trim(),
    sessionSecret: (process.env.SESSION_SECRET || process.env.GRAPH_CLIENT_SECRET || '').trim()
  };
}
function ready() { const c = cfg(); return !!(c.clientId && c.secret && c.tenant && c.sessionSecret); }
function missing() {
  const c = cfg();
  return [['GRAPH_CLIENT_ID', c.clientId], ['GRAPH_CLIENT_SECRET', c.secret], ['GRAPH_TENANT_ID', c.tenant]].filter(([, v]) => !v).map(([k]) => k);
}
function owners() { return (process.env.OWNER_EMAILS || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean); }

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function key() { return crypto.createHash('sha256').update('coastfields-session:' + cfg().sessionSecret).digest(); }
function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b64url).join('.');
}
function unseal(str) {
  try {
    const [iv, tag, enc] = String(str).split('.').map(fromB64url);
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(name, value, { maxAge, path = '/', secure = true } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ''}`;
}
const isHttps = origin => /^https:/.test(origin || '');
const safeReturn = r => (typeof r === 'string' && /^\/(?!\/)/.test(r) ? r : '/');

function startLogin(origin, returnTo, prompt) {
  if (!ready()) throw Object.assign(new Error(`Sign-in isn’t set up yet. Add ${missing().join(', ')} in Netlify → Site configuration → Environment variables, then redeploy.`), { status: 503 });
  const { clientId, tenant } = cfg();
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(16)), nonce = b64url(crypto.randomBytes(16));
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: `${origin}/auth/signin-callback`, response_mode: 'query',
    scope: 'openid profile email', state, nonce,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256'
  });
  if (prompt === 'select_account') q.set('prompt', 'select_account');
  const pending = seal({ state, nonce, verifier, returnTo: safeReturn(returnTo), exp: Date.now() + 10 * 60e3 });
  return {
    location: `${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${q}`,
    setCookie: cookie(LOGIN_COOKIE, pending, { maxAge: 600, path: '/auth', secure: isHttps(origin) })
  };
}

async function finishLogin(origin, query, cookieHeader) {
  if (query.error) throw Object.assign(new Error(query.error_description || query.error), { status: 400 });
  const p = unseal(parseCookies(cookieHeader)[LOGIN_COOKIE]);
  if (!p || p.state !== query.state || p.exp < Date.now()) throw Object.assign(new Error('The sign-in took too long or was started in another window. Please try again.'), { status: 400 });
  const { clientId, secret, tenant } = cfg();
  const res = await fetch(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: query.code,
      redirect_uri: `${origin}/auth/signin-callback`, code_verifier: p.verifier, scope: 'openid profile email' })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id_token) throw Object.assign(new Error(j.error_description ? j.error_description.split('\r\n')[0] : 'Microsoft sign-in failed.'), { status: 400 });
  const claims = JSON.parse(fromB64url(j.id_token.split('.')[1]).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== clientId) throw Object.assign(new Error('Sign-in token was not issued for this portal.'), { status: 401 });
  if (claims.nonce !== p.nonce) throw Object.assign(new Error('Sign-in check failed (nonce). Please try again.'), { status: 401 });
  if (!claims.exp || claims.exp < now - 60) throw Object.assign(new Error('Sign-in token has expired. Please try again.'), { status: 401 });
  if (/^[0-9a-f-]{36}$/i.test(tenant) && claims.tid !== tenant) throw Object.assign(new Error('Please sign in with your Coastfields work account.'), { status: 403 });
  const email = String(claims.preferred_username || claims.email || claims.upn || '').toLowerCase();
  const list = owners();
  if (!email) throw Object.assign(new Error('Microsoft did not share an email address for this account.'), { status: 403 });
  if (list.length && !list.includes(email)) throw Object.assign(new Error(`${email} does not have access to the Coastfields Customer Portal.`), { status: 403, email });
  const session = { email, name: claims.name || email, iat: Date.now(), exp: Date.now() + SESSION_DAYS * 864e5 };
  return {
    location: p.returnTo || '/',
    setCookies: [cookie(SESSION_COOKIE, seal(session), { maxAge: SESSION_DAYS * 86400, secure: isHttps(origin) }),
      cookie(LOGIN_COOKIE, '', { maxAge: 0, path: '/auth', secure: isHttps(origin) })]
  };
}

// Returns { user, renew } or { error, status }.
function currentUser(cookieHeader, origin) {
  const s = unseal(parseCookies(cookieHeader)[SESSION_COOKIE]);
  if (!s || !s.email || s.exp < Date.now()) return { status: 401, error: 'Please sign in.' };
  const list = owners();
  if (list.length && !list.includes(s.email)) return { status: 403, error: `${s.email} does not have access to the Coastfields Customer Portal.`, noAccess: true };
  let renew = null;
  if (Date.now() - s.iat > 864e5) {
    const next = { ...s, iat: Date.now(), exp: Date.now() + SESSION_DAYS * 864e5 };
    renew = cookie(SESSION_COOKIE, seal(next), { maxAge: SESSION_DAYS * 86400, secure: isHttps(origin) });
  }
  return { user: { email: s.email, name: s.name }, renew };
}

function logout(origin) { return [cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isHttps(origin) })]; }

module.exports = { startLogin, finishLogin, currentUser, logout, ready, missing, seal, unseal, parseCookies };
