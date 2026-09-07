/**
 * Open a URL in a new tab only if it uses a safe protocol.
 * Blocks javascript:, data:, and other dangerous schemes.
 */
export function safeOpen(url: string | undefined | null): void {
  if (!url) return
  try {
    const parsed = new URL(url, window.location.origin)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } catch {
    // malformed URL — do not open
  }
}
