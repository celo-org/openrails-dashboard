import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, normalizeCity, trackName, UNKNOWN_CITY, OTHER_CITY } from "../lib/aggregate.js";
import { loadStats } from "../api/stats.js";

// Same shape as the live Loops House payload (fields observed 2026-10-22), synthetic values.
const fixture = () => ({
  event: { name: "Agents on Open Rails", submissionDeadline: "2026-11-09T09:00:00.000Z", slug: "x" },
  counts: { registrations: 5, projects: 2, submitted: 1, participants: 3 },
  registrations: [
    { builderId: "a", registeredAt: "2026-10-08T10:00:00Z", city: "San Salvador de Jujuy", country: "Argentina", projectId: "p1" },
    { builderId: "b", registeredAt: "2026-10-08T12:00:00Z", city: "Córdoba", country: "Argentina", projectId: "p1" },
    { builderId: "c", registeredAt: "2026-10-09T09:00:00Z", city: "Lagos", country: "Nigeria", projectId: "p2" },
    { builderId: "d", registeredAt: "2026-10-09T09:00:00Z", city: "Cordoba", country: "Argentina", projectId: null },
    { builderId: "e", registeredAt: "2026-10-10T09:00:00Z", city: null, country: null, projectId: null },
  ],
  projects: [
    {
      id: "p1", name: "Secret Name", agentWallet: "0xWALLET", repoUrl: "https://github.com/x/y", status: "submitted",
      tracks: [
        { sponsor: "Stable Agents: LatAm | Ripio x Celo Core Co", bounty: "Stable Agents: LatAm · 1st place" },
        { sponsor: "Stable Agents: LatAm | Ripio x Celo Core Co", bounty: "Stable Agents: LatAm · 2nd place" },
      ],
      builderIds: ["a", "b"], hasIdentity: true, firstTaggedTx: "0xabc", submittedAt: "2026-10-12T00:00:00Z",
    },
    { id: "p2", status: "draft", tracks: [], builderIds: ["c"], hasIdentity: null, firstTaggedTx: null, repoUrl: null, submittedAt: null },
  ],
});

test("normalizeCity maps accents, aliases and free text to builder cities", () => {
  assert.equal(normalizeCity("Cordoba"), "Córdoba");
  assert.equal(normalizeCity("CABA"), "Buenos Aires");
  assert.equal(normalizeCity("San Salvador de Jujuy"), "Jujuy");
  assert.equal(normalizeCity("Rosario, Santa Fe"), "Rosario");
  assert.equal(normalizeCity("Lagos"), OTHER_CITY);
  assert.equal(normalizeCity(null), UNKNOWN_CITY);
});

test("trackName drops the bounty place suffix", () => {
  assert.equal(trackName({ bounty: "Open Corridors: Textile FX · 2nd place" }), "Open Corridors: Textile FX");
  assert.equal(trackName({ sponsor: "Build with buy" }), "Build with buy");
  assert.equal(trackName({}), "No track");
});

test("aggregate counts registrations by city and projects in each builder's city", () => {
  const out = aggregate(fixture());
  const city = Object.fromEntries(out.byCity.map((c) => [c.label, c]));
  assert.equal(city["Córdoba"].registrations, 2, "accented and unaccented Córdoba merge");
  assert.equal(city["Jujuy"].registrations, 1);
  assert.equal(city["Jujuy"].projects, 1, "a team spanning two cities counts in both");
  assert.equal(city["Córdoba"].submitted, 1);
  assert.equal(city["Salta"].registrations, 0, "builder cities with no entries still show");
  assert.equal(city[OTHER_CITY].projects, 1);
  assert.equal(city[UNKNOWN_CITY].registrations, 1);
  assert.deepEqual(out.byCity.slice(-2).map((c) => c.label).sort(), [OTHER_CITY, UNKNOWN_CITY].sort(), "non-builder buckets sort last");
  assert.equal(out.unmatched.registrationsWithoutCity, 1);
});

