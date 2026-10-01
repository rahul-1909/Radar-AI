/**
 * Lightweight Security Scanner — replaces OWASP ZAP
 * 
 * Performs REAL HTTP-based security checks using only Node.js built-ins.
 * No external daemon, no API keys, no Docker required.
 * 
 * Checks performed:
 *   1. SSL/TLS certificate validation & details
 *   2. Security headers (CSP, HSTS, X-Frame-Options, etc.)
 *   3. Cookie security flags (HttpOnly, Secure, SameSite)
 *   4. CORS misconfiguration
 *   5. Information disclosure (Server, X-Powered-By)
 *   6. Mixed content detection
 *   7. Open redirect susceptibility
 *   8. Clickjacking protection
 *   9. MIME sniffing protection
 *  10. Referrer policy
 */

const https = require('https');
const tls = require('tls');
const http = require('http');
const { URL } = require('url');

/**
 * Make an HTTP(S) request and return headers + body
 */
function fetchWithDetails(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const timeout = options.timeout || 10000;

    const req = client.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,  // We want to inspect even bad certs
      timeout,
    }, (res) => {
      let body = '';
      const chunks = [];
      res.on('data', chunk => {
        chunks.push(chunk);
        if (chunks.length < 50) body += chunk; // limit body capture
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body.substring(0, 50000),
          socket: res.socket,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

/**
 * Get SSL/TLS certificate details.
 * Uses a fresh TLS handshake every time — a pooled/resumed HTTPS connection
 * doesn't expose the certificate, which made this check fail on re-runs.
 */
function getCertificateDetails(url) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return resolve(null);
    }
    if (parsed.protocol !== 'https:') return resolve(null);

    const socket = tls.connect({
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 443,
      servername: parsed.hostname,
      rejectUnauthorized: false, // inspect bad certificates too
      timeout: 8000,
    }, () => {
      const cert = socket.getPeerCertificate();
      resolve(cert && cert.subject ? {
        subject: cert.subject,
        issuer: cert.issuer,
        valid_from: cert.valid_from,
        valid_to: cert.valid_to,
        fingerprint: cert.fingerprint,
        serialNumber: cert.serialNumber,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError || null,
      } : null);
      socket.end();
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

/**
 * Run lightweight security scan against a URL
 * Returns results in the same format as the old ZAP scanner
 */
async function runSecurityScan(url, siteAnalysis) {
  const results = [];
  let testId = 700;
  const id = () => `SEC-${String(testId++).padStart(3, '0')}`;
  const scanStart = Date.now();

  console.log(`[Security] Starting lightweight scan on ${url}...`);

  let response, cert;
  try {
    [response, cert] = await Promise.all([
      fetchWithDetails(url),
      getCertificateDetails(url),
    ]);
  } catch (err) {
    console.error('[Security] Fetch error:', err.message);
    results.push({
      id: id(), type: 'security', priority: 'critical', category: 'security-scan',
      title: 'Security Scan — Connection Failed',
      passed: false,
      expected: 'Site reachable for security testing',
      actual: `Error: ${err.message}`,
      explanation: `Could not connect to ${url} for security scanning: ${err.message}`,
      duration: Date.now() - scanStart,
    });
    return results;
  }

  const headers = response.headers || {};
  const body = response.body || '';
  const parsed = new URL(url);
  const isHTTPS = parsed.protocol === 'https:';

  // ── 1. SSL/TLS Certificate ──
  if (isHTTPS) {
    if (cert) {
      const validTo = new Date(cert.valid_to);
      const daysLeft = Math.floor((validTo - Date.now()) / 86400000);
      const isExpiringSoon = daysLeft < 30;
      const isExpired = daysLeft < 0;

      results.push({
        id: id(), type: 'security', priority: isExpired ? 'critical' : isExpiringSoon ? 'high' : 'low',
        category: 'security-scan',
        title: 'SSL Certificate Validity',
        passed: !isExpired && cert.authorized !== false,
        expected: 'Valid, trusted SSL certificate',
        actual: cert.authorized
          ? `Valid, expires in ${daysLeft} days (${cert.issuer?.O || 'Unknown CA'})`
          : `Certificate issue: ${isExpired ? 'EXPIRED' : 'Not trusted by CA'}`,
        explanation: cert.authorized
          ? `SSL certificate is valid and trusted. Issued by ${cert.issuer?.O || 'Unknown'}. Expires ${validTo.toLocaleDateString()}.`
          : `SSL certificate problem detected. ${isExpired ? 'The certificate has expired.' : 'Certificate is not trusted — may be self-signed.'}`,
        duration: 0,
      });
    } else {
      results.push({
        id: id(), type: 'security', priority: 'high', category: 'security-scan',
        title: 'SSL Certificate Validity',
        passed: false,
        expected: 'Valid SSL certificate',
        actual: 'Could not retrieve certificate details',
        explanation: 'Unable to inspect the SSL/TLS certificate. This may indicate a configuration issue.',
        duration: 0,
      });
    }
  } else {
    results.push({
      id: id(), type: 'security', priority: 'critical', category: 'security-scan',
      title: 'HTTPS Enforcement',
      passed: false,
      expected: 'Site served over HTTPS',
      actual: 'Site served over plain HTTP',
      explanation: 'The site does not use HTTPS. All data is transmitted in plaintext, making it vulnerable to interception and MITM attacks.',
      duration: 0,
    });
  }

  // ── 2. Content Security Policy (CSP) ──
  const csp = headers['content-security-policy'] || '';
  results.push({
    id: id(), type: 'security', priority: csp ? 'low' : 'high', category: 'security-scan',
    title: 'Content Security Policy (CSP)',
    passed: !!csp,
    expected: 'CSP header present to prevent XSS',
    actual: csp ? `CSP defined: ${csp.substring(0, 100)}${csp.length > 100 ? '...' : ''}` : 'No CSP header found',
    explanation: csp
      ? `Content Security Policy is configured, limiting script sources and mitigating XSS attacks.`
      : `No Content-Security-Policy header. The site is vulnerable to cross-site scripting (XSS) injection attacks. This is a primary defense mechanism.`,
    duration: 0,
  });

  // ── 3. Strict-Transport-Security (HSTS) ──
  const hsts = headers['strict-transport-security'] || '';
  results.push({
    id: id(), type: 'security', priority: hsts ? 'low' : 'high', category: 'security-scan',
    title: 'HTTP Strict Transport Security (HSTS)',
    passed: !!hsts,
    expected: 'HSTS header enforcing HTTPS',
    actual: hsts ? `HSTS: ${hsts}` : 'No HSTS header',
    explanation: hsts
      ? `HSTS is configured, forcing browsers to use HTTPS. ${hsts.includes('includeSubDomains') ? 'Includes subdomains.' : 'Consider adding includeSubDomains.'}`
      : `No Strict-Transport-Security header. Browsers may connect over insecure HTTP, enabling protocol downgrade attacks.`,
    duration: 0,
  });

  // ── 4. X-Frame-Options (Clickjacking) ──
  const xfo = headers['x-frame-options'] || '';
  const cspFrameAncestors = csp.includes('frame-ancestors');
  const clickjackProtected = !!xfo || cspFrameAncestors;
  results.push({
    id: id(), type: 'security', priority: clickjackProtected ? 'low' : 'medium', category: 'security-scan',
    title: 'Clickjacking Protection',
    passed: clickjackProtected,
    expected: 'X-Frame-Options or CSP frame-ancestors set',
    actual: xfo ? `X-Frame-Options: ${xfo}` : cspFrameAncestors ? 'CSP frame-ancestors configured' : 'No clickjacking protection',
    explanation: clickjackProtected
      ? `Clickjacking protection is in place via ${xfo ? 'X-Frame-Options' : 'CSP frame-ancestors'}.`
      : `No X-Frame-Options header or CSP frame-ancestors directive. The site can be embedded in iframes, enabling clickjacking attacks.`,
    duration: 0,
  });

  // ── 5. X-Content-Type-Options (MIME Sniffing) ──
  const xcto = headers['x-content-type-options'] || '';
  results.push({
    id: id(), type: 'security', priority: xcto ? 'low' : 'medium', category: 'security-scan',
    title: 'MIME Sniffing Protection',
    passed: xcto.toLowerCase().includes('nosniff'),
    expected: 'X-Content-Type-Options: nosniff',
    actual: xcto ? `X-Content-Type-Options: ${xcto}` : 'Header not set',
    explanation: xcto.includes('nosniff')
      ? `MIME type sniffing is blocked. Browsers will respect the declared Content-Type.`
      : `No X-Content-Type-Options header. Browsers may MIME-sniff responses, potentially executing malicious files as scripts.`,
    duration: 0,
  });

  // ── 6. Information Disclosure — Server Header ──
  const server = headers['server'] || '';
  const xPowered = headers['x-powered-by'] || '';
  const leaksInfo = !!(server && server.match(/\d/)) || !!xPowered;
  results.push({
    id: id(), type: 'security', priority: leaksInfo ? 'medium' : 'low', category: 'security-scan',
    title: 'Server Information Disclosure',
    passed: !leaksInfo,
    expected: 'No server version or technology stack exposed',
    actual: [
      server ? `Server: ${server}` : null,
      xPowered ? `X-Powered-By: ${xPowered}` : null,
      !server && !xPowered ? 'No server info disclosed' : null,
    ].filter(Boolean).join(' | '),
    explanation: leaksInfo
      ? `The server exposes technology details (${[server, xPowered].filter(Boolean).join(', ')}). Attackers can use this to target known vulnerabilities for specific software versions.`
      : `Server does not expose version or technology information. Good practice.`,
    duration: 0,
  });

  // ── 7. Cookie Security ──
  const setCookies = response.headers['set-cookie'];
  if (setCookies) {
    const cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
    const insecureCookies = cookies.filter(c => {
      const lower = c.toLowerCase();
      return !lower.includes('httponly') || !lower.includes('secure') || !lower.includes('samesite');
    });

    results.push({
      id: id(), type: 'security', priority: insecureCookies.length > 0 ? 'high' : 'low', category: 'security-scan',
      title: 'Cookie Security Flags',
      passed: insecureCookies.length === 0,
      expected: 'All cookies have HttpOnly, Secure, SameSite flags',
      actual: insecureCookies.length === 0
        ? `${cookies.length} cookie(s) — all properly secured`
        : `${insecureCookies.length}/${cookies.length} cookie(s) missing security flags`,
      explanation: insecureCookies.length === 0
        ? `All cookies have HttpOnly, Secure, and SameSite flags set.`
        : `${insecureCookies.length} cookie(s) are missing security flags. Missing HttpOnly allows XSS to steal cookies. Missing Secure allows transmission over HTTP. Missing SameSite enables CSRF.`,
      duration: 0,
    });
  }

  // ── 8. Permissions Policy ──
  const pp = headers['permissions-policy'] || headers['feature-policy'] || '';
  results.push({
    id: id(), type: 'security', priority: pp ? 'low' : 'medium', category: 'security-scan',
    title: 'Permissions Policy',
    passed: !!pp,
    expected: 'Permissions-Policy header restricting browser APIs',
    actual: pp ? `Policy: ${pp.substring(0, 100)}` : 'No Permissions-Policy header',
    explanation: pp
      ? `Browser API permissions are restricted via Permissions-Policy.`
      : `No Permissions-Policy header. Third-party iframes can access camera, microphone, geolocation, and other sensitive APIs without restriction.`,
    duration: 0,
  });

  // ── 9. Referrer Policy ──
  const rp = headers['referrer-policy'] || '';
  results.push({
    id: id(), type: 'security', priority: rp ? 'low' : 'low', category: 'security-scan',
    title: 'Referrer Policy',
    passed: !!rp,
    expected: 'Referrer-Policy header set',
    actual: rp ? `Referrer-Policy: ${rp}` : 'No Referrer-Policy header',
    explanation: rp
      ? `Referrer-Policy is set to "${rp}", controlling how much URL information is shared with third parties.`
      : `No Referrer-Policy header. Full URLs (including query parameters with potential sensitive data) may be leaked to external sites via the Referer header.`,
    duration: 0,
  });

  // ── 10. CORS Configuration ──
  const corsOrigin = headers['access-control-allow-origin'] || '';
  const corsWildcard = corsOrigin === '*';
  const corsCreds = headers['access-control-allow-credentials'] === 'true';
  const corsDangerous = corsWildcard && corsCreds;
  results.push({
    id: id(), type: 'security', priority: corsDangerous ? 'critical' : corsWildcard ? 'medium' : 'low',
    category: 'security-scan',
    title: 'CORS Configuration',
    passed: !corsDangerous,
    expected: 'CORS not dangerously misconfigured',
    actual: corsOrigin
      ? `Access-Control-Allow-Origin: ${corsOrigin}${corsCreds ? ' (with credentials)' : ''}`
      : 'No CORS headers (same-origin only)',
    explanation: corsDangerous
      ? `CRITICAL: CORS allows any origin with credentials. This enables any website to make authenticated requests on behalf of users.`
      : corsWildcard
        ? `CORS allows any origin (*). While not critical without credentials, consider restricting to specific domains.`
        : corsOrigin
          ? `CORS is configured for specific origin(s): ${corsOrigin}`
          : `No CORS headers present — the site operates under same-origin policy (default secure).`,
    duration: 0,
  });

  // ── 11. Mixed Content Detection ──
  const httpResources = body.match(/http:\/\/[^"'\s]+\.(js|css|jpg|png|gif|svg|woff|woff2|ttf|eot)/gi) || [];
  const uniqueHttpResources = [...new Set(httpResources)];
  if (isHTTPS) {
    results.push({
      id: id(), type: 'security', priority: uniqueHttpResources.length > 0 ? 'high' : 'low',
      category: 'security-scan',
      title: 'Mixed Content',
      passed: uniqueHttpResources.length === 0,
      expected: 'No HTTP resources loaded on HTTPS page',
      actual: uniqueHttpResources.length === 0
        ? 'No mixed content detected'
        : `${uniqueHttpResources.length} HTTP resource(s) found on HTTPS page`,
      explanation: uniqueHttpResources.length === 0
        ? `No insecure HTTP resources detected on the HTTPS page. All resources use encrypted connections.`
        : `${uniqueHttpResources.length} resource(s) loaded over plain HTTP: ${uniqueHttpResources.slice(0, 3).join(', ')}${uniqueHttpResources.length > 3 ? '...' : ''}. Browsers may block these or show security warnings.`,
      duration: 0,
    });
  }

  // ── 12. Open Redirect Check ──
  try {
    const redirectUrl = `${url}${url.includes('?') ? '&' : '?'}redirect=https://evil.com&url=https://evil.com&next=https://evil.com`;
    const redirectResp = await fetchWithDetails(redirectUrl, { timeout: 5000 });
    const redirectedToEvil = (redirectResp.headers.location || '').includes('evil.com');
    results.push({
      id: id(), type: 'security', priority: redirectedToEvil ? 'high' : 'low', category: 'security-scan',
      title: 'Open Redirect',
      passed: !redirectedToEvil,
      expected: 'No open redirect vulnerability',
      actual: redirectedToEvil ? 'Site redirects to arbitrary external URLs' : 'No open redirect detected',
      explanation: redirectedToEvil
        ? `The site accepts URL parameters that redirect users to arbitrary external domains. Attackers can use this for phishing.`
        : `No open redirect vulnerability detected from URL parameter injection.`,
      duration: 0,
    });
  } catch {
    // Skip this check on error
  }

  // ── 13. Security Headers Summary Score ──
  const headerChecks = {
    'Content-Security-Policy': !!csp,
    'Strict-Transport-Security': !!hsts,
    'X-Frame-Options': !!xfo || cspFrameAncestors,
    'X-Content-Type-Options': xcto.includes('nosniff'),
    'Permissions-Policy': !!pp,
    'Referrer-Policy': !!rp,
  };
  const headersPassed = Object.values(headerChecks).filter(Boolean).length;
  const headersTotal = Object.keys(headerChecks).length;
  const headerScore = Math.round((headersPassed / headersTotal) * 100);

  results.push({
    id: id(), type: 'security', priority: headerScore >= 80 ? 'low' : headerScore >= 50 ? 'medium' : 'high',
    category: 'security-scan',
    title: 'Security Headers Score',
    passed: headerScore >= 50,
    expected: 'At least 50% of security headers configured',
    actual: `${headersPassed}/${headersTotal} headers present (${headerScore}%)`,
    explanation: `Security headers scorecard: ${Object.entries(headerChecks).map(([k, v]) => `${v ? '✓' : '✗'} ${k}`).join(', ')}. ${headerScore >= 80 ? 'Excellent header configuration.' : headerScore >= 50 ? 'Some important headers are missing.' : 'Most security headers are missing — significant risk.'}`,
    duration: 0,
  });

  const scanDuration = Date.now() - scanStart;
  console.log(`[Security] ✓ Completed ${results.length} security checks in ${scanDuration}ms`);

  // Tag all results with scan duration
  if (results.length > 0) {
    results[results.length - 1].duration = scanDuration;
  }

  return results;
}

module.exports = { runSecurityScan };
