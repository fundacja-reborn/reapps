import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Errors on the 2FA page sit next to what the user acted on: a field's error
// under the field, an action's error right above its buttons. Before, every
// error went to one banner at the top of the page - out of view on a phone,
// so "Turn off 2FA" with an empty password looked like a button that did
// nothing - and some of them were the server's English text.
const page = readFileSync(
  new URL('../routes/settings/security/two-factor/+page.svelte', import.meta.url),
  'utf-8'
);

/** The markup from `start` to the end of the form it is in. */
function formFrom(start: string): string {
  const from = page.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  return page.slice(from, page.indexOf('</form>', from));
}

/** Positions of `marks` in `text`; each must be there, after the one before. */
function expectInOrder(text: string, marks: string[]): void {
  let last = -1;
  for (const mark of marks) {
    const at = text.indexOf(mark, last + 1);
    expect(at, mark).toBeGreaterThan(last);
    last = at;
  }
}

describe('2FA page errors', () => {
  it('keeps only the status load error at the top of the page', () => {
    const top = page.slice(
      page.indexOf('<SettingsLayout'),
      page.indexOf("{#if step === 'loading'}")
    );
    expect(top).toContain('{#if statusError}');
    expect(top).not.toMatch(/setupError|verifyError|disableError|disablePasswordError/);
  });

  it('shows the setup error above the enable button', () => {
    const card = page.slice(
      page.indexOf("{:else if step === 'status'}"),
      page.indexOf("{:else if step === 'setup'}")
    );
    expectInOrder(card, ['{#if setupError}', 'onclick={startSetup}']);
  });

  it('shows the code error under the code and the action error above the buttons', () => {
    expectInOrder(formFrom('verifyAndEnable();'), [
      'id="verification-code"',
      '{#if codeError}',
      '{#if verifyError}',
      'type="submit"'
    ]);
  });

  it('shows the password error under the password and the action error above the buttons', () => {
    expectInOrder(formFrom('disable2FA();'), [
      'id="disable-password"',
      '{#if disablePasswordError}',
      '{#if disableError}',
      'type="submit"'
    ]);
  });

  it('marks an empty password as required, like the other security forms', () => {
    expect(page).toMatch(/if \(!disablePassword\) return \$t\('auth\.validation\.required'\)/);
  });

  it("never shows the server's own error text", () => {
    expect(page).not.toMatch(/data\.error\s*\|\|/);
  });
});
