'use strict';
// Persistence for the portal's SQLite database file.
//  - On Netlify: one entry in a Netlify Blobs store ("coastfields"), saved with ETag checks so
//    two simultaneous saves can never overwrite each other.
//  - Locally (COASTFIELDS_DATA set, or not on Netlify): a file, for development and tests.
// A copy is kept once a day under backups/ (the last 60 are retained).
const fs = require('node:fs');
const path = require('node:path');

const STORE_NAME = process.env.COASTFIELDS_STORE_NAME || 'coastfields';
const DB_KEY = 'coastfields.db';
const FLAG_KEY = 'flags/sync-needed';
const DB_BLOB = DB_KEY;

class ConflictError extends Error { constructor() { super('Saved elsewhere at the same time'); this.code = 'CONFLICT'; } }

/* --------------------------------------------------------- Netlify Blobs */
const toAB = b => { const u = b instanceof Uint8Array ? b : new Uint8Array(b); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); };
function netlifyStore() {
  const crypto = require('node:crypto');
  // Loaded as an ES module (the form Netlify packages with the function).
  let lib = null;
  const load = async () => { if (!lib) lib = await import('@netlify/blobs'); return lib; };
  const store = () => lib.getStore({ name: STORE_NAME, consistency: 'strong' });
  // Each save stamps the entry with a random "rev" in its metadata. The rev identifies the version
  // (it is what the handler compares), and the ETag that Netlify returns makes the save conditional.
  const etags = new Map(); // rev -> Netlify ETag, when known
  const revOf = m => (m && m.metadata && m.metadata.rev) || (m && m.etag) || (m ? 'legacy' : null);
  return {
    kind: 'netlify',
    async etag() { await load(); return revOf(await store().getMetadata(DB_KEY)); },
    async read() {
      await load();
      const r = await store().getWithMetadata(DB_KEY, { type: 'arrayBuffer' });
      if (!r || !r.data) return { bytes: null, etag: null };
      const rev = revOf(r);
      if (r.etag) etags.set(rev, r.etag);
      return { bytes: Buffer.from(r.data), etag: rev };
    },
    async write(bytes, rev) {
      await load();
      const next = crypto.randomUUID();
      const opts = { metadata: { rev: next } };
      let r;
      if (!rev) r = await store().set(DB_KEY, toAB(bytes), { ...opts, onlyIfNew: true });
      else if (etags.get(rev)) r = await store().set(DB_KEY, toAB(bytes), { ...opts, onlyIfMatch: etags.get(rev) });
      else {
        if ((await this.etag()) !== rev) throw new ConflictError();
        r = await store().set(DB_KEY, toAB(bytes), opts);
      }
      if (!r || !r.modified) throw new ConflictError();
      if (r.etag) etags.set(next, r.etag);
      if (etags.size > 20) etags.delete(etags.keys().next().value);
      return next;
    },
    async backup(bytes, day) {
      await load();
      const s = store(), key = `backups/coastfields-${day}.db`;
      const r = await s.set(key, toAB(bytes), { onlyIfNew: true });
      if (!r.modified) return false;
      const { blobs } = await s.list({ prefix: 'backups/' });
      const names = blobs.map(b => b.key).sort();
      for (const k of names.slice(0, Math.max(0, names.length - 60))) await s.delete(k).catch(() => {});
      return true;
    },
    async listBackups() { await load(); const { blobs } = await store().list({ prefix: 'backups/' }); return blobs.map(b => b.key).sort().reverse(); },
    async readBackup(key) { await load(); const d = await store().get(key, { type: 'arrayBuffer' }); return d ? Buffer.from(d) : null; },
    async setFlag(reason) { await load(); await store().set(FLAG_KEY, reason || '1'); },
    async takeFlag() { await load(); const s = store(); const v = await s.get(FLAG_KEY, { type: 'text' }); if (v === null || v === undefined) return null; await s.delete(FLAG_KEY); return v; }
  };
}

/* ------------------------------------------------------------ local file */
function fileStore(dir) {
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  const file = path.join(dir, DB_BLOB), flag = path.join(dir, 'sync-needed');
  const tag = () => { try { const s = fs.statSync(file); return `"${s.mtimeMs}-${s.size}"`; } catch { return null; } };
  return {
    kind: 'file',
    async etag() { return tag(); },
    async read() { return fs.existsSync(file) ? { bytes: fs.readFileSync(file), etag: tag() } : { bytes: null, etag: null }; },
    async write(bytes, etag) {
      if ((etag || null) !== tag()) throw new ConflictError();
      fs.writeFileSync(file + '.tmp', Buffer.from(bytes));
      fs.renameSync(file + '.tmp', file);
      return tag();
    },
    async backup(bytes, day) {
      const f = path.join(dir, 'backups', `coastfields-${day}.db`);
      if (fs.existsSync(f)) return false;
      fs.writeFileSync(f, Buffer.from(bytes));
      return true;
    },
    async listBackups() { return fs.readdirSync(path.join(dir, 'backups')).map(f => 'backups/' + f).sort().reverse(); },
    async readBackup(key) { const f = path.join(dir, key); return fs.existsSync(f) && f.startsWith(dir) ? fs.readFileSync(f) : null; },
    async setFlag(reason) { fs.writeFileSync(flag, reason || '1'); },
    async takeFlag() { if (!fs.existsSync(flag)) return null; const v = fs.readFileSync(flag, 'utf8'); fs.rmSync(flag, { force: true }); return v; }
  };
}

let store = null;
function getStore() {
  if (!store) {
    const useNetlify = process.env.COASTFIELDS_STORE === 'netlify' && !process.env.COASTFIELDS_DATA;
    store = useNetlify ? netlifyStore() : fileStore(process.env.COASTFIELDS_DATA || path.join(__dirname, '..', 'data'));
  }
  return store;
}

module.exports = { getStore, ConflictError };
