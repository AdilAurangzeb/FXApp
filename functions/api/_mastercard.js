// NOTE: currently unused (Mastercard disabled; see rates.js). Kept for later re-enabling.
// Mastercard OAuth 1.0a (RSA-SHA256) request signing using WebCrypto.
// Needs the signing key as an UNENCRYPTED PKCS#8 PEM ("BEGIN PRIVATE KEY").

const pct = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

function pemToDer(pem) {
  if (/BEGIN RSA PRIVATE KEY/.test(pem)) {
    throw new Error('Key is PKCS#1; convert to PKCS#8 with openssl pkcs8 -topk8 -nocrypt');
  }
  if (/ENCRYPTED/.test(pem)) throw new Error('Key is password-protected; remove the password first');
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export async function mastercardAuthHeader({ url, method = 'GET', consumerKey, privateKeyPem }) {
  const u = new URL(url);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Empty body (GET): body hash is the SHA-256 of an empty string.
  const bodyHash = b64(await crypto.subtle.digest('SHA-256', new Uint8Array(0)));
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'RSA-SHA256',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    oauth_body_hash: bodyHash,
  };

  // RFC 5849 signature base string: METHOD & enc(base URL) & enc(sorted params)
  const params = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [pct(k), pct(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const normalized = params.map(([k, v]) => `${k}=${v}`).join('&');
  const base = `${method.toUpperCase()}&${pct(u.origin + u.pathname)}&${pct(normalized)}`;

  const sig = b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(base)));
  const all = { ...oauth, oauth_signature: sig };
  return 'OAuth ' + Object.entries(all).map(([k, v]) => `${k}="${pct(v)}"`).join(',');
}
