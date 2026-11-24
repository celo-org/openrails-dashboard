// Loops House event API. The key stays server-side.

const BASE = "https://www.loops.house/api/v1/celo/";

// Returns { payload } or { status, error }; `payload` is null when no key is set (sample mode).
export async function fetchPayload(env = process.env, fetchImpl = fetch, loopsSlug = "agents-on-open-rails") {
  const key = env.LOOPS_API_KEY;
  if (!key) return { payload: null };
  if (!/^[a-z0-9-]+$/.test(loopsSlug)) return { status: 400, error: "Unknown hackathon." };

  const header = env.LOOPS_API_AUTH_HEADER || "Authorization";
  const value = header.toLowerCase() === "authorization" && !/^\w+\s/.test(key) ? `Bearer ${key}` : key;
  let res;
  try {
    res = await fetchImpl(BASE + loopsSlug, { headers: { [header]: value, accept: "application/json" } });
  } catch {
    return { status: 502, error: "Couldn't reach the Loops House API. Try again in a minute." };
  }
  if (res.status === 401 || res.status === 403) {
    return { status: 502, error: "Loops House rejected the API key. Check LOOPS_API_KEY in Vercel." };
  }
  if (!res.ok) return { status: 502, error: `Loops House API answered ${res.status}.` };
  return { payload: await res.json() };
}
