import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { formatViolations, scanText } from '../../../../../scripts/check-rtl-direction.mjs';

/**
 * PDF export of RTL notes (smoke of PR #485, 2026-11-04). The PDF pipeline
 * (marked -> DOMPurify -> off-screen DOM -> html2canvas-pro) has its own
 * stylesheet and container, so it must apply the same direction rules as the
 * preview - otherwise code came out right-to-left, English paragraphs
 * right-aligned, list markers at the far left page edge and the quote border
 * on the wrong side. html2canvas paints from computed (physical) values, which
 * the browser resolves from the logical properties per block direction.
 *
 * Source-level guards (the repo's regression idiom): the export needs a real
 * layout engine, which the node test environment does not have.
 */
const source = readFileSync(resolve(__dirname, './export-import.service.ts'), 'utf-8');

function pdfStyles(): string {
  const match = source.match(/const PDF_STYLES = `([\s\S]*?)`\.trim\(\);/);
  if (!match) throw new Error('PDF_STYLES template literal not found');
  return match[1];
}

describe('PDF export - RTL (2026-11-04)', () => {
  it('PDF_STYLES uses logical direction properties only', () => {
    expect(formatViolations(scanText(pdfStyles(), '.css').violations)).toBe('');
  });

  it('pins code blocks to LTR', () => {
    expect(pdfStyles()).toMatch(/\.reborn-pdf-root pre \{[^}]*direction: ltr;/);
  });

  it('marks blocks dir="auto" like the preview', () => {
    expect(source).toMatch(/applyBlockDirection\(\s*DOMPurify\.sanitize\(rawHtml/);
  });

  it('takes the container direction from the note text, not from the UI', () => {
    expect(source).toMatch(
      /container\.dir = detectTextDirection\(bodyEl\.textContent \?\? ''\) \?\? 'ltr';/
    );
  });
});
