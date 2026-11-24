// Official on-chain numbers from the Celo team's Dune queries, read through the Dune API.
//
// Each hackathon can point at two queries (lib/hackathons.js `dune`):
//   perCode: one row per attribution code (tx_count, unique_users, volume_usd and
//            partner columns: ripio_*, textile_*, buy_*, tether_*, cngn_*)
//   daily:   one row per code and day (day, code, tx_count, volume_usd)
//   totals:  one row of headline totals; only unique_users is read, because users
//            can't be summed across projects (one wallet may use several)
// Only these metric columns are requested: the queries also carry builder names and
// handles, which never need to reach this server, let alone the browser.
// Results are read as last executed by Dune (no re-execution), memoized per instance.

const API = "https://api.dune.com/api/v1/query/";
export const PER_CODE_COLUMNS = [
  "code", "tx_count", "unique_users", "volume_usd",
  "ripio_tx", "ripio_volume", "tether_volume", "cngn_volume",
  "buy_tx", "buy_volume", "textile_tx", "textile_volume",
];
export const DAILY_COLUMNS = ["day", "code", "tx_count"];
const MEMO_MS = 10 * 60 * 1000;
const memo = new Map();

export function resetDuneMemo() {
  memo.clear();
}

// Returns { rows, executedAt } or { error }.
export async function fetchDuneResults(queryId, columns, { env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const key = env.DUNE_API_KEY;
  if (!key) return { error: "DUNE_API_KEY is not set." };
  if (!/^\d+$/.test(String(queryId))) return { error: "Bad Dune query id." };
  const memoKey = `${queryId}:${columns.join(",")}`;
  const hit = memo.get(memoKey);
  if (hit && now() - hit.at < MEMO_MS) return hit.value;

  const rows = [];
  let executedAt = null;
  let offset = 0;
  try {
    for (let page = 0; page < 20; page++) {
      const url = `${API}${queryId}/results?limit=1000&offset=${offset}&columns=${encodeURIComponent(columns.join(","))}`;
      const res = await fetchImpl(url, { headers: { "X-Dune-API-Key": key }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) return { error: `Dune API answered ${res.status}.` };
      const d = await res.json();
      if (d.error) return { error: `Dune: ${d.error}` };
      executedAt ??= d.execution_ended_at ?? null;
      rows.push(...(d.result?.rows ?? []));
      if (d.next_offset == null) break;
      offset = d.next_offset;
    }
  } catch {
    return { error: "Couldn't reach the Dune API." };
  }
  // Keep only requested columns even if the API ever returns more.
  const value = { rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))), executedAt };
  memo.set(memoKey, { at: now(), value });
  return value;
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Builds the same activity shape lib/onchain.js produces, keyed by project id, from
// Dune rows keyed by attribution code. `counterparties` carries Dune's unique users.
// `window` ({ from, to } as YYYY-MM-DD, inclusive) drops daily rows outside the hackathon:
// the daily query keeps running after the deadline.
export function activityFromDune(projects, perCodeRows, dailyRows = [], window = null) {
  const byCode = new Map(perCodeRows.map((r) => [String(r.code ?? "").trim().toLowerCase(), r]));
  const days = new Map();
  for (const r of dailyRows) {
    const code = String(r.code ?? "").trim().toLowerCase();
    const day = String(r.day ?? "").slice(0, 10);
    if (!code || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (window && (day < window.from || day > window.to)) continue;
    const m = days.get(code) ?? {};
    // Daily volume is left out on purpose: the daily query measures volume differently
    // from perCode (its days sum to about half of perCode's volume_usd), and a cumulative
    // line ending below the headline total would contradict it. Daily txs do add up.
    m[day] = { tagged: (m[day]?.tagged ?? 0) + n(r.tx_count), volumeUsd: 0 };
    days.set(code, m);
  }
  const activity = new Map();
  for (const p of projects) {
    const code = String(p.code ?? "").trim().toLowerCase();
    const r = byCode.get(code);
    if (!r) continue;
    const volumeUsd = n(r.volume_usd);
    const ripio = n(r.ripio_volume), tether = n(r.tether_volume), cngn = n(r.cngn_volume);
    const byToken = {};
    if (ripio) byToken["Ripio wFIAT"] = ripio;
    if (tether) byToken["USD₮ / USA₮"] = tether;
    if (cngn) byToken["cNGN"] = cngn;
    const other = volumeUsd - ripio - tether - cngn;
    if (other > 0.005) byToken["Other (USDC, CELO…)"] = other;
    activity.set(p.id, {
      tagged: n(r.tx_count),
      volumeUsd,
      counterparties: n(r.unique_users),
      byToken,
      partners: {
        ripioTx: n(r.ripio_tx),
        ripioVolume: ripio,
        textileTx: n(r.textile_tx),
        textileVolume: n(r.textile_volume),
        buyTx: n(r.buy_tx),
        buyVolume: n(r.buy_volume),
      },
      days: days.get(code) ?? {},
    });
  }
  return activity;
}

// Returns { activity, executedAt, uniqueUsers } or { error }.
export async function loadDuneActivity(dune, projects, { window = null, ...opts } = {}) {
  const per = await fetchDuneResults(dune.perCode, PER_CODE_COLUMNS, opts);
  if (per.error) return per;
  let daily = { rows: [] };
  if (dune.daily) {
    daily = await fetchDuneResults(dune.daily, DAILY_COLUMNS, opts);
    if (daily.error) daily = { rows: [] }; // the daily chart is optional; totals still come from perCode
  }
  let uniqueUsers = null;
  if (dune.totals) {
    const t = await fetchDuneResults(dune.totals, ["unique_users"], opts);
    const v = Number(t.rows?.[0]?.unique_users);
    if (!t.error && Number.isFinite(v)) uniqueUsers = v;
  }
  return { activity: activityFromDune(projects, per.rows, daily.rows, window), executedAt: per.executedAt, uniqueUsers };
}
