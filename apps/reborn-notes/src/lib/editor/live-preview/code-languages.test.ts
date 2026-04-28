import { describe, it, expect } from 'vitest';
import { codeLanguages, getLoadedLanguage, matchLanguage } from './code-languages';

describe('codeLanguages', () => {
  it('lists each supported language with at least one alias', () => {
    expect(codeLanguages.length).toBeGreaterThan(0);
    for (const desc of codeLanguages) {
      expect(desc.name).toBeTruthy();
      // `alias` always contains the lowercased name plus extras
      expect(desc.alias.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('does not contain duplicate language names', () => {
    const names = codeLanguages.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('matchLanguage', () => {
  it.each([
    ['javascript', 'javascript'],
    ['js', 'javascript'],
    ['ts', 'javascript'],
    ['typescript', 'javascript'],
    ['JS', 'javascript'],
    ['TypeScript', 'javascript'],
    ['python', 'python'],
    ['py', 'python'],
    ['html', 'html'],
    ['css', 'css'],
    ['json', 'json'],
    ['sql', 'sql'],
    ['rust', 'rust'],
    ['rs', 'rust'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
    ['shell', 'shell'],
    ['sh', 'shell'],
    ['bash', 'shell'],
    ['zsh', 'shell'],
    ['svelte', 'svelte'],
    ['Svelte', 'svelte']
  ])('matches %s → %s', (info, expected) => {
    expect(matchLanguage(info)?.name).toBe(expected);
  });

  it.each([[''], ['   '], ['unknownlang'], ['cobol'], ['🎉']])(
    'returns null for %s',
    (info) => {
      expect(matchLanguage(info)).toBeNull();
    }
  );

  it('trims surrounding whitespace', () => {
    expect(matchLanguage('  js  ')?.name).toBe('javascript');
  });
});

describe('getLoadedLanguage', () => {
  it('returns null for languages that have not been loaded yet', () => {
    // A fresh test environment never preloads any descriptor — `support`
    // remains undefined until `desc.load()` resolves.
    expect(getLoadedLanguage('js')).toBeNull();
    expect(getLoadedLanguage('python')).toBeNull();
  });

  it('returns null for unknown info strings', () => {
    expect(getLoadedLanguage('unknownlang')).toBeNull();
    expect(getLoadedLanguage('')).toBeNull();
  });
});
