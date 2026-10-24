'use strict';
// The Netlify Blobs storage backend, against Netlify's own local Blobs server.
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coastfields-blobs-'));
process.env.COASTFIELDS_STORE = 'netlify';
delete process.env.COASTFIELDS_DATA;

let server, store, ConflictError;
test.before(async () => {
  const { BlobsServer } = await import('@netlify/blobs/server');
  const { setEnvironmentContext } = await import('@netlify/blobs');
  server = new BlobsServer({ directory: dir, token: 'tok' });
  const { port } = await server.start();
  setEnvironmentContext({ siteID: 'test-site', token: 'tok', edgeURL: `http://localhost:${port}`, uncachedEdgeURL: `http://localhost:${port}` });
  ({ getStore: store, ConflictError } = require('../server/store'));
  store = store();
});

test('uses Netlify Blobs when running on Netlify', () => { assert.equal(store.kind, 'netlify'); });

test('first save, read back, and conditional saves', async () => {
  assert.deepEqual(await store.read(), { bytes: null, etag: null });
  const e1 = await store.write(Buffer.from('version one'), null);
  assert.ok(e1);
  const r = await store.read();
  assert.equal(r.bytes.toString(), 'version one');
  assert.equal(r.etag, e1);
  assert.equal(await store.etag(), e1);
  const e2 = await store.write(Buffer.from('version two'), e1);
  assert.notEqual(e2, e1);
  // A save based on the old version is refused rather than overwriting the newer one.
  await assert.rejects(store.write(Buffer.from('stale'), e1), e => e instanceof ConflictError);
  // So is creating it again from scratch.
  await assert.rejects(store.write(Buffer.from('fresh'), null), e => e instanceof ConflictError);
  assert.equal((await store.read()).bytes.toString(), 'version two');
});

test('daily backups are written once per day', async () => {
  assert.equal(await store.backup(Buffer.from('b1'), '2026-10-24'), true);
  assert.equal(await store.backup(Buffer.from('b2'), '2026-10-24'), false);
  assert.deepEqual(await store.listBackups(), ['backups/coastfields-2026-10-24.db']);
});

test('the Outlook "sync needed" flag', async () => {
  assert.equal(await store.takeFlag(), null);
  await store.setFlag('changed');
  assert.equal(await store.takeFlag(), 'changed');
  assert.equal(await store.takeFlag(), null);
});

test('a whole SQLite database round-trips', async () => {
  const D = require('../server/db');
  await D.open();
  D.insert('contacts', { first_name: 'Round', last_name: 'Trip' });
  const cur = await store.read();
  await store.write(D.exportBytes(), cur.etag);
  const back = await store.read();
  await D.open(back.bytes);
  assert.equal(D.db.prepare("SELECT last_name FROM contacts").get().last_name, 'Trip');
});

test.after(async () => { await server.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
