// Worker entry: serves the static site from /public and handles /api/rates.
// Reuses the same handler as the Pages Function.
import { onRequestGet } from '../functions/api/rates.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/rates' && request.method === 'GET') {
      return onRequestGet({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
