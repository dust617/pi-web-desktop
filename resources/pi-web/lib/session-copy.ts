export interface CopyableSession {
  id: string;
  path: string;
}

/**
 * Clipboard text for a session row. Keep this independent from the sidebar so
 * upgrades can retain the user-facing format without copying UI internals.
 */
export function formatSessionCopyDetails(session: CopyableSession): string {
  return `Session ID: ${session.id}\nSession file: ${session.path}`;
}
