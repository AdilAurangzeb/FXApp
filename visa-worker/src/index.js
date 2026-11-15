// Cloudflare Worker: calls the official Visa Foreign Exchange Rates API using
// two-way (mutual) SSL + Basic auth. Private: only reachable through the
// Service binding from the Pages project (workers_dev = false).
//
// GET /?from=GBP&to=EGP  ->  { "rate": <number> }
//
// Secrets (never commit): VISA_USER_ID, VISA_PASSWORD
// Vars (wrangler.toml):   VISA_BASE, VISA_RATE_PRODUCT, VISA_BIN
// Binding:                VISA_CERT (mTLS cert + private key uploaded via wrangler)

const NUMERIC = { GBP: '826', USD: '840', EUR: '978', PKR: '586', EGP: '818' };

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const from = (u.searchParams.get('from') || '').toUpperCase();
    const to = (u.searchParams.get('to') || '').toUpperCase();
    if (!NUMERIC[from] || !NUMERIC[to]) return Response.json({ error: 'bad currency' }, { status: 400 });

    const product = env.VISA_RATE_PRODUCT || 'A';
    const body =
      product === 'A' || product === 'B'
        ? {
            // A/B shape (numeric ISO 4217 codes). Needs your acquiring BIN.
            markupRate: 0,
            sourceAmount: '1',
            acquirerDetails: { bin: Number(env.VISA_BIN), settlement: { currencyCode: NUMERIC[to] } },
            rateProductCode: product,
            transactionType: 'PUSH',
            sourceCurrencyCode: NUMERIC[from],
            destinationCurrencyCode: NUMERIC[to],
          }
        : {
            // BANK / WALLET shape (3-letter codes). Needs your initiating party id.
            quoteIdRequired: false,
            rateProductCode: product,
            initiatingPartyId: Number(env.VISA_BIN),
            sourceCurrencyCode: from,
            destinationCurrencyCode: to,
            sourceAmount: 1,
          };

    const res = await env.VISA_CERT.fetch(`${env.VISA_BASE || 'https://api.visa.com'}/forexrates/v2/foreignexchangerates`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Basic ' + btoa(`${env.VISA_USER_ID}:${env.VISA_PASSWORD}`),
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) return Response.json({ error: 'visa', status: res.status, detail: text.slice(0, 500) }, { status: 502 });
    const d = JSON.parse(text);
    const rate = parseFloat(d.conversionRate ?? d?.acquirerDetails?.settlement?.conversionRate);
    if (!(rate > 0)) return Response.json({ error: 'no rate in response', detail: text.slice(0, 500) }, { status: 502 });
    return Response.json({ rate });
  },
};
