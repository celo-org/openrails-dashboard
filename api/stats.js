// GET /api/stats — fetches submissions from Loops House server-side and returns
// only aggregate counts. The API key never reaches the browser.

import { aggregate, pathsFromEnv } from "../lib/aggregate.js";
import { sampleSubmissions } from "../lib/sample.js";

const DEFAULT_URL = "https://www.loops.house/api/v1/celo/agents-on-open-rails";

export async function loadStats(env = process.env, fetchImpl = fetch) {
  const paths = pathsFromEnv(env);
  const key = env.LOOPS_API_KEY;
  if (!key) {
    return { status: 200, body: { sample: true, updatedAt: new Date().toISOString(), ...aggregate(sampleSubmissions(), paths) } };
  }

  const header = env.LOOPS_API_AUTH_HEADER || "Authorization";
  const value = header.toLowerCase() === "authorization" && !/^\w+\s/.test(key) ? `Bearer ${key}` : key;
  let res;
  try {
    res = await fetchImpl(env.LOOPS_API_URL || DEFAULT_URL, { headers: { [header]: value, accept: "application/json" } });
  } catch {
    return { status: 502, body: { error: "Couldn't reach the Loops House API. Try again in a minute." } };
  }
  if (res.status === 401 || res.status === 403) {
    return { status: 502, body: { error: "Loops House rejected the API key. Check LOOPS_API_KEY and LOOPS_API_AUTH_HEADER in Vercel." } };
  }
  if (!res.ok) {
    return { status: 502, body: { error: `Loops House API answered ${res.status}.` } };
  }
  const payload = await res.json();
  return { status: 200, body: { sample: false, updatedAt: new Date().toISOString(), ...aggregate(payload, paths) } };
}

export default async function handler(req, res) {
  const { status, body } = await loadStats();
  res.setHeader("Cache-Control", status === 200 ? "s-maxage=300, stale-while-revalidate=600" : "no-store");
  res.status(status).json(body);
}
