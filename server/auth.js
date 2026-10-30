'use strict';
// "Sign in with Google" for the CRM (OpenID Connect, authorisation code flow with PKCE).
//
//  /auth/login            -> sends you to Google's sign-in page
//  /auth/signin-callback  -> Google sends you back here; the CRM checks who you are and sets an
//                            encrypted session cookie (14 days, renewed as you use it)
//  /auth/logout           -> clears the session
//
// Only verified Google accounts can sign in, optionally only from your Google Workspace domain
// (GOOGLE_WORKSPACE_DOMAIN), and then only people on the CRM's team list (or in OWNER_EMAILS) – the
// request handler checks that against the database. The ID token is taken straight from Google's
// token endpoint over TLS using the app's client secret, so its contents can be trusted without a
// separate signature check (OpenID Connect Core 1.0, section 3.1.3.7); the issuer, audience, nonce,
// expiry and domain are still checked.
const crypto = require('node:crypto');

const AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const SESSION_COOKIE = 'pp_session';
const LOGIN_COOKIE = 'pp_login';
const SESSION_DAYS = 14;

function cfg() {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    secret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    domain: (process.env.GOOGLE_WORKSPACE_DOMAIN || '').trim().toLowerCase(),
    sessionSecret: (process.env.SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim()
  };
}
function ready() { const c = cfg(); return !!(c.clientId && c.secret && c.sessionSecret); }
function missing() {
  const c = cfg();
  return [['GOOGLE_CLIENT_ID', c.clientId], ['GOOGLE_CLIENT_SECRET', c.secret]].filter(([, v]) => !v).map(([k]) => k);
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function key() { return crypto.createHash('sha256').update('parkpilot-session:' + cfg().sessionSecret).digest(); }
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
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip a malformed cookie */ }
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
  const { clientId, domain } = cfg();
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(16)), nonce = b64url(crypto.randomBytes(16));
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: `${origin}/auth/signin-callback`,
    scope: 'openid email profile', state, nonce,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256'
  });
  if (domain) q.set('hd', domain); // shows only accounts from your Workspace on Google's page
  if (prompt === 'select_account') q.set('prompt', 'select_account');
  const pending = seal({ state, nonce, verifier, returnTo: safeReturn(returnTo), exp: Date.now() + 10 * 60e3 });
  return {
    location: `${AUTH_URL}?${q}`,
    setCookie: cookie(LOGIN_COOKIE, pending, { maxAge: 600, path: '/auth', secure: isHttps(origin) })
  };
}

async function finishLogin(origin, query, cookieHeader) {
  if (query.error) throw Object.assign(new Error(query.error === 'access_denied' ? 'Sign-in was cancelled.' : (query.error_description || query.error)), { status: 400 });
  const p = unseal(parseCookies(cookieHeader)[LOGIN_COOKIE]);
  if (!p || p.state !== query.state || p.exp < Date.now()) throw Object.assign(new Error('The sign-in took too long or was started in another window. Please try again.'), { status: 400 });
  const { clientId, secret, domain } = cfg();
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: query.code,
      redirect_uri: `${origin}/auth/signin-callback`, code_verifier: p.verifier })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.id_token) throw Object.assign(new Error(j.error_description || 'Google sign-in failed.'), { status: 400 });
  const claims = JSON.parse(fromB64url(j.id_token.split('.')[1]).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(claims.iss)) throw Object.assign(new Error('Sign-in token did not come from Google.'), { status: 401 });
  if (claims.aud !== clientId) throw Object.assign(new Error('Sign-in token was not issued for this CRM.'), { status: 401 });
  if (claims.nonce !== p.nonce) throw Object.assign(new Error('Sign-in check failed (nonce). Please try again.'), { status: 401 });
  if (!claims.exp || claims.exp < now - 60) throw Object.assign(new Error('Sign-in token has expired. Please try again.'), { status: 401 });
  const email = String(claims.email || '').toLowerCase();
  if (!email) throw Object.assign(new Error('Google did not share an email address for this account.'), { status: 403 });
  if (claims.email_verified === false || claims.email_verified === 'false') throw Object.assign(new Error('This Google account’s email address isn’t verified.'), { status: 403 });
  if (domain && String(claims.hd || '').toLowerCase() !== domain) throw Object.assign(new Error(`Please sign in with your @${domain} Google Workspace account.`), { status: 403 });
  const name = claims.name || email;
  const session = { email, name, iat: Date.now(), exp: Date.now() + SESSION_DAYS * 864e5 };
  return {
    email, name,
    location: p.returnTo || '/',
    setCookies: [cookie(SESSION_COOKIE, seal(session), { maxAge: SESSION_DAYS * 86400, secure: isHttps(origin) }),
      cookie(LOGIN_COOKIE, '', { maxAge: 0, path: '/auth', secure: isHttps(origin) })]
  };
}

// Returns { user, renew } or { error, status }.
function currentUser(cookieHeader, origin) {
  const s = unseal(parseCookies(cookieHeader)[SESSION_COOKIE]);
  if (!s || !s.email || s.exp < Date.now()) return { status: 401, error: 'Please sign in.' };
  let renew = null;
  if (Date.now() - s.iat > 864e5) {
    const next = { ...s, iat: Date.now(), exp: Date.now() + SESSION_DAYS * 864e5 };
    renew = cookie(SESSION_COOKIE, seal(next), { maxAge: SESSION_DAYS * 86400, secure: isHttps(origin) });
  }
  return { user: { email: s.email, name: s.name }, renew };
}

function logout(origin) { return [cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isHttps(origin) })]; }

module.exports = { startLogin, finishLogin, currentUser, logout, ready, missing, seal, unseal, parseCookies, SESSION_COOKIE };
