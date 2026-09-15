/* Tests for the extractor.
 *
 * The thing under test is mostly the gate: a job alert must not become a row.
 *
 * The employers here are invented. The fixtures are modelled on the shapes real
 * mail actually takes — a careers system with a "Careers" suffix on the sender,
 * an ATS relaying for a named client, a board that never names the employer —
 * but this repo is public, and a test file should not be a list of where
 * someone applied.
 * Run: node --test packages/tracker/test/extract.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const Extract = (() => {
  const src = readFileSync(new URL('../src/extract.js', import.meta.url), 'utf8');
  const win = {};
  new Function('window', 'module', src)(win, undefined);
  return win.Extract;
})();

const rules = JSON.parse(readFileSync(new URL('../src/rules.json', import.meta.url), 'utf8'));

const msg = (over = {}) => ({
  threadId: 't1', sender: 'x@example.com', subject: '', body: '',
  date: new Date('2026-09-12T09:00:00Z'), ...over,
});
const row = (messages) => Extract.threadToApplication(messages, rules);

/* ---------------------------------------------------- what must be ignored -- */

const NOISE = [
  ['LinkedIn job alert', {
    sender: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>',
    subject: 'Rivermead is hiring for Remote job' }],
  ['LinkedIn profile notification', {
    sender: 'LinkedIn <notifications-noreply@linkedin.com>',
    subject: 'You appeared in 4 searches' }],
  ['Welcome to the Jungle match', {
    sender: 'Welcome to the Jungle <help@welcometothejungle.com>',
    subject: 'New match: Internal Communications & Events Lead at Ardent Bio' }],
  ['Adzuna account admin', {
    sender: 'Adzuna <no-reply@adzuna.co.uk>',
    subject: 'Welcome to Adzuna - your account has been created' }],
  ['Adzuna password reset', {
    sender: 'Adzuna <no-reply@adzuna.co.uk>',
    subject: 'Reset your Adzuna password' }],
  ['a shopping receipt that mentions nothing of the sort', {
    sender: 'Kitbag <noreply@service.kitbag.example>',
    subject: 'Thank you for your purchase!' }],
  ['a newsletter', {
    sender: 'RateWatch <news@mail.ratewatch.example>',
    subject: 'Compare loan rates from brands like two high-street banks' }],
];

for (const [name, fields] of NOISE) {
  test(`ignored: ${name}`, () => {
    assert.equal(row([msg(fields)]), null);
  });
}

test('an ordinary email with no application wording is not an application', () => {
  assert.equal(row([msg({ subject: 'Lunch?', body: 'Are you around Thursday' })]), null);
});

/* ------------------------------------------------- what must become a row -- */

test('an employer acknowledgement becomes an awaiting row and is named', () => {
  const r = row([msg({
    sender: 'Halden Foods Careers <jobs@careers.haldenfoods.co.uk>',
    subject: 'Your application for Learning Systems Lead',
    body: 'Thank you for applying. We have received your application.',
  })]);
  assert.ok(r, 'should be a row');
  assert.equal(r.status, 'wait');
  assert.equal(r.company, 'Halden Foods', 'the "Careers" suffix comes off');
  assert.match(r.role, /Learning Systems/);
  assert.equal(r.needsReview, false);
});

test('an interview invitation is live', () => {
  const r = row([msg({
    sender: 'Halden Foods Careers <jobs@careers.haldenfoods.co.uk>',
    subject: 'Your Application Update',
    body: 'Thank you for your recent application to the role of Learning Systems Lead. ' +
          'I would like to arrange a 30 minute screening call with you.',
  })]);
  assert.equal(r.status, 'live');
  assert.equal(r.chip, 'Screening');
});

test('a rejection closes the row', () => {
  const r = row([msg({
    sender: 'Corvi <no-reply@us.greenhouse-mail.io>',
    subject: 'Corvi | Update on your application',
    body: "we've decided not to move forward with your application at this time",
  })]);
  assert.equal(r.status, 'shut');
  assert.equal(r.company, 'Corvi');
  assert.equal(r.source, 'Greenhouse');
});

test('the sender name is used when the subject does not carry the employer', () => {
  const r = row([msg({
    sender: 'Brightpath UK <noreply@candidates.workablemail.com>',
    subject: 'Thanks for applying to Brightpath UK',
    body: 'Your application for the IT Delivery Manager job was submitted successfully.',
  })]);
  assert.equal(r.company, 'Brightpath UK');
  assert.equal(r.source, 'Workable');
});

test('the job board is never mistaken for the employer', () => {
  const r = row([msg({
    sender: 'Indeed <noreply@indeedemail.com>',
    subject: 'Indeed Application: Product Designer',
    body: 'Your application has been submitted. Thanks for applying.',
  })]);
  assert.ok(r, 'still a real application');
  assert.notEqual(r.company, 'Indeed');
  assert.equal(r.needsReview, true, 'flagged, because it genuinely cannot be named');
});

test('a thread is folded to its latest outcome', () => {
  const r = row([
    msg({ date: new Date('2026-09-08T09:00:00Z'),
          sender: 'Lumen Systems <no-reply@teamtailormail.com>',
          subject: 'Your application for Senior Product Designer',
          body: 'We have received your application' }),
    msg({ date: new Date('2026-09-10T09:00:00Z'),
          sender: 'Lumen Systems <no-reply@teamtailormail.com>',
          subject: 'Your application for Senior Product Designer',
          body: 'unfortunately you have not been shortlisted on this occasion' }),
  ]);
  assert.equal(r.status, 'shut');
  assert.equal(r.applied, '8 Sep', 'applied date is the first message');
  assert.equal(r.updated, '10 Sep', 'updated date is the outcome');
});

/* --------------------------------------------- sender-name tidying, direct -- */

test('companyFromSender strips recruiting suffixes and rejects the useless', () => {
  const f = (s) => Extract.companyFromSender(s, rules);
  assert.equal(f('"Acme Talent Acquisition" <jobs@acme.com>'), 'Acme');
  assert.equal(f('Beta Recruitment <hr@beta.io>'), 'Beta');
  assert.equal(f('Gamma Ltd <careers@gamma.co.uk>'), 'Gamma Ltd');
  assert.equal(f('no-reply <no-reply@whatever.com>'), '');
  assert.equal(f('LinkedIn <x@linkedin.com>'), '', 'a board is not an employer');
  assert.equal(f('bare@address.com'), '');
});
