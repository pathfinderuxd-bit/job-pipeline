/* corpus.test.mjs — score the extractor against real mail shapes.
 *
 * Every case in corpus.json is an email that actually arrived, renamed. The
 * point is that a rule change is measured rather than eyeballed: tighten a
 * phrase to fix one rejection and this says immediately whether three
 * acknowledgements broke in the process.
 *
 * A failure here is a spec, not a chore. Add the email that got it wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

const rules = JSON.parse(readFileSync(join(SRC, 'rules.json'), 'utf8'));
const corpus = JSON.parse(readFileSync(join(HERE, 'corpus.json'), 'utf8'));

const win = {};
new Function('window', 'module', readFileSync(join(SRC, 'extract.js'), 'utf8'))(win, undefined);
const { Extract } = win;

/* What the gate made of one email: 'outcome', 'ack', or 'none'. */
function verdict(c) {
  const row = Extract.threadToApplication([{
    threadId: 't', sender: c.sender, subject: c.subject, body: c.body,
    date: new Date('2026-09-14T09:00:00Z'),
  }], rules);
  if (!row) return { kind: 'none', row: null };
  return { kind: row.status === 'wait' ? 'ack' : 'outcome', row };
}

const results = corpus.cases.map((c) => ({ c, got: verdict(c) }));

test('no alert, digest or match suggestion becomes a row', () => {
  const wrong = results
    .filter(({ c, got }) => c.want === 'none' && got.kind !== 'none')
    .map(({ c, got }) => `${c.subject}  ->  ${got.kind}/${got.row.chip}`);
  assert.deepEqual(wrong, [], `\nnoise that got through:\n  ${wrong.join('\n  ')}\n`);
});

test('every acknowledgement is read as awaiting, not as a decision', () => {
  const wrong = results
    .filter(({ c, got }) => c.want === 'ack' && got.kind !== 'ack')
    .map(({ c, got }) => `${c.subject}  ->  ${got.kind}${got.row ? '/' + got.row.chip : ''}`);
  assert.deepEqual(wrong, [], `\nacknowledgements misread:\n  ${wrong.join('\n  ')}\n`);
});

test('every decision is read as a decision', () => {
  const wrong = results
    .filter(({ c, got }) => c.want === 'outcome' && got.kind !== 'outcome')
    .map(({ c, got }) => `${c.subject}  ->  ${got.kind}${got.row ? '/' + got.row.chip : ''}`);
  assert.deepEqual(wrong, [], `\ndecisions missed:\n  ${wrong.join('\n  ')}\n`);
});

test('a decision carries the right chip', () => {
  const wrong = results
    .filter(({ c, got }) => c.chip && got.row && got.row.chip !== c.chip)
    .map(({ c, got }) => `${c.subject}  ->  ${got.row.chip}, wanted ${c.chip}`);
  assert.deepEqual(wrong, [], `\nwrong chip:\n  ${wrong.join('\n  ')}\n`);
});

test('the employer is named', () => {
  const wrong = results
    .filter(({ c, got }) => c.company && got.row &&
            got.row.company.toLowerCase() !== c.company.toLowerCase())
    .map(({ c, got }) => `${c.subject}  ->  "${got.row.company}", wanted "${c.company}"`);
  assert.deepEqual(wrong, [], `\nemployer misnamed:\n  ${wrong.join('\n  ')}\n`);
});

test('a decision is dated', () => {
  const wrong = results
    .filter(({ c, got }) => c.want === 'outcome' && got.row && !got.row.updatedSort)
    .map(({ c }) => c.subject);
  assert.deepEqual(wrong, [], `\nundated decisions:\n  ${wrong.join('\n  ')}\n`);
});
