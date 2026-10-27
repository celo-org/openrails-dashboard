import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAttribution, transferUsd, summarizeProject, loadActivity, ERC_8021_MARKER } from "../lib/onchain.js";
import { aggregate } from "../lib/aggregate.js";
import { loadOnchainShared, resetOnchainMemo } from "../api/onchain.js";

// ERC-8021 schema 0 suffix: [codes][len:1][schema:1][marker:16]
const suffix = (codes) => {
  const hex = Buffer.from(codes, "utf8").toString("hex");
  return hex + (codes.length).toString(16).padStart(2, "0") + "00" + ERC_8021_MARKER;
};
const CALL = "0xa9059cbb" + "00".repeat(64);
const USDC = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C";
const WARS = "0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d";
const SPAM = "0x000000000000000000000000000000000000beef";

test("decodeAttribution reads single and multiple codes, and ignores untagged calldata", () => {
  assert.deepEqual(decodeAttribution(CALL + suffix("celo_abc123def456")), ["celo_abc123def456"]);
  assert.deepEqual(decodeAttribution(CALL + suffix("celo_aaa,minipay")), ["celo_aaa", "minipay"]);
  assert.deepEqual(decodeAttribution(CALL), []);
  assert.deepEqual(decodeAttribution("0x"), []);
  assert.deepEqual(decodeAttribution(null), []);
});

test("transferUsd values USD stables at 1, others at Blockscout's rate, unknown tokens at 0", () => {
  assert.equal(transferUsd({ token: { address_hash: USDC, exchange_rate: "0.99" }, total: { decimals: "6", value: "2500000" } }), 2.5);
  assert.equal(transferUsd({ token: { address_hash: WARS, exchange_rate: "0.0006" }, total: { decimals: "18", value: "1000" + "0".repeat(18) } }), 0.6);
  assert.equal(transferUsd({ token: { address_hash: SPAM, exchange_rate: "99999" }, total: { decimals: "18", value: "1" + "0".repeat(18) } }), 0, "spam tokens never count");
  assert.equal(transferUsd({ token: { address_hash: WARS, exchange_rate: null }, total: { decimals: "18", value: "1" } }), 0);
});

test("summarizeProject counts only successful txs tagged with the project's own code, inside the window", () => {
  const p = { id: "p1", code: "celo_mine" };
  const txs = [
    { status: "ok", timestamp: "2026-10-10T10:00:00Z", raw_input: CALL + suffix("celo_mine") },
    { status: "ok", timestamp: "2026-10-10T11:00:00Z", raw_input: CALL + suffix("celo_mine,minipay") },
    { status: "error", timestamp: "2026-10-10T12:00:00Z", raw_input: CALL + suffix("celo_mine") },
    { status: "ok", timestamp: "2026-10-10T13:00:00Z", raw_input: CALL + suffix("celo_other") },
    { status: "ok", timestamp: "2026-10-10T14:00:00Z", raw_input: CALL },
    { status: "ok", timestamp: "2026-10-01T10:00:00Z", raw_input: CALL + suffix("celo_mine") },
  ];
  const transfers = [
    { transaction_hash: "0x1", log_index: 1, timestamp: "2026-10-11T00:00:00Z", token: { address_hash: USDC }, total: { decimals: "6", value: "5000000" } },
    { transaction_hash: "0x1", log_index: 1, timestamp: "2026-10-11T00:00:00Z", token: { address_hash: USDC }, total: { decimals: "6", value: "5000000" } },
    { transaction_hash: "0x2", log_index: 0, timestamp: "2026-10-01T00:00:00Z", token: { address_hash: USDC }, total: { decimals: "6", value: "9000000" } },
  ];
  const out = summarizeProject(p, txs, transfers, "2026-10-06T12:00:00Z");
  assert.equal(out.tagged, 2);
  assert.equal(out.volumeUsd, 5, "duplicate transfer rows and pre-event transfers don't count");
  assert.deepEqual(out.days, { "2026-10-10": { tagged: 2, volumeUsd: 0 }, "2026-10-11": { tagged: 0, volumeUsd: 5 } });
});

