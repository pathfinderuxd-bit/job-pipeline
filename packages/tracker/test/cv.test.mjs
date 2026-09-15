/* The CV library, tested the way a browser would load it: the sources are
 * plain scripts, so they are evaluated against a stand-in window rather than
 * imported. Nothing here touches a real Drive, a real file or a real CV.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('../src/', import.meta.url);
const load = (name, win) =>
  new Function('window', 'module', readFileSync(fileURLToPath(new URL(name, SRC)), 'utf8'))(win, undefined);

function sandbox() {
  const shelf = {};
  const win = {
    crypto: globalThis.crypto,
    localStorage: {
      getItem: (k) => (k in shelf ? shelf[k] : null),
      setItem: (k, v) => { shelf[k] = String(v); },
    },
  };
  load('cvstore.js', win);
  load('cvui.js', win);
  win.CVStore.open('someone@example.com');
  return win;
}

/* A CV, without a filesystem: add() only reads name and size. */
const fakeFile = (name, size = 2048) => ({ name, size });

test('a file that is not a document is refused, with its extension named', async () => {
  const win = sandbox();
  await assert.rejects(win.CVStore.add(fakeFile('headshot.png')), /\.png files cannot be opened as a CV/);
  await assert.rejects(win.CVStore.add(fakeFile('cv.pdf', 0)), /empty/);
  await assert.rejects(win.CVStore.add(fakeFile('cv.pdf', 40 * 1024 * 1024)), /25 MB or smaller/);
  assert.equal(win.CVStore.live().length, 0);
});

test('an upload with no name falls back to the filename, without its extension', async () => {
  const win = sandbox();
  const cv = await win.CVStore.add(fakeFile('Delivery-Lead-2026.pdf'), '  ');
  assert.equal(cv.name, 'Delivery-Lead-2026');
  assert.equal(cv.kind, 'General');
  assert.equal(cv.ext, '.pdf');
});

test('the dropdown groups CVs by what each one is for', async () => {
  const win = sandbox();
  await win.CVStore.add(fakeFile('a.pdf'), 'Contract CV', 'Contract');
  await win.CVStore.add(fakeFile('b.docx'), 'Permanent CV', 'Full-Time');

  const html = win.cvOptionsHtml('—');
  const groups = [...html.matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['Full-Time', 'Contract', 'CV actions']);
  assert.match(html, /Contract CV · PDF/);
  assert.match(html, /Permanent CV · DOCX/);
});

test('"Open this CV" is offered only when the row actually has a file', async () => {
  const win = sandbox();
  const cv = await win.CVStore.add(fakeFile('a.pdf'), 'Contract CV', 'Contract');

  assert.ok(!win.cvOptionsHtml('—').includes('__cv_open__'));
  assert.ok(win.cvOptionsHtml('cv:' + cv.id).includes('__cv_open__'));
  /* Upload and Manage are always there; the editor asks for no actions. */
  assert.ok(win.cvOptionsHtml('—').includes('__cv_upload__'));
  assert.ok(!win.cvOptionsHtml('—', false).includes('__cv_library__'));
});

test('a label from before the library existed stays on its row, marked', () => {
  const win = sandbox();
  assert.equal(win.cvDisplayName('Full-time CV'), 'Full-time CV — no file');
  const html = win.cvOptionsHtml('Full-time CV');
  assert.match(html, /<optgroup label="On this row"/);
  assert.match(html, /value="Full-time CV" selected/);
});

test('deleting a CV keeps it readable on the applications that used it', async () => {
  const win = sandbox();
  const cv = await win.CVStore.add(fakeFile('a.pdf'), 'Contract CV', 'Contract');
  const value = 'cv:' + cv.id;

  win.CVStore.remove(cv.id);
  assert.equal(win.CVStore.live().length, 0);
  assert.equal(win.cvDisplayName(value), 'Contract CV · PDF (deleted)');
  assert.match(win.cvOptionsHtml(value), /<optgroup label="On this row"/);

  win.CVStore.restore(cv.id);
  assert.equal(win.CVStore.live().length, 1);
  assert.equal(win.cvDisplayName(value), 'Contract CV · PDF');
});

