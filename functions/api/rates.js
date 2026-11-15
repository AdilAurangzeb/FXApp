// Cloudflare Pages Function: GET /api/rates?from=GBP&to=EGP
// Returns per-unit rates (how many `to` you get for 1 `from`) for:
//   market, visa, mastercard
// Visa/Mastercard come from their public calculator endpoints (unofficial, may
// change or block). If they fail, we fall back to an ESTIMATE (market + typical
// markup) and flag it so the UI can show "est.".

const CURRENCIES = ['GBP', 'USD', 'EUR', 'PKR', 'EGP'];
const EST_MARKUP = { visa: 0.0034, mastercard: 0.0028 }; // observed typical spread over mid-market
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    },
  });

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(6000),
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function marketRate(from, to) {
  // Primary: Frankfurter v2 -> {"date","base","quote","rate"}
  try {
    const d = await getJson(`https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/${to.toLowerCase()}`);
    if (d?.rate > 0) return { rate: d.rate, updated: d.date || null, source: 'frankfurter' };
  } catch (_) {}
  try {
    const d = await getJson(`https://open.er-api.com/v6/latest/${from}`);
    const r = d?.rates?.[to];
    if (r > 0) return { rate: r, updated: d.time_last_update_utc || null, source: 'open.er-api.com' };
  } catch (_) {}
  const d = await getJson(
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`
  );
  const r = d?.[from.toLowerCase()]?.[to.toLowerCase()];
  if (!(r > 0)) throw new Error('No market rate');
  return { rate: r, updated: d.date || null, source: 'currency-api' };
}

// Orientation of the card networks' endpoints is easy to get backwards, so we
// accept either r or 1/r, whichever lands closest to mid-market, and reject
// anything more than 10% away (garbage / blocked response).
function pickRate(candidate, market) {
  if (!(candidate > 0)) return null;
  const options = [candidate, 1 / candidate];
  options.sort((a, b) => Math.abs(a / market - 1) - Math.abs(b / market - 1));
  return Math.abs(options[0] / market - 1) <= 0.1 ? options[0] : null;
}

const fmtVisaDate = (d) =>
  `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;

// Official Visa API, via the separate visa-worker (which holds the mTLS cert).
// Bound in Pages as a Service binding named VISA_WORKER.
async function visaApiRate(env, from, to, market) {
  if (!env?.VISA_WORKER) return null;
  try {
    const res = await env.VISA_WORKER.fetch(`https://visa-worker/?from=${from}&to=${to}`);
    if (!res.ok) return null;
    const d = await res.json();
    return pickRate(parseFloat(d.rate), market);
  } catch (_) {
    return null;
  }
}

async function visaRate(from, to, market) {
  // Visa sometimes hasn't posted today's rates yet, so try today then yesterday.
  for (const back of [0, 1]) {
    const d = new Date(Date.now() - back * 86400000);
    const date = encodeURIComponent(fmtVisaDate(d));
    // Visa: fromCurr = card (billing) currency, toCurr = transaction currency
    const url =
      `https://www.visa.co.uk/cmsapi/fx/rates?utcConvertedDate=${date}&exchangedate=${date}` +
      `&fromCurr=${to}&toCurr=${from}&fee=0&amount=1`;
    try {
      const d2 = await getJson(url, { referer: 'https://www.visa.co.uk/support/consumer/travel-support/exchange-rate-calculator.html' });
      const cand = parseFloat(d2?.fxRateVisa ?? d2?.originalValues?.fxRateVisa ?? d2?.convertedAmount);
      const r = pickRate(cand, market);
      if (r) return r;
    } catch (_) {}
  }
  return null;
}

async function mastercardRate(from, to, market) {
  const url =
    `https://www.mastercard.us/settlement/currencyrate/conversion-rate?fxDate=0000-00-00` +
    `&transCurr=${from}&crdhldBillCurr=${to}&bankFee=0&transAmt=1`;
  try {
    const d = await getJson(url, { referer: 'https://www.mastercard.us/en-us/personal/get-support/convert-currency.html' });
    const cand = parseFloat(d?.data?.conversionRate ?? d?.conversionRate);
    return pickRate(cand, market);
  } catch (_) {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const from = (u.searchParams.get('from') || '').toUpperCase();
  const to = (u.searchParams.get('to') || '').toUpperCase();
  if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to)) {
    return json({ error: 'Unsupported currency', supported: CURRENCIES }, 400);
  }
  if (from === to) {
    return json({ from, to, market: 1, visa: 1, mastercard: 1, estimated: { visa: false, mastercard: false } });
  }

  let m;
  try {
    m = await marketRate(from, to);
  } catch (e) {
    return json({ error: 'Could not fetch market rate' }, 502);
  }

  const [v, mc] = await Promise.all([
    visaApiRate(env, from, to, m.rate).then((r) => r ?? visaRate(from, to, m.rate)),
    mastercardRate(from, to, m.rate),
  ]);

  return json({
    from,
    to,
    market: m.rate,
    visa: v ?? m.rate * (1 + EST_MARKUP.visa),
    mastercard: mc ?? m.rate * (1 + EST_MARKUP.mastercard),
    estimated: { visa: v === null, mastercard: mc === null },
    marketUpdated: m.updated,
    fetchedAt: new Date().toISOString(),
  });
}
