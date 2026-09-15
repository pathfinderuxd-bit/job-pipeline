/* The pieces v1.2 added that can be tested without a browser: how long a row
 * has been quiet, and what paste-to-fill makes of a block of text.
 *
 * Every employer below is invented. This repo is public, and which jobs
 * somebody applied for is nobody else's business — the same rule the row data
 * follows. scripts/no-real-data.mjs checks it and will fail the build.
 *
 * Both are pulled out of app.js rather than imported, because app.js is one
 * long IIFE that wants a DOM. The logic under test is copied nowhere — these
 * read the real source and evaluate the two functions out of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = readFileSync(fileURLToPath(new URL('../src/app.js', import.meta.url)), 'utf8');

function lift(name) {
  const start = APP.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' is no longer in app.js — the test needs updating');
  let depth = 0, i = APP.indexOf('{', start);
  const from = i;
  for (; i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) break;
  }
  return APP.slice(start, i + 1);
}

const daysSince = new Function(lift('daysSince') + '; return daysSince;')();

/* parsePasted leans on ROLE_WORDS above it and window.SRC_BADGE for the
 * source names, so both come along. */
const ROLE_WORDS_SRC = APP.match(/var ROLE_WORDS = [^;]+;/)[0];
const parse = new Function('window', ROLE_WORDS_SRC + lift('parsePasted') + '; return parsePasted;')
  ({ SRC_BADGE: { LinkedIn: 1, Indeed: 1, Greenhouse: 1, Workable: 1, Direct: 1, Unknown: 1 } });

function ymd(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return Number('' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()));
}

test('a row that moved today is nought days old', () => {
  assert.equal(daysSince(ymd(0)), 0);
});

test('a fortnight of silence is fourteen days', () => {
  assert.equal(daysSince(ymd(14)), 14);
});

test('a date that is not a date is not nought days old', () => {
  /* -1 rather than 0, or every row with no date would read as fresh. */
  assert.equal(daysSince(0), -1);
  assert.equal(daysSince(''), -1);
  assert.equal(daysSince('2026'), -1);
});

test('a LinkedIn confirmation gives up the employer', () => {
  const got = parse('Your application was sent to Calder IT!\nYou can keep track of your application in the "Applied" tab of My Jobs');
  assert.equal(got.company, 'Calder IT');
  assert.equal(got.source, 'LinkedIn');
});

test('a job card gives the role, the employer and the shape of the contract', () => {
  const got = parse([
    'Senior Product Design Contractor - B2B',
    'kitbag studio',
    'London Area, United Kingdom (Hybrid)',
    '55 GBP/hr - 85 GBP/hr',
    'Actively reviewing applicants',
  ].join('\n'));
  assert.equal(got.company, 'kitbag studio');
  assert.match(got.role, /Senior Product Design Contractor/);
  assert.equal(got.type, 'Contract');
  assert.match(got.note, /hybrid/);
});

test('a fixed term is temporary even when the advert also says full-time', () => {
  const got = parse('Northern Web UX/UI Design Lead (Fixed Term – 1 Year)\nRivermead\nLondon, England\nHybrid Full-time');
  assert.equal(got.type, 'Temporary');
});

test('an ATS thank-you names the employer without a confirmation line', () => {
  const got = parse('Thank you for your interest in a career at Corvi.\nYour application has been received and the Corvi Talent Acquisition Team will be in touch shortly.');
  assert.equal(got.company, 'Corvi');
});

test('nothing usable comes back empty rather than wrong', () => {
  const got = parse('Update profile\nNot now');
  assert.equal(got.company, undefined);
});

test('the marketing panel on a confirmation screen is not mistaken for the role', () => {
  const got = parse([
    'Your application was sent to Redgate Search!',
    'You can keep track of your application in the "Applied" tab of My Jobs',
    'Turn your resume into a profile that recruiters notice',
    'Update profile',
  ].join('\n'));
  assert.equal(got.company, 'Redgate Search');
  assert.ok(!/resume into a profile/.test(got.role || ''));
});
