// Loads one hackathon: the Loops House payload plus, optionally, its on-chain
// activity snapshot (lib/snapshot.js). Shared by every page and endpoint.

import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import { fetchPayload } from "./loops.js";
import { loadDuneActivity } from "./dune.js";
import { samplePayload, sampleActivity } from "./sample.js";
import {
  serveSnapshot,
  scanActivity,
  readBlobSnapshot,
  writeBlobSnapshot,
  snapshotPath,
  activityFromJson,
  activityToJson,
} from "./snapshot.js";

// One scan per hackathon at a time per instance: concurrent requests share it.
const inflight = new Map();
function sharedScan(slug, run) {
  if (!inflight.has(slug)) inflight.set(slug, run().finally(() => inflight.delete(slug)));
  return inflight.get(slug);
}

export function hackathonStatus(event, now = Date.now()) {
  if (!event?.submissionDeadline) return "live";
  if (event.startsAt && now < new Date(event.startsAt).getTime()) return "upcoming";
  return now > new Date(event.submissionDeadline).getTime() ? "final" : "live";
}

// Returns { status, error } or { status: 200, payload, activity, meta }.
export async function loadEvent(hackathon, { onchain = false, env = process.env, fetchImpl = fetch, waitUntil = vercelWaitUntil } = {}) {
  const { payload, status, error } = await fetchPayload(env, fetchImpl, hackathon.loopsSlug);
  if (error) return { status, error };
  if (!payload) {
    const sample = samplePayload();
    return { status: 200, payload: sample, activity: onchain ? sampleActivity(sample) : null, meta: { sample: true, failedWallets: 0 } };
  }
  const meta = { sample: false, status: hackathonStatus(payload.event) };
  if (!onchain) return { status: 200, payload, activity: null, meta };

  // Official numbers first: the hackathon's Dune queries, when configured.
  if (hackathon.dune?.perCode && env.DUNE_API_KEY) {
    const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);
    const window = payload.event?.startsAt && payload.event?.submissionDeadline
      ? { from: day(payload.event.startsAt), to: day(payload.event.submissionDeadline) }
      : null;
    const d = await loadDuneActivity(hackathon.dune, payload.projects ?? [], { window, env, fetchImpl });
    if (!d.error) {
      return {
        status: 200,
        payload,
        activity: d.activity,
        meta: { ...meta, source: "dune", duneUpdatedAt: d.executedAt, duneBoard: hackathon.dune.board ?? null, uniqueUsers: d.uniqueUsers, failedWallets: 0, final: meta.status === "final", refreshing: false },
      };
    }
    meta.duneError = d.error; // fall through to the Blockscout scan
  }
  meta.source = "blockscout";

  const scan = () => sharedScan(hackathon.slug, () => scanActivity(payload, { fetchImpl }));
  if (!env.BLOB_READ_WRITE_TOKEN) {
    const s = await scan();
    return { status: 200, payload, activity: activityFromJson(s.activity), meta: { ...meta, failedWallets: s.failedWallets, snapshotAt: s.snapshotAt, refreshing: false, final: false } };
  }
  const path = snapshotPath(hackathon.slug);
  const r = await serveSnapshot({
    read: () => readBlobSnapshot(path),
    write: (s) => writeBlobSnapshot(path, s),
    scan,
    waitUntil,
    deadline: payload.event?.submissionDeadline ?? null,
  });
  return {
    status: 200,
    payload,
    activity: activityFromJson(r.snap.activity),
    meta: { ...meta, failedWallets: r.snap.failedWallets, snapshotAt: r.snap.snapshotAt, refreshing: r.refreshing, final: r.final },
  };
}

export { activityToJson };
