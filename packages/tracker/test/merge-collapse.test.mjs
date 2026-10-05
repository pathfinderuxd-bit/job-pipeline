import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const Merge = (() => {
  const src = readFileSync(new URL('../src/merge.js', import.meta.url), 'utf8');
  const win = {};
  new Function('window', 'module', src)(win, undefined);
  return win.Merge;
})();

test('copies of one job fold into one, oldest applied date kept', () => {
  const rows = [
    { company: 'Acme Ltd', role: 'Design Lead', status: 'lead', applied: '23 Aug', appliedSort: 20260823, updatedSort: 20260824 },
    { company: 'Acme Ltd', role: 'Design Lead', status: 'wait', applied: '24 Aug', appliedSort: 20260824, updatedSort: 20260825, threadId: 't1' },
  ];
  const out = Merge.collapse(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'wait');
  assert.equal(out[0].appliedSort, 20260823);
  assert.equal(out[0].threadId, 't1');
});

test('one sweep with six mails about one job adds one row', () => {
  const inc = Array.from({ length: 6 }, () => ({ company: 'Acme Ltd', role: 'Design Lead', status: 'wait', appliedSort: 20260824 }));
  assert.equal(Merge.diff([], inc, []).added.length, 1);
});
