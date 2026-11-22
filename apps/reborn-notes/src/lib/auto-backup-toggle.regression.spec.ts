import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// "Back up automatically" needs a recovery phrase (step 1) and a folder
// (step 2). The checkbox used to be `disabled` until then, so a click did
// nothing at all and read as a bug (desktop smoke, 2026-11-22). Now it stays
// clickable: with a step missing, a click leaves it off and lists the missing
// steps right under it, with their buttons (guideline 02: react where the
// user clicked). The steps are numbered and get a check mark when done.
const page = readFileSync(resolve(__dirname, '../routes/settings/backup/+page.svelte'), 'utf-8');

/** Each of `marks` must be in `text`, after the one before. */
function expectInOrder(text: string, marks: string[]): void {
  let last = -1;
  for (const mark of marks) {
    const at = text.indexOf(mark, last + 1);
    expect(at, mark).toBeGreaterThan(last);
    last = at;
  }
}

describe('auto-backup toggle', () => {
  it('keeps the checkbox clickable before the steps are done', () => {
    const toggle = page.slice(
      page.indexOf('checked={cfg.enabled}'),
      page.indexOf('</label>', page.indexOf('checked={cfg.enabled}'))
    );
    expect(toggle).not.toMatch(/\bdisabled=/);
    expect(toggle).toContain('onchange={onToggleChange}');
  });

  it('leaves it off on a click with a step missing and focuses the first missing step', () => {
    const handler = page.slice(
      page.indexOf('async function onToggleChange'),
      page.indexOf('async function finishPhraseStep')
    );
    expectInOrder(handler, [
      'if (!cfg.enabled && !canEnable)',
      'e.currentTarget.checked = false',
      'enableAttempted = true',
      'await tick()',
      '(missingPhraseButton ?? missingFolderButton)?.focus()',
      'return'
    ]);
  });

  it('lists the missing steps with their buttons right under the checkbox', () => {
    expectInOrder(page, [
      'onchange={onToggleChange}',
      '{#if enableAttempted}',
      'role="alert"',
      "{$t('settings_page.backup.enable_missing_title')}",
      '{#if !phraseSet}',
      'onclick={finishPhraseStep}',
      '{#if !cfg.folderBookmark}',
      'onclick={pickFolder}'
    ]);
  });

  it('numbers the three steps and marks the done ones', () => {
    expect(page).toContain('{@render stepBadge(1, phraseSet)}');
    expect(page).toContain('{@render stepBadge(2, !!cfg.folderBookmark)}');
    expect(page).toContain('{@render stepBadge(3, cfg.enabled)}');
  });
});