test("loadActivity paginates until the window starts and reports failed wallets instead of zeroing them", async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes("0xbad")) return { ok: false, status: 429 };
    if (url.includes("/transactions") && !url.includes("block_number")) {
      return { ok: true, json: async () => ({ items: [{ status: "ok", timestamp: "2026-10-20T00:00:00Z", raw_input: CALL + suffix("celo_a") }], next_page_params: { block_number: 1 } }) };
    }
    if (url.includes("/transactions")) {
      return { ok: true, json: async () => ({ items: [{ status: "ok", timestamp: "2026-10-01T00:00:00Z", raw_input: CALL + suffix("celo_a") }], next_page_params: { block_number: 0 } }) };
    }
    return { ok: true, json: async () => ({ items: [], next_page_params: null }) };
  };
  const { activity, failed } = await loadActivity(
    [{ id: "a", code: "celo_a", agentWallet: "0xAAA" }, { id: "b", code: "celo_b", agentWallet: "0xbad" }],
    "2026-10-06T12:00:00Z",
    { fetchImpl: fake, concurrency: 2, retry: { retries: 1, baseDelay: 1 } },
  );
  assert.equal(activity.get("a").tagged, 1);
  assert.equal(activity.has("b"), false);
  assert.equal(failed, 1);
  assert.equal(calls.filter((u) => u.includes("0xaaa/transactions")).length, 2, "stops paging once items predate the window");
});

test("aggregate adds tagged txs and volume to totals, cities, tracks and days", () => {
  const payload = {
    counts: {},
    registrations: [
      { builderId: "a", city: "Salta", country: "Argentina", registeredAt: "2026-10-08T00:00:00Z" },
      { builderId: "b", city: "Rosario", country: "Argentina", registeredAt: "2026-10-08T00:00:00Z" },
    ],
    projects: [{ id: "p1", status: "submitted", builderIds: ["a", "b"], tracks: [{ bounty: "Build with buy · 5 winners" }], submittedAt: "2026-10-12T00:00:00Z" }],
  };
  const activity = new Map([["p1", { tagged: 7, volumeUsd: 12.5, days: { "2026-10-12": { tagged: 7, volumeUsd: 12.5 } } }]]);
  const out = aggregate(payload, activity);
  assert.equal(out.onchain, true);
  assert.equal(out.totals.taggedTxs, 7);
  assert.equal(out.totals.volumeUsd, 12.5);
  assert.equal(out.totals.projectsWithTaggedTx, 1);
  const salta = out.rankings.argentina.find((r) => r.label === "Salta");
  const rosario = out.rankings.argentina.find((r) => r.label === "Rosario");
  assert.equal(salta.tagged, 7);
  assert.equal(rosario.tagged, 7, "a multi-city team counts in each of its cities");
  assert.equal(out.byTrack[0].tagged, 7);
  assert.deepEqual(out.byDay.find((d) => d.day === "2026-10-12"), { day: "2026-10-12", registrations: 0, submitted: 1, tagged: 7, volumeUsd: 12.5 });
  assert.equal(aggregate(payload).onchain, false);
  assert.equal(aggregate(payload).totals.taggedTxs, 0);
});

test("CELO counts at its rate, unknown tokens never do; byToken and counterparties are reported", () => {
  const W = "0x00000000000000000000000000000000000000aa";
  const t = (hash, token, value, decimals, from, to) => ({ transaction_hash: hash, log_index: 0, timestamp: "2026-10-12T00:00:00Z", token: { address_hash: token, exchange_rate: "0.08" }, total: { decimals, value }, from: { hash: from }, to: { hash: to } });
  const CELO = "0x471ece3750da237f93b8e339c536989b8978a438";
  const out = summarizeProject({ id: "p", code: "c" }, [], [
    t("0x1", USDC, "3000000", "6", W, "0x00000000000000000000000000000000000000b1"),
    t("0x2", USDC, "1000000", "6", "0x00000000000000000000000000000000000000b2", W),
    t("0x3", USDC, "1000000", "6", "0x00000000000000000000000000000000000000b1", W),
    t("0x4", CELO, "100" + "0".repeat(18), "18", W, "0x00000000000000000000000000000000000000b3"),
    t("0x5", SPAM, "100" + "0".repeat(18), "18", W, "0x00000000000000000000000000000000000000b4"),
  ], "2026-10-06T00:00:00Z", W);
  assert.equal(out.volumeUsd, 13, "5 USDC + 100 CELO at 0.08; spam token ignored");
  assert.deepEqual(out.byToken, { USDC: 5, CELO: 8 });
  assert.equal(out.counterparties, 3, "only counterparties of counted transfers, deduplicated");
});

