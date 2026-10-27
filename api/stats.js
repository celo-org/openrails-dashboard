// GET /api/stats — fetches the event payload from Loops House server-side and
// returns only aggregate counts. The API key never reaches the browser.

import { aggregate } from "../lib/aggregate.js";
import { samplePayload } from "../lib/sample.js";

const DEFAULT_URL = "https://www.loops.house/api/v1/celo/agents-on-open-rails";

// Returns { payload } or { status, error }; `payload` is null when no key is set (sample mode).
export async function fetchPayload(env = process.env, fetchImpl = fetch) {
  const key = env.LOOPS_API_KEY;
  if (!key) return { payload: null };

  const header = env.LOOPS_API_AUTH_HEADER || "Authorization";
  const value = header.toLowerCase() === "authorization" && !/^\w+\s/.test(key) ? `Bearer ${key}` : key;
  let res;
  try {
    res = await fetchImpl(env.LOOPS_API_URL || DEFAULT_URL, { headers: { [header]: value, accept: "application/json" } });
  } catch {
    return { status: 502, error: "Couldn't reach the Loops House API. Try again in a minute." };
  }
  if (res.status === 401 || res.status === 403) {
    return { status: 502, error: "Loops House rejected the API key. Check LOOPS_API_KEY in Vercel." };
  }
  if (!res.ok) return { status: 502, error: `Loops House API answered ${res.status}.` };
  return { payload: await res.json() };
}

export async function loadStats(env = process.env, fetchImpl = fetch) {
  const { payload, status, error } = await fetchPayload(env, fetchImpl);
  if (error) return { status, body: { error } };
  if (!payload) {
    return { status: 200, body: { sample: true, updatedAt: new Date().toISOString(), ...aggregate(samplePayload()) } };
  }
  return { status: 200, body: { sample: false, updatedAt: new Date().toISOString(), ...aggregate(payload) } };
}

export default async function handler(req, res) {
  const { status, body } = await loadStats();
  res.setHeader("Cache-Control", status === 200 ? "s-maxage=300, stale-while-revalidate=600" : "no-store");
  res.status(status).json(body);
}