test("aggregate counts each track once per project and reports readiness", () => {
  const out = aggregate(fixture());
  assert.deepEqual(out.byTrack, [
    { label: "Stable Agents: LatAm", projects: 1, submitted: 1 },
    { label: "No track", projects: 1, submitted: 0 },
  ]);
  assert.deepEqual(out.readiness, { projects: 2, withIdentity: 1, withTaggedTx: 1, withRepo: 1 });
  assert.deepEqual(out.totals, { registrations: 5, projects: 2, submitted: 1, countries: 2 });
  assert.deepEqual(out.byDay.find((d) => d.day === "2026-10-12"), { day: "2026-10-12", registrations: 0, submitted: 1 });
});

test("topOtherCities only lists cities with 3+ registrations", () => {
  const f = fixture();
  f.registrations.push(
    { builderId: "x1", city: "Lagos", country: "Nigeria" },
    { builderId: "x2", city: "Lagos", country: "Nigeria" },
    { builderId: "x3", city: "Lima", country: "Peru" },
  );
  const out = aggregate(f);
  assert.deepEqual(out.topOtherCities, [{ label: "Lagos", country: "Nigeria", count: 3 }]);
});

test("rankings: Argentina keeps builder cities, world needs 3+ registrations", () => {
  const f = fixture();
  f.registrations.push(
    { builderId: "l1", city: "Lagos", country: "Nigeria", projectId: "p2" },
    { builderId: "l2", city: "Lagos", country: "Nigeria" },
    { builderId: "m1", city: "Mendoza", country: "Argentina" },
  );
  f.projects[1].builderIds.push("l1");
  const { argentina, world } = aggregate(f).rankings;
  assert.equal(argentina[0].label, "Córdoba");
  assert.deepEqual(argentina[0], { label: "Córdoba", country: "Argentina", registrations: 2, projects: 1, submitted: 1 });
  assert.ok(argentina.some((r) => r.label === "Mar del Plata" && r.registrations === 0), "builder cities always listed");
  assert.ok(!argentina.some((r) => r.label === "Mendoza"), "other Argentine cities need 3+");
  assert.deepEqual(world, [{ label: "Lagos", country: "Nigeria", registrations: 3, projects: 1, submitted: 0 }], "a project counts once per city");
});

test("aggregate output never contains names, wallets, repos or builder ids", () => {
  const s = JSON.stringify(aggregate(fixture()));
  for (const secret of ["Secret Name", "0xWALLET", "github.com/x/y", "0xabc", '"a"', "builderId"]) {
    assert.ok(!s.includes(secret), `leaked ${secret}`);
  }
});

test("loadStats without a key returns labelled sample data and makes no request", async () => {
  let called = false;
  const { status, body } = await loadStats({}, async () => { called = true; });
  assert.equal(status, 200);
  assert.equal(body.sample, true);
  assert.ok(body.totals.registrations > 0);
  assert.equal(called, false);
});

test("loadStats sends the key as a bearer token and returns only counts", async () => {
  let seen;
  const fake = async (url, opts) => {
    seen = opts;
    return { ok: true, status: 200, json: async () => fixture() };
  };
  const { status, body } = await loadStats({ LOOPS_API_KEY: "k123" }, fake);
  assert.equal(status, 200);
  assert.equal(seen.headers.Authorization, "Bearer k123");
  assert.equal(body.sample, false);
  const s = JSON.stringify(body);
  assert.ok(!s.includes("k123") && !s.includes("0xWALLET"));
});

test("loadStats maps a rejected key to a clear error without leaking it", async () => {
  const { status, body } = await loadStats({ LOOPS_API_KEY: "bad-key-xyz" }, async () => ({ ok: false, status: 401 }));
  assert.equal(status, 502);
  assert.match(body.error, /rejected the API key/);
  assert.ok(!JSON.stringify(body).includes("bad-key-xyz"));
});