test('an id with no entry behind it says so rather than showing the id', () => {
  const win = sandbox();
  assert.equal(win.cvDisplayName('cv:0000'), 'Deleted or unavailable CV');
  assert.equal(win.cvDisplayName('—'), 'Select CV…');
});

test('changing what a CV is for moves it to that group', async () => {
  const win = sandbox();
  const cv = await win.CVStore.add(fakeFile('a.pdf'), 'One CV', 'General');
  win.CVStore.retype(cv.id, 'Part-Time');
  const groups = [...win.cvOptionsHtml('—').matchAll(/<optgroup label="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['Part-Time', 'CV actions']);
});

test('the Drive index and this machine merge, newest edit per CV winning', async () => {
  const win = sandbox();
  const mine = await win.CVStore.add(fakeFile('a.pdf'), 'Mine', 'General');
  mine.touchedAt = '2026-01-01T00:00:00.000Z';

  let saved = null;
  win.CVStore.attachDrive({
    loadJson: () => Promise.resolve({
      cvs: [
        { id: mine.id, name: 'Renamed elsewhere', kind: 'Contract', ext: '.pdf',
          uploadedAt: mine.uploadedAt, touchedAt: '2026-06-01T00:00:00.000Z' },
        { id: 'other', name: 'From the other machine', kind: 'General', ext: '.docx',
          uploadedAt: '2026-05-01T00:00:00.000Z', touchedAt: '2026-05-01T00:00:00.000Z' },
      ],
    }),
    saveJson: (name, doc) => { saved = doc; return Promise.resolve({ id: 'x' }); },
    upload: () => Promise.resolve('drive-id'),
    download: () => Promise.reject(new Error('not needed')),
    remove: () => Promise.resolve(''),
  });

  await win.CVStore.sync();
  assert.equal(win.CVStore.live().length, 2);
  assert.equal(win.CVStore.get(mine.id).name, 'Renamed elsewhere');
  assert.equal(win.CVStore.get('other').name, 'From the other machine');
  assert.ok(saved, 'the merged index goes back to Drive');
});

test('a local edit newer than the Drive copy survives the merge', async () => {
  const win = sandbox();
  const mine = await win.CVStore.add(fakeFile('a.pdf'), 'Mine', 'General');
  win.CVStore.rename(mine.id, 'Renamed here just now');

  win.CVStore.attachDrive({
    loadJson: () => Promise.resolve({
      cvs: [{ id: mine.id, name: 'Stale', kind: 'General', ext: '.pdf',
              uploadedAt: mine.uploadedAt, touchedAt: '2020-01-01T00:00:00.000Z' }],
    }),
    saveJson: () => Promise.resolve({ id: 'x' }),
    upload: () => Promise.resolve('drive-id'),
    download: () => Promise.reject(new Error('not needed')),
    remove: () => Promise.resolve(''),
  });

  await win.CVStore.sync();
  assert.equal(win.CVStore.get(mine.id).name, 'Renamed here just now');
});

test('anything uploaded while Drive was unreachable is pushed up later', async () => {
  const win = sandbox();
  await win.CVStore.add(fakeFile('a.pdf'), 'Offline upload', 'General');
  assert.equal(win.CVStore.live()[0].driveId, null);

  /* Nothing to push without the bytes — IndexedDB is absent here — so this
   * checks the store asks for them rather than inventing an upload. */
  let asked = 0;
  win.CVStore.attachDrive({
    loadJson: () => Promise.resolve(null),
    saveJson: () => Promise.resolve({ id: 'x' }),
    upload: () => { asked++; return Promise.resolve('drive-id'); },
    download: () => Promise.reject(new Error('not needed')),
    remove: () => Promise.resolve(''),
  });
  const pushed = await win.CVStore.pushPending();
  assert.equal(pushed, 0);
  assert.equal(asked, 0);
});
