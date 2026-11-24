// Per-hackathon on-chain activity snapshot, kept in a private Vercel Blob.
//
// The snapshot stores each project's activity summary (counts per project id; no
// wallets), so every page for a hackathon aggregates from the same scan.
// Requests answer from it right away. While the hackathon runs, a snapshot older
// than FRESH_MS is rescanned in the background (waitUntil). Once a snapshot was
// taken after the submission deadline it is final and never rescanned: the scan
// window ends at the deadline, so nothing later can change it.

import { get, put } from "@vercel/blob";
import { loadActivity } from "./onchain.js";

export const FRESH_MS = 10 * 60 * 1000;
export const snapshotPath = (slug) => `activity/${slug}.json`;

export async function readBlobSnapshot(path) {
  try {
    const r = await get(path, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return await new Response(r.stream).json();
  } catch {
    return null;
  }
}

export async function writeBlobSnapshot(path, body) {
  await put(path, JSON.stringify(body), {
    access: "private",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export const activityToJson = (activity) => Object.fromEntries(activity);
export const activityFromJson = (obj) => new Map(Object.entries(obj ?? {}));

// Scans every agent wallet of `payload` for its hackathon window.
export async function scanActivity(payload, { fetchImpl = fetch, now = Date.now } = {}) {
  const since = payload.event?.startsAt;
  const until = payload.event?.submissionDeadline ?? null;
  const { activity, failed } = await loadActivity(payload.projects ?? [], since, { until, fetchImpl });
  return { snapshotAt: new Date(now()).toISOString(), until, failedWallets: failed, activity: activityToJson(activity) };
}

export const isFinal = (snap, deadline) => !!(snap && deadline && new Date(snap.snapshotAt) > new Date(deadline) && !snap.failedWallets);

// Pure orchestration, injectable for tests. Returns { snap, refreshing, final }.
// A scan replaces a snapshot only when every wallet was read, so one bad round never
// swaps good totals for lower ones; with no snapshot yet, any result is kept.
export async function serveSnapshot({ read, write, scan, waitUntil, deadline = null, now = Date.now, freshMs = FRESH_MS }) {
  const refresh = async (had) => {
    const s = await scan();
    if (!s.failedWallets || !had) {
      try {
        await write(s);
      } catch {
        // Storage is a cache: a failed write must not fail the request.
      }
    }
    return s;
  };
  const snap = await read();
  if (snap) {
    if (isFinal(snap, deadline)) return { snap, refreshing: false, final: true };
    const stale = !(now() - new Date(snap.snapshotAt).getTime() < freshMs);
    if (stale) waitUntil(refresh(true).catch(() => {}));
    return { snap, refreshing: stale, final: false };
  }
  const s = await refresh(false);
  return { snap: s, refreshing: false, final: isFinal(s, deadline) };
}
