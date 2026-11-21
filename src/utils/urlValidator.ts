export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  url?: string;
  normalizedUrl?: string;
  domain?: string;
  isHttps?: boolean;
}

const DANGEROUS_EXTENSIONS = [
  '.exe',
  '.apk',
  '.msi',
  '.bat',
  '.cmd',
  '.scr',
  '.ps1',
  '.vbs',
  '.jar',
  '.sh',
  '.dmg',
  '.iso',
  '.dll',
  '.sys',
];

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }

  // IPv4 literal check
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    // Block raw IPv4 host submissions for safety
    return true;
  }

  // Block raw IPv6 addresses
  if (host.includes(':')) {
    return true;
  }

  return false;
}

export function validateAndNormalizeUrl(rawInput: string): UrlValidationResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, error: 'Please enter a valid URL.' };
  }

  if (/\s/.test(trimmed)) {
    return { valid: false, error: 'URL cannot contain spaces or line breaks.' };
  }

  if (trimmed.length > 500) {
    return { valid: false, error: 'URL cannot exceed 500 characters.' };
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:') ||
    lower.startsWith('blob:') ||
    lower.startsWith('about:') ||
    lower.startsWith('ftp:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:')
  ) {
    return {
      valid: false,
      error: 'Blocked unsafe URL scheme. Only HTTPS (or HTTP) web links are allowed.',
    };
  }

  if (
    lower.includes('<script') ||
    lower.includes('%00') ||
    lower.includes('\u0000')
  ) {
    return {
      valid: false,
      error: 'Suspicious payload detected in URL.',
    };
  }

  // Default bare domains to https:// to prioritize HTTPS
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, error: 'Invalid URL format. Example: https://example.com' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      valid: false,
      error: 'Only HTTPS and HTTP web links are permitted.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: 'URLs containing embedded credentials (@) are blocked for phishing protection.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname.length < 3 || hostname.length > 120) {
    return { valid: false, error: 'Invalid destination domain.' };
  }

  if (isPrivateOrLocalHost(hostname)) {
    return {
      valid: false,
      error: 'Localhost, private network, and raw IP URLs are not permitted.',
    };
  }

  const labels = hostname.split('.');
  if (labels.length < 2 || labels.length > 5) {
    return { valid: false, error: 'Please provide a valid public domain name.' };
  }

  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld) && !tld.startsWith('xn--')) {
    return { valid: false, error: 'Invalid top-level domain.' };
  }

  if (hostname.includes('xn--')) {
    return {
      valid: false,
      error: 'Punycode/IDN homograph domains are blocked for safety.',
    };
  }

  const lowerPath = parsed.pathname.toLowerCase();
  if (DANGEROUS_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
    return {
      valid: false,
      error: 'Direct executable or installer file links are blocked for user safety.',
    };
  }

  const isHttps = parsed.protocol === 'https:';
  const cleanHost = hostname.replace(/^www\./, '');

  // Build canonical normalized URL for duplicate detection
  const canonicalUrl = new URL(parsed.toString());
  canonicalUrl.protocol = 'https:'; // Treat http://example.com and https://example.com as same destination for duplicate detection
  canonicalUrl.hostname = cleanHost;
  canonicalUrl.hash = '';
  if (canonicalUrl.pathname.length > 1 && canonicalUrl.pathname.endsWith('/')) {
    canonicalUrl.pathname = canonicalUrl.pathname.slice(0, -1);
  }
  const filteredParams = Array.from(canonicalUrl.searchParams.entries())
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  canonicalUrl.search = '';
  for (const [k, v] of filteredParams) {
    canonicalUrl.searchParams.append(k, v);
  }

  const finalUrl = parsed.toString();
  const normalizedUrl = canonicalUrl.toString();

  if (finalUrl.length > 500 || normalizedUrl.length > 500) {
    return { valid: false, error: 'URL exceeds maximum allowed length (500 chars).' };
  }

  return {
    valid: true,
    url: finalUrl,
    normalizedUrl,
    domain: cleanHost,
    isHttps,
    warning: isHttps
      ? undefined
      : 'HTTPS is strongly recommended and prioritized. Consider upgrading http:// to https://.',
  };
}

export async function computeUrlKey(normalizedUrl: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(normalizedUrl);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `lk_${hex.slice(0, 44)}`;
  }

  // Deterministic ASCII fallback
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < normalizedUrl.length; i++) {
    const ch = normalizedUrl.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `lk_${part1}${part2}_${normalizedUrl.length}`;
}
