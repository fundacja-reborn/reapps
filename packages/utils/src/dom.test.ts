// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isTextEntryTarget } from './dom';

describe('isTextEntryTarget', () => {
  function el(html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
  }

  it.each([
    ['a text input', '<input />'],
    ['a search input', '<input type="search" />'],
    ['a textarea', '<textarea></textarea>']
  ])('is true for %s', (_label, html) => {
    expect(isTextEntryTarget(el(html))).toBe(true);
  });

  it.each([
    ['a button', '<button type="button"></button>'],
    ['a checkbox', '<input type="checkbox" />'],
    ['a plain element', '<div></div>']
  ])('is false for %s', (_label, html) => {
    expect(isTextEntryTarget(el(html))).toBe(false);
  });

  it('is false for no target', () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
