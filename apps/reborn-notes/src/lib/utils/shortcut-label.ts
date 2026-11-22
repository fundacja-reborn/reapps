/**
 * Keyboard shortcuts as the device writes them: Cmd on Apple systems, Ctrl
 * elsewhere.
 */

/**
 * Whether shortcuts on this device use the Cmd key. iPadOS Safari reports a Mac
 * user agent, which is right here too: an iPad keyboard has Cmd.
 */
export function usesCommandKey(
  nav: Pick<Navigator, 'userAgent'> | undefined = globalThis.navigator
): boolean {
  return /Mac|iPhone|iPad|iPod/.test(nav?.userAgent ?? '');
}

/** A Cmd/Ctrl + key shortcut as shown in the interface: "⌘K" or "Ctrl+K". */
export function modShortcut(key: string, command: boolean): string {
  return command ? `⌘${key}` : `Ctrl+${key}`;
}
