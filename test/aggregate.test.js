import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, normalizeCity, extractList, pathsFromEnv, UNKNOWN_CITY, OTHER_CITY } from "../lib/aggregate.js";
import { loadStats } from "../api/stats.js";

test("normalizeCity maps accents, aliases and free text to builder cities", () => {
  assert.equal(normalizeCity("Cordoba"), "Córdoba");
  assert.equal(normalizeCity("CABA"), "Buenos Aires");
  assert.equal(normalizeCity("Rosario, Santa Fe"), "Rosario");
  assert.equal(normalizeCity("San Salvador de Jujuy"), "Jujuy");
  assert.equal(normalizeCity("Montevideo"), OTHER_CITY);
  assert.equal(normalizeCity(""), UNKNOWN_CITY);
  assert.equal(normalizeCity(null), UNKNOWN_CITY);
});

test("extractList finds the array under common wrappers", () => {
  assert.equal(extractList([{ a: 1 }]).length, 1);
  assert.equal(extractList({ submissions: [{}, {}] }).length, 2);
  assert.equal(extractList({ data: { projects: [{}] } }).length, 1);
  assert.equal(extractList({ nothing: true }).length, 0);
});

test("aggregate counts by city, keeps zero-count builder cities, and reports unmatched fields", () => {
  const out = aggregate({
    submissions: [
      { city: "Córdoba", track: "Build with buy", submittedAt: "2026-10-10T10:00:00Z" },
      { location: { city: "cordoba" }, track: "Build with buy", createdAt: "2026-10-10T12:00:00Z" },
      { city: "Lima", track: "Stable Agents: LatAm" },
      { track: "Stable Agents: LatAm", submittedAt: "2026-10-11T00:00:00Z" },
    ],
  });
  assert.equal(out.total, 4);
  const city = Object.fromEntries(out.byCity.map((c) => [c.label, c.count]));
  assert.equal(city["Córdoba"], 2);
  assert.equal(city["Salta"], 0, "builder cities with no entries still show");
  assert.equal(city[OTHER_CITY], 1);
  assert.equal(city[UNKNOWN_CITY], 1);
  assert.deepEqual(out.byDay, [{ day: "2026-10-10", count: 2 }, { day: "2026-10-11", count: 1 }]);
  assert.deepEqual(out.byCity.slice(-2).map((c) => c.label).sort(), [OTHER_CITY, UNKNOWN_CITY].sort(), "non-builder buckets sort last");
  assert.equal(out.unmatchedFields.city, 1);
  assert.equal(out.unmatchedFields.date, 1);
  assert.equal(out.byTrack[0].count, 2);
});

test("env overrides replace field paths", () => {
  const paths = pathsFromEnv({ LOOPS_FIELD_CITY: "meta.where" });
  const out = aggregate([{ meta: { where: "Salta" } }], paths);
  assert.equal(out.byCity.find((c) => c.label === "Salta").count, 1);
});

test("loadStats without a key returns labelled sample data and makes no request", async () => {
  let called = false;
  const { status, body } = await loadStats({}, async () => { called = true; });
  assert.equal(status, 200);
  assert.equal(body.sample, true);
  assert.ok(body.total > 0);
  assert.equal(called, false);
});

test("loadStats sends the key server-side as a bearer token and returns only counts", async () => {
  let seen;
  const fake = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ({ submissions: [{ city: "Rosario", email: "secret@example.com" }] }) };
  };
  const { status, body } = await loadStats({ LOOPS_API_KEY: "k123" }, fake);
  assert.equal(status, 200);
  assert.equal(seen.opts.headers.Authorization, "Bearer k123");
  assert.equal(body.sample, false);
  assert.equal(body.total, 1);
  assert.ok(!JSON.stringify(body).includes("secret@example.com"), "raw submission fields never reach the response");
  assert.ok(!JSON.stringify(body).includes("k123"), "the key never reaches the response");
});

test("loadStats maps a rejected key to a clear error without leaking it", async () => {
  const { status, body } = await loadStats({ LOOPS_API_KEY: "bad" }, async () => ({ ok: false, status: 401 }));
  assert.equal(status, 502);
  assert.match(body.error, /rejected the API key/);
  assert.ok(!JSON.stringify(body).includes("bad"));
});