test("project leaderboard names only submitted projects, keeps only Loops House links, and sums drafts", () => {
  const payload = {
    counts: {},
    registrations: [],
    projects: [
      { id: "s1", status: "submitted", name: "Alpha", loopsUrl: "https://www.loops.house/p/alpha", agentWallet: "0xWALLET1", tracks: [{ bounty: "Build with buy · x" }] },
      { id: "s2", status: "submitted", name: "Beta", loopsUrl: "javascript:alert(1)", agentWallet: "0xWALLET2", tracks: [] },
      { id: "d1", status: "draft", name: null, agentWallet: "0xWALLET3", tracks: [] },
    ],
  };
  const activity = new Map([
    ["s1", { tagged: 2, volumeUsd: 10, byToken: { USDT: 10 }, counterparties: 3, days: {} }],
    ["s2", { tagged: 9, volumeUsd: 40, byToken: { wBRL: 40 }, counterparties: 1, days: {} }],
    ["d1", { tagged: 5, volumeUsd: 99, byToken: { USDC: 99 }, counterparties: 7, days: {} }],
  ]);
  const out = aggregate(payload, activity);
  assert.deepEqual(out.projects.submitted.map((p) => p.name), ["Beta", "Alpha"], "sorted by volume");
  assert.equal(out.projects.submitted[0].url, null, "non-Loops links are dropped");
  assert.equal(out.projects.submitted[1].url, "https://www.loops.house/p/alpha");
  assert.deepEqual(out.projects.drafts, { projects: 1, tagged: 5, volumeUsd: 99 });
  assert.deepEqual(out.byToken.map((t) => t.label), ["USDC", "wBRL", "USDT"]);
  assert.ok(!JSON.stringify(out).includes("0xWALLET"), "agent wallets never leave the server");
});

test("loadActivity retries a rate-limited request instead of dropping the wallet", async () => {
  let hits = 0;
  const fake = async (url) => {
    if (url.includes("/transactions") && hits++ === 0) return { ok: false, status: 429, headers: { get: () => null } };
    if (url.includes("/transactions")) return { ok: true, json: async () => ({ items: [{ status: "ok", timestamp: "2026-10-20T00:00:00Z", raw_input: CALL + suffix("celo_a") }], next_page_params: null }) };
    return { ok: true, json: async () => ({ items: [], next_page_params: null }) };
  };
  const { activity, failed } = await loadActivity([{ id: "a", code: "celo_a", agentWallet: "0xA" }], "2026-10-06T12:00:00Z", { fetchImpl: fake, retry: { retries: 2, baseDelay: 1 } });
  assert.equal(failed, 0);
  assert.equal(activity.get("a").tagged, 1);
});

test("concurrent requests share one scan; failed or partial scans are not reused", async () => {
  resetOnchainMemo();
  let scans = 0;
  const ok = async () => { scans++; return { status: 200, body: { failedWallets: 0 } }; };
  let t = 1_000_000;
  const clock = () => t;
  const [a, b] = await Promise.all([loadOnchainShared(ok, clock), loadOnchainShared(ok, clock)]);
  assert.equal(scans, 1);
  assert.equal(a, b);
  t += 9 * 60 * 1000;
  await loadOnchainShared(ok, clock);
  assert.equal(scans, 1, "reused within the memo window");
  t += 2 * 60 * 1000;
  await loadOnchainShared(ok, clock);
  assert.equal(scans, 2, "rescans after the window");

  resetOnchainMemo();
  let partial = 0;
  const flaky = async () => { partial++; return { status: 200, body: { failedWallets: 3 } }; };
  await loadOnchainShared(flaky);
  await loadOnchainShared(flaky);
  assert.equal(partial, 2, "a scan with unread wallets is retried next time");
  resetOnchainMemo();
});
