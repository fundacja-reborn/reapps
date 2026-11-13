import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { getDrawSelectionConfig } from '@codemirror/view';
import { ownSelection } from './own-selection';

const blinkRate = (extension: ReturnType<typeof ownSelection>) =>
  getDrawSelectionConfig(EditorState.create({ extensions: extension })).cursorBlinkRate;

describe('ownSelection', () => {
  it('leaves the cursor and selection to the browser on a coarse pointer', () => {
    // Phones, tablets and the native shells: the native caret, magnifier and
    // selection handles must stay. An empty extension is the whole contract.
    expect(ownSelection({ finePointer: false, reducedMotion: false })).toEqual([]);
    expect(ownSelection({ finePointer: false, reducedMotion: true })).toEqual([]);
  });

  it('draws them on a fine pointer, blinking at the default rate', () => {
    const extension = ownSelection({ finePointer: true, reducedMotion: false });
    expect(extension).not.toEqual([]);
    expect(blinkRate(extension)).toBe(1200);
  });

  it('keeps the drawn cursor steady when the system asks for reduced motion', () => {
    expect(blinkRate(ownSelection({ finePointer: true, reducedMotion: true }))).toBe(0);
  });
});
