/* Tests for the merge. Run: node --test packages/tracker/test/merge.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* merge.js is a plain browser script, so load it the way a browser would
 * rather than as a module: hand it a stand-in window and take what it hangs
 * off it. This also proves the file has no module-system dependencies. */
const Merge = (() => {
  const src = readFileSync(new URL('../src/merge.js', import.meta.url), 'utf8');
  const win = {};
  new Function('window', 'module', src)(win, undefined);
  return win.Merge;
})();

const row = (over = {}) => ({
  status: 'wait', chip: 'Awaiting', company: 'Brightpath UK',
  role: 'IT Delivery Manager — Crewe', applied: '12 Sep', appliedSort: 20260912,
  updated: '—', updatedSort: 0, note: '', source: 'Adzuna ApplyIQ', ...over,
});

test('identity ignores the location clause on the role', () => {
  assert.equal(
    Merge.keyOf(row()),
    Merge.keyOf(row({ role: 'IT Delivery Manager — Crewe, hybrid, £60k' })),
  );
});

test('identity separates two roles at the same employer', () => {
  assert.notEqual(
    Merge.keyOf(row({ company: 'Redgate Search', role: 'ERP Consultant' })),
    Merge.keyOf(row({ company: 'Redgate Search', role: 'Project Director' })),
  );
});

test('an unseen application is an addition', () => {
  const r = Merge.diff([row()], [row({ company: 'Calder IT', role: 'Service Delivery Manager' })]);
  assert.equal(r.added.length, 1);
  assert.equal(r.changed.length, 0);
});

test('a rejection updates the row it belongs to', () => {
  const r = Merge.diff([row()], [row({ status: 'shut', chip: 'Not shortlisted', updated: '20 Sep', updatedSort: 20260920 })]);
  assert.equal(r.added.length, 0);
  assert.equal(r.changed.length, 1);
  const fields = r.changed[0].fields.map((f) => f.field).sort();
  assert.deepEqual(fields, ['chip', 'status', 'updated', 'updatedSort']);
});

test('a hand-set status is a conflict, never an overwrite', () => {
  const mine = row({ status: 'live', chip: 'Interview', manual: { status: true, chip: true } });
  const r = Merge.diff([mine], [row({ status: 'shut', chip: 'Rejected', updatedSort: 20260920 })]);
  assert.equal(r.changed.length, 0);
  assert.equal(r.conflicts.length, 1);

  const { rows, applied } = Merge.apply([mine], r, {});
  assert.equal(rows[0].status, 'live', 'hand-set status survives an unattended merge');
  assert.equal(applied.conflicts, 0);
});

test('a conflict can be accepted one field at a time', () => {
  const mine = row({ status: 'live', chip: 'Interview', manual: { status: true, chip: true } });
  const r = Merge.diff([mine], [row({ status: 'shut', chip: 'Rejected', updatedSort: 20260920 })]);
  const picks = {};
  picks[r.conflicts[0].key + '::status'] = true;
  const { rows } = Merge.apply([mine], r, { conflicts: picks });
  assert.equal(rows[0].status, 'shut');
  assert.equal(rows[0].chip, 'Interview', 'the field not picked is left alone');
});

test('an older sweep cannot walk a row backwards', () => {
  const current = row({ status: 'shut', chip: 'Rejected', updated: '20 Sep', updatedSort: 20260920 });
  const r = Merge.diff([current], [row({ status: 'wait', chip: 'Awaiting', updated: '12 Sep', updatedSort: 20260912 })]);
  assert.equal(r.changed.length, 0);
  assert.equal(r.unchanged, 1);
});

test('stars, cover letters, job descriptions and CV choice are never touched', () => {
  const mine = row({ star: '1', cl: 'Dear sir', jd: 'Role: ...', cv: 'Contract CV' });
  const r = Merge.diff([mine], [row({ status: 'shut', chip: 'Rejected', updatedSort: 20260920, star: '0', cl: '', jd: '', cv: '—' })]);
  const { rows } = Merge.apply([mine], r, {});
  assert.equal(rows[0].star, '1');
  assert.equal(rows[0].cl, 'Dear sir');
  assert.equal(rows[0].jd, 'Role: ...');
  assert.equal(rows[0].cv, 'Contract CV');
  assert.equal(rows[0].status, 'shut', 'the sweep still gets to update the status');
});

test('a deleted row does not come back', () => {
  const r = Merge.diff([], [row()], [Merge.keyOf(row())]);
  assert.equal(r.added.length, 0);
  assert.equal(r.skipped.length, 1);
  const { rows } = Merge.apply([], r, {});
  assert.equal(rows.length, 0);
});

test('an empty field in the sweep never blanks a filled one', () => {
  const mine = row({ note: 'recruiter offered a call Fri 18 Sep' });
  const r = Merge.diff([mine], [row({ note: '' })]);
  assert.equal(r.changed.length, 0);
  const { rows } = Merge.apply([mine], r, {});
  assert.equal(rows[0].note, 'recruiter offered a call Fri 18 Sep');
});

test('merged rows come back newest first', () => {
  const { rows } = Merge.apply(
    [row({ appliedSort: 20260901 })],
    Merge.diff([row({ appliedSort: 20260901 })], [row({ company: 'Calder IT', role: 'Service Delivery Manager', appliedSort: 20260914 })]),
    {},
  );
  assert.equal(rows[0].company, 'Calder IT');
});

test('summarise reads like a sentence', () => {
  const r = Merge.diff([row()], [row({ status: 'shut', chip: 'Rejected', updatedSort: 20260920 }), row({ company: 'Calder IT', role: 'Service Delivery Manager' })]);
  assert.equal(Merge.summarise(r), '1 new, 1 updated');
  assert.equal(Merge.summarise(Merge.diff([], [])), 'Nothing new');
});

test('additions split into named and unnamed', () => {
  const r = Merge.diff([], [
    row({ company: 'Northwind Labs', role: 'Product Design Lead' }),
    row({ company: '(unknown employer)', role: 'Indeed Application', needsReview: true }),
  ]);
  const split = Merge.partitionAdded(r);
  assert.equal(split.named.length, 1);
  assert.equal(split.unnamed.length, 1);
  assert.equal(Merge.summarise(r), '1 new, 1 unnamed');
});

test('an unnamed row can be left out of the merge', () => {
  const incoming = [
    row({ company: 'Northwind Labs', role: 'Product Design Lead' }),
    row({ company: '(unknown employer)', role: 'Indeed Application', needsReview: true }),
  ];
  const r = Merge.diff([], incoming);
  const skip = {};
  skip[Merge.keyOf(incoming[1])] = true;
  const { rows } = Merge.apply([], r, { skipAdded: skip });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, 'Northwind Labs');
});
