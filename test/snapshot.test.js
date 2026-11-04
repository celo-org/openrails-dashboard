import { test } from "node:test";
import assert from "node:assert/strict";
import { serveOnchain } from "../api/onchain.js";

const T0 = Date.parse("2026-11-04T12:00:00Z");
const MIN = 60 * 1000;
const scanOk = (extra = {}) => async () => ({ status: 200, body: { sample: false, failedWallets: 0, totals: { taggedTxs: 10 }, ...extra } });

function harness({ snap = null, scan = scanOk(), now = T0, failWrite = false } = {}) {
  const writes = [];
  const pending = [];
  return {
    writes,
    pending,
    run: () =>
      serveOnchain({
        readSnapshot: async () => snap,
        writeSnapshot: async (b) => { if (failWrite) throw new Error("blob down"); writes.push(b); },
        scan,
        waitUntil: (p) => pending.push(p),
        now: () => now,
      }),
  };
}

test("a fresh snapshot is served as-is with no scan", async () => {
  let scans = 0;
  const h = harness({ snap: { totals: { taggedTxs: 5 }, snapshotAt: new Date(T0 - 2 * MIN).toISOString() }, scan: async () => { scans++; return scanOk()(); } });
  const r = await h.run();
  assert.equal(r.body.totals.taggedTxs, 5);
  assert.equal(r.body.refreshing, false);
  assert.equal(scans, 0);
  assert.equal(h.pending.length, 0);
});

test("a stale snapshot is served immediately and refreshed in the background", async () => {
  const h = harness({ snap: { totals: { taggedTxs: 5 }, snapshotAt: new Date(T0 - 30 * MIN).toISOString() } });
  const r = await h.run();
  assert.equal(r.body.totals.taggedTxs, 5, "the visitor gets the old numbers without waiting");
  assert.equal(r.body.refreshing, true);
  assert.equal(h.pending.length, 1);
  await Promise.all(h.pending);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].totals.taggedTxs, 10);
  assert.equal(h.writes[0].snapshotAt, new Date(T0).toISOString());
});

test("a partial background scan never replaces a good snapshot", async () => {
  const h = harness({ snap: { totals: { taggedTxs: 5 }, snapshotAt: new Date(T0 - 30 * MIN).toISOString() }, scan: scanOk({ failedWallets: 4 }) });
  await h.run();
  await Promise.all(h.pending);
  assert.equal(h.writes.length, 0);
});

test("with no snapshot, the first visitor waits for a scan, which is stored (even if partial)", async () => {
  const h = harness({ scan: scanOk({ failedWallets: 2 }) });
  const r = await h.run();
  assert.equal(r.status, 200);
  assert.equal(r.body.totals.taggedTxs, 10);
  assert.equal(h.writes.length, 1, "something beats an empty page");
});

test("a failing Blob write doesn't fail the request, and errors from Loops House pass through unstored", async () => {
  const h1 = harness({ failWrite: true });
  assert.equal((await h1.run()).status, 200);
  const h2 = harness({ scan: async () => ({ status: 502, body: { error: "Loops House API answered 500." } }) });
  const r2 = await h2.run();
  assert.equal(r2.status, 502);
  assert.equal(h2.writes.length, 0);
});

test("sample data is never written to the snapshot", async () => {
  const h = harness({ scan: async () => ({ status: 200, body: { sample: true, failedWallets: 0 } }) });
  await h.run();
  assert.equal(h.writes.length, 0);
});
