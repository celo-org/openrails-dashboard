// GET /api/onchain — the /api/stats breakdown plus on-chain activity per project
// (attribution-tagged txs and payment volume), read from Blockscout for every
// agent wallet. Scanning all wallets takes ~15-20 s, so the CDN caches it for
// 15 minutes and serves the stale copy while it refreshes in the background.

import { aggregate } from "../lib/aggregate.js";
import { loadActivity } from "../lib/onchain.js";
import { samplePayload, sampleActivity } from "../lib/sample.js";
import { fetchPayload } from "./stats.js";

export async function loadOnchain(env = process.env, fetchImpl = fetch) {
  const { payload, status, error } = await fetchPayload(env, fetchImpl);
  if (error) return { status, body: { error } };
  if (!payload) {
    const sample = samplePayload();
    return { status: 200, body: { sample: true, failedWallets: 0, updatedAt: new Date().toISOString(), ...aggregate(sample, sampleActivity(sample)) } };
  }
  const since = payload.event?.startsAt ?? "2026-10-06T12:00:00.000Z";
  const { activity, failed } = await loadActivity(payload.projects ?? [], since, { fetchImpl });
  return { status: 200, body: { sample: false, failedWallets: failed, updatedAt: new Date().toISOString(), ...aggregate(payload, activity) } };
}

// One scan at a time per instance: concurrent requests share the in-flight scan and
// reuse its result for MEMO_MS, so a burst of visitors can't trigger parallel scans
// that trip Blockscout's rate limit. Failed scans aren't memoized.
const MEMO_MS = 10 * 60 * 1000;
let memo = null;
export function loadOnchainShared(load = loadOnchain, now = Date.now) {
  if (memo && now() - memo.at < MEMO_MS) return memo.promise;
  const entry = { at: now(), promise: null };
  entry.promise = load().then((r) => {
    if (r.status !== 200 || r.body.failedWallets) memo = memo === entry ? null : memo;
    return r;
  });
  memo = entry;
  return entry.promise;
}
export function resetOnchainMemo() {
  memo = null;
}

export default async function handler(req, res) {
  const { status, body } = await loadOnchainShared();
  res.setHeader("Cache-Control", status === 200 ? "s-maxage=900, stale-while-revalidate=86400" : "no-store");
  res.status(status).json(body);
}
