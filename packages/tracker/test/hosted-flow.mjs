/* Walks the whole hosted flow in a real browser against the demo stand-in:
 * sign in, choose a starting point, watch it save to 'Drive', delete a row
 * and undo it, then refresh and read the diff.
 *
 * Needs playwright, which the app itself does not:
 *   npm i -D playwright && npx playwright install chromium
 *   npm run build:preview && node packages/tracker/test/hosted-flow.mjs
 */
import pw from 'playwright';
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type()==='error' && !/ERR_(TUNNEL|NAME|INTERNET)/.test(m.text())) errs.push('console: '+m.text()); });
const url = 'file://' + process.cwd() + '/apps/preview/dist/index.html';
await p.goto(url);
await p.waitForTimeout(300);

const step = {};
step.gateShown = await p.isVisible('#gate .gate-card');
step.signInEnabled = await p.isEnabled('#gate-signin');

await p.click('#gate-signin');
await p.waitForTimeout(600);
step.choicesShown = await p.locator('.gate-choice').count();
step.choiceLabels = await p.locator('.gc-name').allTextContents();

// pick Stu's baseline
await p.locator('.gate-choice', { hasText: 'Sample data' }).click();
await p.waitForTimeout(400);
step.gateGone = !(await p.locator('#gate').count());
step.rows = await p.locator('#tb tr').count();
step.acctWho = await p.locator('.acct-who').textContent();
step.refreshBtn = await p.locator('#refreshbtn').isVisible();

// drive save toast should have appeared
await p.waitForTimeout(2600);
step.driveToast = await p.locator('[data-toast-id="drive"] .toast-text').textContent().catch(()=>null);

// delete a row -> undo toast -> undo restores it
const before = await p.locator('#tb tr').count();
await p.locator('#tb tr').first().locator('.delbtn').click();
await p.waitForTimeout(200);
step.afterDelete = await p.locator('#tb tr').count();
step.undoToast = await p.locator('.toast-warn .toast-text').textContent().catch(()=>null);
step.hasUndo = await p.locator('.toast-action', { hasText: 'Undo' }).count();
await p.locator('.toast-action', { hasText: 'Undo' }).click();
await p.waitForTimeout(200);
step.afterUndo = await p.locator('#tb tr').count();
step.undoRestored = step.afterUndo === before;

// hand-edit a status so the sweep must treat it as a conflict
await p.evaluate(() => {
  const tr = document.querySelector('#tb tr');
  const id = tr.getAttribute('data-id');
  window.Tracker.markManual(id, 'status');
  window.Tracker.markManual(id, 'chip');
  const rows = window.Tracker.rows();
  rows[id] = Object.assign(rows[id] || {}, { s: 'live', label: 'Interview', manual: { status: true, chip: true } });
  window.Tracker.touch();
});
await p.waitForTimeout(300);

// refresh
await p.click('#refreshbtn');
await p.waitForTimeout(900);
step.diffOpen = await p.locator('#diffdlg[open]').count() > 0;
step.diffTitle = await p.locator('#diff-title').textContent();
step.diffSections = await p.locator('.diff-sec h4').allTextContents();
step.conflicts = await p.locator('.diff-conflict').count();


// cancel changes nothing
const rowsBeforeCancel = await p.locator('#tb tr').count();
await p.click('#diff-cancel');
await p.waitForTimeout(200);
step.cancelNoChange = (await p.locator('#tb tr').count()) === rowsBeforeCancel;

// apply
await p.click('#refreshbtn');
await p.waitForTimeout(900);
await p.click('#diff-apply');
await p.waitForTimeout(1600);
step.rowsAfterApply = await p.locator('#tb tr').count();
step.stillSignedIn = await p.locator('#gate').count() === 0 || 'gate reappeared (expected: reload asks to sign in again)';

console.log(JSON.stringify(step, null, 1));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
