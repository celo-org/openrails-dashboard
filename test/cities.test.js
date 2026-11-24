import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateCities, cityKey, OTHER_CITIES, NO_CITY } from "../lib/cities.js";

const reg = (id, city, country = "X", at = "2026-11-21T10:00:00Z") => ({ builderId: id, city, country, registeredAt: at });
const track = (name) => ({ sponsor: name, bounty: `${name} · 1st place` });

const payload = () => ({
  event: { name: "Test", startsAt: "2026-11-20T14:00:00Z", submissionDeadline: "2026-12-07T09:00:00Z", slug: "x" },
  counts: {},
  registrations: [
    reg("a1", "Lagos", "Nigeria"), reg("a2", "lagos", "Nigeria"), reg("a3", "Lagos, Nigeria", "Nigeria"),
    reg("b1", "San Salvador de Jujuy", "Argentina"), reg("b2", "Jujuy", "Argentina"), reg("b3", "JUJUY", "Argentina"),
    reg("c1", "Lima", "Peru"), reg("c2", "Lima", "Peru"),
    reg("d1", null, null),
  ],
  projects: [
    { id: "p1", name: "Alpha", status: "submitted", loopsUrl: "https://www.loops.house/x/alpha", agentWallet: "0xWALLET1", builderIds: ["a1", "b1"], tracks: [track("Agent Wallets"), track("Agent Wallets")], submittedAt: "2026-11-22T00:00:00Z" },
    { id: "p2", name: "Beta", status: "submitted", builderIds: ["a2"], tracks: [track("Stablecoin Corridors")], submittedAt: "2026-11-23T00:00:00Z" },
    { id: "p3", name: null, status: "draft", builderIds: ["c1"], tracks: [track("Agent Wallets")] },
  ],
});

test("cityKey groups spellings, aliases and 'City, Region' forms", () => {
  assert.equal(cityKey("Lagos, Nigeria").key, cityKey("lagos").key);
  assert.equal(cityKey("San Salvador de Jujuy").label, "Jujuy");
  assert.equal(cityKey("CABA").label, "Buenos Aires");
  assert.equal(cityKey("  Córdoba ").label, "Córdoba");
  assert.equal(cityKey(""), null);
  assert.equal(cityKey(null), null);
});

test("cities rank by submissions; a multi-city team counts in each city", () => {
  const out = aggregateCities(payload());
  const by = Object.fromEntries(out.cities.map((c) => [c.label, c]));
  assert.equal(by["Lagos"].builders, 3);
  assert.equal(by["Lagos"].submitted, 2);
  assert.equal(by["Lagos"].country, "Nigeria");
  assert.equal(by["Jujuy"].builders, 3);
  assert.equal(by["Jujuy"].submitted, 1, "p1 has a builder in Lagos and one in Jujuy");
  assert.deepEqual(out.cities.map((c) => c.label), ["Lagos", "Jujuy", OTHER_CITIES, NO_CITY], "named cities first, by submissions");
});

test("cities under the privacy floor are only counted inside 'Other cities'", () => {
  const out = aggregateCities(payload());
  assert.ok(!out.cities.some((c) => c.label === "Lima"));
  const other = out.cities.find((c) => c.label === OTHER_CITIES);
  assert.equal(other.builders, 2);
  assert.equal(other.projects, 1);
  assert.equal(other.named, false);
  assert.equal(out.totals.cities, 3, "the city count still includes every distinct city");
});

test("city x track counts submitted projects once per track, and each track names its top city", () => {
  const out = aggregateCities(payload());
  const lagos = out.cities.find((c) => c.label === "Lagos");
  assert.deepEqual(lagos.tracks, { "Agent Wallets": 1, "Stablecoin Corridors": 1 });
  const aw = out.byTrack.find((t) => t.label === "Agent Wallets");
  assert.equal(aw.projects, 2);
  assert.equal(aw.submitted, 1);
  assert.ok(["Lagos", "Jujuy"].includes(aw.topCity.label));
});

test("on-chain activity flows into cities, totals, days and the project leaderboard without leaking wallets", () => {
  const activity = new Map([
    ["p1", { tagged: 4, volumeUsd: 100, byToken: { USDT: 100 }, counterparties: 5, days: { "2026-11-22": { tagged: 4, volumeUsd: 100 } } }],
    ["p3", { tagged: 2, volumeUsd: 7, byToken: { USDC: 7 }, counterparties: 1, days: {} }],
  ]);
  const out = aggregateCities(payload(), activity);
  assert.equal(out.onchain, true);
  assert.equal(out.totals.taggedTxs, 6);
  assert.equal(out.totals.volumeUsd, 107);
  assert.equal(out.cities.find((c) => c.label === "Jujuy").volumeUsd, 100);
  assert.equal(out.cities.find((c) => c.label === "Lagos").volumeUsd, 100);
  assert.deepEqual(out.projects.submitted.map((p) => p.name), ["Alpha", "Beta"]);
  assert.deepEqual(out.projects.drafts, { projects: 1, tagged: 2, volumeUsd: 7 });
  assert.deepEqual(out.byDay.find((d) => d.day === "2026-11-22"), { day: "2026-11-22", registrations: 0, submitted: 1, tagged: 4, volumeUsd: 100 });
  const s = JSON.stringify(out);
  assert.ok(!s.includes("0xWALLET") && !s.includes('"a1"') && !s.includes("builderId"));
});
