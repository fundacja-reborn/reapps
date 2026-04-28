/**
 * Lazy-loaded language descriptors for fenced code blocks in Live Preview.
 *
 * Each entry maps an info-string alias (e.g. "js", "python") to a CM6
 * `LanguageSupport` loaded on-demand via Vite chunk splitting. All chunks
 * are emitted statically — nothing is fetched from third-party origins, so
 * the editor stays compatible with our offline / Zero-Knowledge model.
 *
 * Two roles:
 *  1. Passed to `markdown({ codeLanguages })` so the parser nests the right
 *     sub-language inside ```fenced blocks``` while the cursor is inside.
 *  2. Looked up by `CodeBlockWidget` to highlight the rendered <pre><code>
 *     when the cursor is outside the block.
 */
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage
} from '@codemirror/language';

export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'ts', 'tsx', 'typescript'],
    extensions: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'],
    load: async () => {
      const { javascript } = await import('@codemirror/lang-javascript');
      return javascript({ jsx: true, typescript: true });
    }
  }),
  LanguageDescription.of({
    name: 'html',
    alias: ['htm', 'xhtml'],
    extensions: ['html', 'htm', 'xhtml'],
    load: async () => {
      const { html } = await import('@codemirror/lang-html');
      return html();
    }
  }),
  LanguageDescription.of({
    name: 'css',
    alias: [],
    extensions: ['css'],
    load: async () => {
      const { css } = await import('@codemirror/lang-css');
      return css();
    }
  }),
  LanguageDescription.of({
    name: 'json',
    alias: [],
    extensions: ['json'],
    load: async () => {
      const { json } = await import('@codemirror/lang-json');
      return json();
    }
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py'],
    extensions: ['py'],
    load: async () => {
      const { python } = await import('@codemirror/lang-python');
      return python();
    }
  }),
  LanguageDescription.of({
    name: 'sql',
    alias: ['mysql', 'postgresql', 'postgres', 'sqlite'],
    extensions: ['sql'],
    load: async () => {
      const { sql } = await import('@codemirror/lang-sql');
      return sql();
    }
  }),
  LanguageDescription.of({
    name: 'rust',
    alias: ['rs'],
    extensions: ['rs'],
    load: async () => {
      const { rust } = await import('@codemirror/lang-rust');
      return rust();
    }
  }),
  LanguageDescription.of({
    name: 'yaml',
    alias: ['yml'],
    extensions: ['yml', 'yaml'],
    load: async () => {
      const { yaml } = await import('@codemirror/lang-yaml');
      return yaml();
    }
  }),
  LanguageDescription.of({
    name: 'shell',
    alias: ['sh', 'bash', 'zsh'],
    extensions: ['sh', 'bash', 'zsh'],
    load: async () => {
      const { shell } = await import('@codemirror/legacy-modes/mode/shell');
      return new LanguageSupport(StreamLanguage.define(shell));
    }
  })
];

/**
 * Find a language descriptor by info-string (e.g. "js", "python", "TS").
 * Returns `null` for unknown / empty strings.
 */
export function matchLanguage(info: string): LanguageDescription | null {
  const trimmed = info.trim();
  if (!trimmed) return null;
  return LanguageDescription.matchLanguageName(codeLanguages, trimmed, false);
}

/**
 * Synchronous accessor — only resolves to a `LanguageSupport` if the
 * descriptor's `load()` has already completed in this session. Used by the
 * widget to render highlighted output without blocking on async imports.
 */
export function getLoadedLanguage(info: string): LanguageSupport | null {
  const desc = matchLanguage(info);
  return desc?.support ?? null;
}
