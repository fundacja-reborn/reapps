// Type declarations for check-rtl-direction.mjs, so the TypeScript specs that
// import it (rtl / source guards in reborn-notes, reborn-task, @reborn/ui)
// typecheck without svelte-check type-checking the plain JS script itself.

export interface RtlViolation {
  /** Path relative to the repo root (from scanPaths) - absent from scanText. */
  file?: string;
  line: number;
  rule: string;
  match: string;
  hint: string;
}

export const DEFAULT_ROOTS: string[];

export function scanText(
  text: string,
  ext: string,
  opts?: { fix?: boolean }
): { violations: RtlViolation[]; text: string };

export function listSourceFiles(roots?: string[]): string[];

export function repoRelative(file: string): string;

export function scanPaths(roots?: string[], opts?: { fix?: boolean }): RtlViolation[];

export function formatViolations(violations: RtlViolation[]): string;
