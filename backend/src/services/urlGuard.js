/**
 * URL Guard — SSRF Protection
 *
 * When hosted publicly, anyone can ask the server to crawl a URL. Without a
 * check, that could be used to reach the host's private network or cloud
 * metadata endpoints (e.g. 169.254.169.254). This rejects anything that isn't
 * plain http(s) to a public address.
 *
 * Set ALLOW_PRIVATE_URLS=true to test local sites (e.g. when running locally).
 */

const dns = require('dns').promises;
const net = require('net');

class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || a >= 224; // multicast / reserved
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateIPv4(lower.slice(7));
  return lower === '::1'
    || lower === '::'
    || lower.startsWith('fc') || lower.startsWith('fd') // unique local
    || lower.startsWith('fe80'); // link-local
}

/**
 * Normalize a user-supplied website URL (adds https:// if missing).
 */
function normalizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  // Keep any explicit scheme (so e.g. file:// is rejected, not rewritten)
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^:]+:\d/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Throws UnsafeUrlError unless `url` is http(s) and resolves to public IPs.
 * Returns the normalized URL.
 */
async function assertPublicUrl(url) {
  const normalized = normalizeUrl(url);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new UnsafeUrlError('Invalid URL. Expected something like https://example.com');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UnsafeUrlError('Only http:// and https:// URLs are supported.');
  }
  if (process.env.ALLOW_PRIVATE_URLS === 'true') return normalized;

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UnsafeUrlError('Local and internal addresses cannot be tested from the hosted app.');
  }

  let addresses;
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map(a => a.address);
    } catch {
      throw new UnsafeUrlError(`Could not resolve host "${host}". Check the URL.`);
    }
  }
  if (addresses.some(isPrivateIP)) {
    throw new UnsafeUrlError('Local and internal addresses cannot be tested from the hosted app.');
  }
  return normalized;
}

module.exports = { assertPublicUrl, normalizeUrl };
