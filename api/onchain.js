// GET /api/onchain — the /api/stats breakdown plus on-chain activity per project
// (attribution-tagged txs and payment volume), read from Blockscout for every
// agent wallet.
//
// Scanning every wallet takes tens of seconds and grows with the hackathon, so the
// last complete result is kept in a private Vercel Blob. Requests answer from that
// snapshot right away; when it is older than FRESH_MS, the same request starts a
// rescan in the background (waitUntil) that replaces it. Only the very first scan,
// or a missing Blob store (local dev), makes a visitor wait.

import { get, put } from "@vercel/blob";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { aggregate } from "../lib/aggregate.js";
import { loadActivity } from "../lib/onchain.js";
import { samplePayload, sampleActivity } from "../lib/sample.js";
import { fetchPayload } from "./stats.js";

export const SNAPSHOT_PATH = "onchain/latest.json";
export const FRESH_MS = 10 * 60 * 1000;

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

export async function readBlobSnapshot() {
  try {
    const r = await get(SNAPSHOT_PATH, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return await new Response(r.stream).json();
  } catch {
    return null;
  }
}

export async function writeBlobSnapshot(body) {
  await put(SNAPSHOT_PATH, JSON.stringify(body), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

// Pure orchestration, injectable for tests.
// A scan replaces the snapshot only when every wallet was read, so one bad round
// never swaps good totals for low ones; with no snapshot yet, any 200 is kept.
export async function serveOnchain({ readSnapshot, writeSnapshot, scan, waitUntil, now = Date.now, freshMs = FRESH_MS }) {
  const refresh = async (hadSnapshot) => {
    const r = await scan();
    if (r.status === 200 && !r.body.sample && (!r.body.failedWallets || !hadSnapshot)) {
      try {
        await writeSnapshot({ ...r.body, snapshotAt: new Date(now()).toISOString() });
      } catch {
        // Storage is a cache: a failed write must not fail the request.
      }
    }
    return r;
  };

  const snap = await readSnapshot();
  if (snap) {
    const age = now() - new Date(snap.snapshotAt ?? snap.updatedAt).getTime();
    const stale = !(age < freshMs);
    if (stale) waitUntil(refresh(true).catch(() => {}));
    return { status: 200, body: { ...snap, refreshing: stale } };
  }
  const r = await refresh(false);
  return { status: r.status, body: r.status === 200 ? { ...r.body, snapshotAt: new Date(now()).toISOString(), refreshing: false } : r.body };
}

export default async function handler(req, res) {
  const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN && !!process.env.LOOPS_API_KEY;
  const { status, body } = hasBlob
    ? await serveOnchain({
        readSnapshot: readBlobSnapshot,
        writeSnapshot: writeBlobSnapshot,
        scan: () => loadOnchainShared(),
        waitUntil: vercelWaitUntil,
      })
    : await loadOnchainShared();
  // The Blob snapshot is the long-lived copy, so the CDN only needs to absorb bursts.
  res.setHeader("Cache-Control", status === 200 ? (hasBlob ? "s-maxage=60, stale-while-revalidate=600" : "s-maxage=900, stale-while-revalidate=86400") : "no-store");
  res.status(status).json(body);
}
