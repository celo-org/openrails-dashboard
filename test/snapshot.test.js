import { test } from "node:test";
import assert from "node:assert/strict";
import { serveSnapshot, isFinal } from "../lib/snapshot.js";

const T0 = Date.parse("2026-11-04T12:00:00Z");
const MIN = 60 * 1000;
const scanOk = (extra = {}) => async () => ({ snapshotAt: new Date(T0).toISOString(), failedWallets: 0, activity: { p1: { tagged: 10 } }, ...extra });

function harness({ snap = null, scan = scanOk(), now = T0, deadline = null, failWrite = false } = {}) {
  const writes = [];
  const pending = [];
  let scans = 0;
  return {
    writes,
    pending,
    get scans() { return scans; },
    run: () =>
      serveSnapshot({
        read: async () => snap,
        write: async (b) => { if (failWrite) throw new Error("blob down"); writes.push(b); },
        scan: async () => { scans++; return scan(); },
        waitUntil: (p) => pending.push(p),
        deadline,
        now: () => now,
      }),
  };
}
const snapAt = (t, extra = {}) => ({ snapshotAt: new Date(t).toISOString(), failedWallets: 0, activity: { p1: { tagged: 5 } }, ...extra });

test("a fresh snapshot is served as-is with no scan", async () => {
  const h = harness({ snap: snapAt(T0 - 2 * MIN) });
  const r = await h.run();
  assert.equal(r.snap.activity.p1.tagged, 5);
  assert.equal(r.refreshing, false);
  assert.equal(h.scans, 0);
});

test("a stale snapshot is served immediately and refreshed in the background", async () => {
  const h = harness({ snap: snapAt(T0 - 30 * MIN) });
  const r = await h.run();
  assert.equal(r.snap.activity.p1.tagged, 5, "the visitor gets the old numbers without waiting");
  assert.equal(r.refreshing, true);
  await Promise.all(h.pending);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].activity.p1.tagged, 10);
});

test("a partial background scan never replaces a good snapshot", async () => {
  const h = harness({ snap: snapAt(T0 - 30 * MIN), scan: scanOk({ failedWallets: 4 }) });
  await h.run();
  await Promise.all(h.pending);
  assert.equal(h.writes.length, 0);
});

test("with no snapshot, the first visitor waits for a scan, which is stored even if partial", async () => {
  const h = harness({ scan: scanOk({ failedWallets: 2 }) });
  const r = await h.run();
  assert.equal(r.snap.activity.p1.tagged, 10);
  assert.equal(h.writes.length, 1, "something beats an empty page");
});

test("a failing Blob write doesn't fail the request", async () => {
  const h = harness({ failWrite: true });
  const r = await h.run();
  assert.equal(r.snap.activity.p1.tagged, 10);
});

test("a complete snapshot taken after the deadline is final and never rescanned", async () => {
  const deadline = new Date(T0 - 60 * MIN).toISOString();
  const h = harness({ snap: snapAt(T0 - 30 * MIN), deadline, now: T0 + 30 * 24 * 60 * MIN });
  const r = await h.run();
  assert.equal(r.final, true);
  assert.equal(r.refreshing, false);
  assert.equal(h.scans, 0);
  assert.equal(h.pending.length, 0);
});

test("a snapshot from before the deadline is rescanned once the hackathon ends; a partial final one is retried", async () => {
  const deadline = new Date(T0 - 60 * MIN).toISOString();
  const before = harness({ snap: snapAt(T0 - 90 * MIN), deadline, now: T0 });
  const r = await before.run();
  assert.equal(r.final, false);
  assert.equal(r.refreshing, true);
  assert.equal(isFinal(snapAt(T0 - 30 * MIN, { failedWallets: 1 }), deadline), false, "a final snapshot with unread wallets keeps retrying");
});
