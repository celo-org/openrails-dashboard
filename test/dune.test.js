import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fetchDuneResults, activityFromDune, loadDuneActivity, resetDuneMemo, PER_CODE_COLUMNS } from "../lib/dune.js";
import { aggregateCities } from "../lib/cities.js";
import { loadEvent } from "../lib/event-data.js";
import { getHackathon } from "../lib/hackathons.js";

beforeEach(() => resetDuneMemo());

const perCode = [
  { code: "celo_aaa", tx_count: 10, unique_users: 4, volume_usd: 100, ripio_tx: 3, ripio_volume: 30, tether_volume: 50, cngn_volume: 0, buy_tx: 2, buy_volume: 1.5, textile_tx: 1, textile_volume: 20, builder: "Secret Name", twitter: "@secret" },
  { code: "CELO_BBB ", tx_count: 5, unique_users: 1, volume_usd: 9, ripio_tx: 0, ripio_volume: 0, tether_volume: 0, cngn_volume: 9, buy_tx: 0, buy_volume: 0, textile_tx: 0, textile_volume: 0 },
];
const projects = [
  { id: "p1", code: "celo_aaa", status: "submitted", name: "Alpha", builderIds: ["b1"], tracks: [] },
  { id: "p2", code: "celo_bbb", status: "draft", builderIds: ["b2"], tracks: [] },
  { id: "p3", code: "celo_ccc", status: "draft", builderIds: [], tracks: [] },
];

test("fetchDuneResults asks only for metric columns, sends the key in a header, and keeps only those columns", async () => {
  let seen;
  const fake = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ execution_ended_at: "2026-11-16T11:51:42Z", result: { rows: perCode }, next_offset: null }) }; };
  const r = await fetchDuneResults(8975671, PER_CODE_COLUMNS, { env: { DUNE_API_KEY: "dk" }, fetchImpl: fake });
  assert.equal(seen.opts.headers["X-Dune-API-Key"], "dk");
  assert.ok(!seen.url.includes("dk"), "the key never goes in the URL");
  assert.ok(decodeURIComponent(seen.url).includes("columns=code,tx_count"));
  assert.equal(r.executedAt, "2026-11-16T11:51:42Z");
  assert.ok(!JSON.stringify(r.rows).includes("Secret Name") && !JSON.stringify(r.rows).includes("@secret"));
});

test("fetchDuneResults reports a missing key or an API error instead of throwing", async () => {
  assert.match((await fetchDuneResults(1, PER_CODE_COLUMNS, { env: {} })).error, /DUNE_API_KEY/);
  const r = await fetchDuneResults(1, PER_CODE_COLUMNS, { env: { DUNE_API_KEY: "k" }, fetchImpl: async () => ({ ok: false, status: 402 }) });
  assert.match(r.error, /402/);
});

test("activityFromDune maps codes to projects (case/space-insensitive) and splits volume by currency", () => {
  const a = activityFromDune(projects, perCode, [
    { day: "2026-10-07", code: "celo_aaa", tx_count: 4, volume_usd: 40 },
    { day: "2026-10-08T00:00:00Z", code: "celo_aaa", tx_count: 6, volume_usd: 60 },
  ]);
  const p1 = a.get("p1");
  assert.equal(p1.tagged, 10);
  assert.equal(p1.counterparties, 4);
  assert.deepEqual(p1.byToken, { "Ripio wFIAT": 30, "USD₮ / USA₮": 50, "Other (USDC, CELO…)": 20 });
  assert.deepEqual(p1.partners, { ripioTx: 3, ripioVolume: 30, textileTx: 1, textileVolume: 20, buyTx: 2, buyVolume: 1.5 });
  assert.deepEqual(p1.days, { "2026-10-07": { tagged: 4, volumeUsd: 0 }, "2026-10-08": { tagged: 6, volumeUsd: 0 } }, "daily volume isn't comparable to the headline, so it's not used");
  assert.equal(a.get("p2").byToken.cNGN, 9);
  assert.equal(a.has("p3"), false, "a code with no Dune row has no activity");
});

test("city totals from Dune activity equal the sum of the per-code rows, partners included", () => {
  const payload = { counts: {}, registrations: [{ builderId: "b1", city: "Lagos" }, { builderId: "b2", city: "Lagos" }, { builderId: "b9", city: "Lagos" }], projects };
  const out = aggregateCities(payload, activityFromDune(projects, perCode));
  assert.equal(out.totals.taggedTxs, 15);
  assert.equal(out.totals.volumeUsd, 109);
  assert.equal(out.totals.users, 5);
  assert.deepEqual(out.totals.partners, { ripioTx: 3, ripioVolume: 30, textileTx: 1, textileVolume: 20, buyTx: 2, buyVolume: 1.5 });
  const lagos = out.cities.find((c) => c.label === "Lagos");
  assert.equal(lagos.tagged, 15);
  assert.equal(lagos.partners.ripioTx, 3);
});

test("loadEvent uses Dune when configured and falls back to the Blockscout scan when Dune fails", async () => {
  const payload = { event: { startsAt: "2026-10-06T00:00:00Z", submissionDeadline: "2026-11-09T12:30:00Z" }, counts: {}, registrations: [], projects };
  const loops = { ok: true, status: 200, json: async () => payload };
  const duneOk = async (url) => url.includes("loops.house") ? loops : { ok: true, json: async () => ({ result: { rows: perCode }, next_offset: null, execution_ended_at: "x" }) };
  const h = getHackathon("agents-on-open-rails");
  const r = await loadEvent(h, { onchain: true, env: { LOOPS_API_KEY: "k", DUNE_API_KEY: "d" }, fetchImpl: duneOk });
  assert.equal(r.meta.source, "dune");
  assert.equal(r.activity.get("p1").tagged, 10);

  resetDuneMemo();
  let scanned = false;
  const duneDown = async (url) => {
    if (url.includes("loops.house")) return loops;
    if (url.includes("dune.com")) return { ok: false, status: 500 };
    scanned = true;
    return { ok: true, json: async () => ({ items: [], next_page_params: null, result: { blockNumber: "1" } }) };
  };
  const r2 = await loadEvent(h, { onchain: true, env: { LOOPS_API_KEY: "k", DUNE_API_KEY: "d" }, fetchImpl: duneDown });
  assert.equal(r2.meta.source, "blockscout");
  assert.match(r2.meta.duneError, /500/);
  assert.equal(scanned, true);
});

test("daily rows outside the hackathon window are dropped", () => {
  const a = activityFromDune(projects, perCode, [
    { day: "2026-10-05", code: "celo_aaa", tx_count: 99, volume_usd: 1 },
    { day: "2026-11-09", code: "celo_aaa", tx_count: 2, volume_usd: 2 },
    { day: "2026-11-10", code: "celo_aaa", tx_count: 99, volume_usd: 1 },
  ], { from: "2026-10-06", to: "2026-11-09" });
  assert.deepEqual(a.get("p1").days, { "2026-11-09": { tagged: 2, volumeUsd: 0 } });
});
