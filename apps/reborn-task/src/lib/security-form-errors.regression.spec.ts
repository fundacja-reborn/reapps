import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The security settings forms show each error next to what the user acted on
// (guideline 02, "Komunikaty błędów w formularzach"): a field's error under the
// field, an action's error right above its buttons, and at the top of the page
// only an error nobody clicked for (a failed load). Before, every error went to
// one banner at the top - out of view on a phone, so "Turn off 2FA" with an
// empty password looked like a button that did nothing - and some of them were
// the server's English text or English hardcoded in the page.

// __dirname, not import.meta.url: this app's tests run in a DOM environment,
// where import.meta.url is not a file: URL.
const read = (page: string) =>
	readFileSync(resolve(__dirname, `../routes/settings/security/${page}/+page.svelte`), 'utf-8');

const PAGES = ['two-factor', 'password', 'delete-account', 'passcode', 'recovery-codes'];

/** The markup from `start` to the end of the form it is in. */
function formFrom(source: string, start: string): string {
	const from = source.indexOf(start);
	expect(from, start).toBeGreaterThan(-1);
	return source.slice(from, source.indexOf('</form>', from));
}

/** Each of `marks` must be in `text`, after the one before. */
function expectInOrder(text: string, marks: string[]): void {
	let last = -1;
	for (const mark of marks) {
		const at = text.indexOf(mark, last + 1);
		expect(at, mark).toBeGreaterThan(last);
		last = at;
	}
}

/** Error blocks rendered between the page title and the first card. */
function topErrors(source: string): string[] {
	const top = source.slice(source.indexOf('<SettingsLayout'), source.indexOf('<Card'));
	return [...top.matchAll(/\{#if (\w*[eE]rror)\}/g)].map((m) => m[1]);
}

describe('security form errors', () => {
	it.each(PAGES)("%s never shows the server's own error text", (page) => {
		expect(read(page)).not.toMatch(/data\.error\s*(\|\||\?\?)/);
	});

	it.each(PAGES)('%s has no error text hardcoded in the page', (page) => {
		expect(read(page)).not.toMatch(/\b\w*[eE]rror\s*=\s*['"`]/);
	});

	it('2FA: only the status load error at the top', () => {
		expect(topErrors(read('two-factor'))).toEqual(['statusError']);
	});

	it('2FA: setup error above the enable button', () => {
		const page = read('two-factor');
		const card = page.slice(
			page.indexOf("{:else if step === 'status'}"),
			page.indexOf("{:else if step === 'setup'}")
		);
		expectInOrder(card, ['{#if setupError}', 'onclick={startSetup}']);
	});

	it('2FA: code error under the code, action error above the buttons', () => {
		expectInOrder(formFrom(read('two-factor'), 'verifyAndEnable();'), [
			'id="verification-code"',
			'{#if codeError}',
			'{#if verifyError}',
			'type="submit"'
		]);
	});

	it('2FA: password error under the password, action error above the buttons', () => {
		expectInOrder(formFrom(read('two-factor'), 'disable2FA();'), [
			'id="disable-password"',
			'{#if disablePasswordError}',
			'{#if disableError}',
			'type="submit"'
		]);
	});

	it('2FA: an empty password is "Required", like the other forms', () => {
		expect(read('two-factor')).toMatch(
			/if \(!disablePassword\) return \$t\('auth\.validation\.required'\)/
		);
	});

	it('change password: wrong current password under its field, other errors above the button', () => {
		const page = read('password');
		expect(topErrors(page)).toEqual([]);
		expectInOrder(formFrom(page, '<form'), [
			'id="current-password"',
			'{#if currentPasswordError}',
			'{#if submitError}',
			'type="submit"'
		]);
	});

	it('delete account: wrong password under the field, other errors above the button', () => {
		const page = read('delete-account');
		expect(topErrors(page)).toEqual([]);
		expectInOrder(formFrom(page, '<form'), [
			'id="confirm-password"',
			'{#if passwordError}',
			'{#if submitError}',
			'type="submit"'
		]);
	});

	it('passcode: wrong current passcode under its field, a failed save above the button', () => {
		const page = read('passcode');
		expect(topErrors(page)).toEqual([]);
		expectInOrder(formFrom(page, '<form'), [
			'id="current-passcode"',
			'{#if currentError}',
			'{#if saveError}',
			'type="submit"'
		]);
	});

	it('recovery codes: a failed load at the top, a failed generate above its button', () => {
		const page = read('recovery-codes');
		expect(topErrors(page)).toEqual(['loadError']);
		expectInOrder(page, ['{#if generateError}', 'onclick={generateCodes}']);
	});
});
