import { test } from "node:test";
import assert from "node:assert/strict";
import { hackathonStatus, loadEvent } from "../lib/event-data.js";
import { loadEventStats } from "../api/event.js";
import { getHackathon } from "../lib/hackathons.js";

const event = { startsAt: "2026-11-20T14:00:00Z", submissionDeadline: "2026-12-07T09:00:00Z" };

test("hackathonStatus: upcoming before start, live until the deadline, final after", () => {
  assert.equal(hackathonStatus(event, Date.parse("2026-11-19T00:00:00Z")), "upcoming");
  assert.equal(hackathonStatus(event, Date.parse("2026-11-24T00:00:00Z")), "live");
  assert.equal(hackathonStatus(event, Date.parse("2026-12-08T00:00:00Z")), "final");
  assert.equal(hackathonStatus(null), "live");
});

test("unknown hackathon slugs are rejected before any request", async () => {
  let called = false;
  const r = await loadEventStats("../../etc", { env: { LOOPS_API_KEY: "k" }, fetchImpl: async () => { called = true; } });
  assert.equal(r.status, 404);
  assert.equal(called, false);
});

test("loadEvent asks Loops House for the hackathon's own slug and shares one scan between concurrent on-chain requests", async () => {
  const seen = [];
  let scans = 0;
  const payload = { event, counts: {}, registrations: [], projects: [{ id: "p", code: "celo_p", agentWallet: "0xA", status: "draft" }] };
  const fake = async (url) => {
    seen.push(String(url));
    if (String(url).includes("loops.house")) return { ok: true, status: 200, json: async () => payload };
    if (String(url).includes("/transactions")) scans++;
    return { ok: true, json: async () => ({ items: [], next_page_params: null }) };
  };
  const h = getHackathon("agents-open-for-business");
  const env = { LOOPS_API_KEY: "k" };
  await Promise.all([loadEvent(h, { onchain: true, env, fetchImpl: fake }), loadEvent(h, { onchain: true, env, fetchImpl: fake })]);
  assert.ok(seen.some((u) => u.endsWith("/api/v1/celo/agents-open-for-business")));
  assert.equal(scans, 1, "the second request reused the in-flight scan");
});

test("event stats never expose wallets or builder ids", async () => {
  const payload = {
    event,
    counts: {},
    registrations: [{ builderId: "secret-builder", city: "Lagos", country: "Nigeria" }],
    projects: [{ id: "p", name: "P", status: "submitted", agentWallet: "0xWALLETXYZ", builderIds: ["secret-builder"], tracks: [] }],
  };
  const fake = async () => ({ ok: true, status: 200, json: async () => payload });
  const r = await loadEventStats("agents-on-open-rails", { env: { LOOPS_API_KEY: "k" }, fetchImpl: fake });
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body);
  assert.ok(!s.includes("0xWALLETXYZ") && !s.includes("secret-builder") && !s.includes('"k"'));
});
