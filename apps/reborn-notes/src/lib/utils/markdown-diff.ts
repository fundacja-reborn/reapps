import { diffLines, diffWords } from 'diff';

export interface DiffWord {
  value: string;
  added: boolean;
  removed: boolean;
}

export interface DiffLine {
  value: string;
  status: 'added' | 'removed' | 'unchanged';
  words?: DiffWord[];
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

/**
 * Compute a line-level diff between old and new text.
 * For changed lines, also computes word-level diff for finer highlighting.
 * Direction: old (base version) → new (current note).
 * Green = added since that version, Red = removed since that version.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const changes = diffLines(oldText, newText);
  const result: DiffLine[] = [];

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    const lines = change.value.replace(/\n$/, '').split('\n');

    if (change.added) {
      // Check if previous change was a removal (paired change = modification)
      const prev = i > 0 ? changes[i - 1] : null;
      const isPaired = prev?.removed;

      if (isPaired) {
        // Word-level diff for modified lines
        const oldLines = prev!.value.replace(/\n$/, '').split('\n');
        const oldBlock = oldLines.join('\n');
        const newBlock = lines.join('\n');
        const wordChanges = diffWords(oldBlock, newBlock);

        // Map word changes to removed lines
        const removedWords: DiffWord[] = wordChanges
          .filter((w) => !w.added)
          .map((w) => ({ value: w.value, added: false, removed: !!w.removed }));

        // Map word changes to added lines
        const addedWords: DiffWord[] = wordChanges
          .filter((w) => !w.removed)
          .map((w) => ({ value: w.value, added: !!w.added, removed: false }));

        // Update previously added removed lines with word info
        // Find the removed lines we already pushed and add word info
        const removedStart = result.length - oldLines.length;
        if (removedStart >= 0) {
          // Distribute word changes across removed lines
          assignWordsToLines(result, removedStart, oldLines.length, removedWords);
        }

        // Push added lines with word info
        for (const line of lines) {
          result.push({ value: line, status: 'added', words: [] });
        }
        assignWordsToLines(result, result.length - lines.length, lines.length, addedWords);
      } else {
        for (const line of lines) {
          result.push({ value: line, status: 'added' });
        }
      }
    } else if (change.removed) {
      for (const line of lines) {
        result.push({ value: line, status: 'removed' });
      }
    } else {
      for (const line of lines) {
        result.push({ value: line, status: 'unchanged' });
      }
    }
  }

  return result;
}

/** Distribute word-level diff tokens across multiple lines. */
function assignWordsToLines(
  result: DiffLine[],
  startIdx: number,
  lineCount: number,
  words: DiffWord[]
): void {
  // Flatten words into character stream, then split by newlines to assign to lines
  let lineIdx = 0;
  const lineWords: DiffWord[][] = Array.from({ length: lineCount }, () => []);

  for (const word of words) {
    const parts = word.value.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) lineIdx++;
      if (lineIdx >= lineCount) break;
      if (parts[p].length > 0) {
        lineWords[lineIdx].push({
          value: parts[p],
          added: word.added,
          removed: word.removed
        });
      }
    }
  }

  for (let i = 0; i < lineCount && startIdx + i < result.length; i++) {
    if (lineWords[i].length > 0) {
      result[startIdx + i].words = lineWords[i];
    }
  }
}

export function computeDiffStats(lines: DiffLine[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.status === 'added') additions++;
    if (line.status === 'removed') deletions++;
  }
  return { additions, deletions };
}
