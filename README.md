# Travel FX

Mobile-first currency converter (GBP, USD, EUR, PKR, EGP) showing Market, Visa and Mastercard rates. Installable to the home screen as a PWA.

## Structure

- `public/` – the site: `index.html` (whole UI, no build step), manifest, icon, service worker
- `functions/api/rates.js` – Cloudflare Pages Function (`/api/rates?from=GBP&to=EGP`)
- `manifest.webmanifest`, `icon.svg`, `sw.js` – PWA bits

## Deploy (free)

1. Push this folder to a GitHub repo.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Build command: leave empty. Output directory: `public`.
4. Deploy. Pages detects `functions/` automatically.

Or with no Git: `npx wrangler pages deploy public --project-name travel-fx`

Free tier limits (100k function requests/day) are far beyond personal use.

## On your phone

Open the site, then Share → Add to Home Screen (iOS) or menu → Install app (Android).

## How rates are sourced

- **Market**: Frankfurter v2 (api.frankfurter.dev), falling back to open.er-api.com and jsDelivr currency-api.
- **Visa / Mastercard**: the public endpoints behind their website exchange-rate calculators. These are unofficial and undocumented, so they can change or block server requests at any time. If one fails, the app shows a rate marked **EST.** (market plus a typical markup) instead of failing.

If Visa/Mastercard stay on EST., check them in a browser dev-tools Network tab on the official calculator pages and adjust the URLs in `rates.js`.

## Visa official API (two-way SSL)

Do NOT put the private key in the Pages project, GitHub, or chat. It lives in the separate `visa-worker/`.

```
cd visa-worker
npx wrangler login
npx wrangler mtls-certificate upload --cert visa-client-cert.pem --key private.key --name visa-cert
#   -> copy the printed certificate_id into wrangler.toml
npx wrangler secret put VISA_USER_ID
npx wrangler secret put VISA_PASSWORD
#   edit VISA_BASE / VISA_RATE_PRODUCT / VISA_BIN in wrangler.toml
npx wrangler deploy
```

Then in Cloudflare: Pages project -> Settings -> Bindings -> Add -> Service binding,
variable name `VISA_WORKER`, service `visa-worker`. Redeploy Pages.
If the Visa call fails, the app silently falls back to the website endpoint, then to EST.
