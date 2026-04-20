/**
 * Parse a User-Agent string into a short, human-readable label.
 *
 * Returns e.g. "Chrome · Android", "Safari · iOS", "Firefox · Windows".
 * Used client-side before encrypting — only the short label is stored on the server,
 * not the full UA string (ZK: less fingerprinting surface).
 */
export function parseUserAgent(ua?: string | null): string {
  if (!ua) return 'Unknown';

  let browser = '';
  let os = '';

  // Browser detection (order matters: Edge contains "Chrome", Chrome contains "Safari")
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome') && !ua.includes('Edg/')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else browser = '';

  // OS detection
  if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else os = '';

  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;
  return 'Unknown';
}
