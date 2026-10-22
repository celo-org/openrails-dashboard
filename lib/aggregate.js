// Turns raw Loops House submissions into the counts the dashboard shows.
// The API schema is not published yet, so field lookup is tolerant: each
// field tries a list of candidate paths, overridable with env vars.

export const BUILDER_CITIES = [
  "Buenos Aires",
  "Córdoba",
  "Rosario",
  "Mar del Plata",
  "Salta",
  "Jujuy",
];

export const UNKNOWN_CITY = "No city";
export const OTHER_CITY = "Other cities";

const DEFAULT_PATHS = {
  city: ["city", "location.city", "team.city", "builder.city", "location"],
  country: ["country", "location.country", "team.country", "builder.country"],
  track: ["track", "primaryTrack", "primary_track", "tracks.0", "category"],
  date: ["submittedAt", "submitted_at", "createdAt", "created_at", "date"],
};

function strip(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function get(obj, path) {
  return path.split(".").reduce((v, k) => (v == null ? undefined : v[k]), obj);
}

function pick(obj, paths) {
  for (const p of paths) {
    const v = get(obj, p);
    if (v != null && v !== "") return typeof v === "object" ? v.name ?? v.title ?? null : v;
  }
  return null;
}

export function pathsFromEnv(env = {}) {
  const out = { ...DEFAULT_PATHS };
  for (const key of Object.keys(DEFAULT_PATHS)) {
    const override = env[`LOOPS_FIELD_${key.toUpperCase()}`];
    if (override) out[key] = override.split(",").map((s) => s.trim());
  }
  return out;
}

const CITY_ALIASES = new Map([
  ["caba", "Buenos Aires"],
  ["ciudad de buenos aires", "Buenos Aires"],
  ["ciudad autonoma de buenos aires", "Buenos Aires"],
  ["bsas", "Buenos Aires"],
  ["mdp", "Mar del Plata"],
  ["san salvador de jujuy", "Jujuy"],
]);

export function normalizeCity(raw) {
  if (raw == null || String(raw).trim() === "") return UNKNOWN_CITY;
  const s = strip(String(raw));
  if (CITY_ALIASES.has(s)) return CITY_ALIASES.get(s);
  for (const city of BUILDER_CITIES) {
    if (s === strip(city) || s.startsWith(strip(city) + ",") || s.includes(strip(city))) return city;
  }
  return OTHER_CITY;
}

export function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  for (const k of ["submissions", "projects", "entries", "data", "items", "results"]) {
    const v = payload?.[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const inner = extractList(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

function countBy(items, fn) {
  const m = new Map();
  for (const it of items) {
    const k = fn(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function aggregate(payload, paths = DEFAULT_PATHS) {
  const list = extractList(payload);
  const rows = list.map((s) => ({
    city: normalizeCity(pick(s, paths.city)),
    country: pick(s, paths.country) ?? "No country",
    track: pick(s, paths.track) ?? "No track",
    date: pick(s, paths.date),
  }));

  // Every builder city appears, even at zero, so a city with no entries is visible.
  const cityCounts = new Map(BUILDER_CITIES.map((c) => [c, 0]));
  for (const r of rows) cityCounts.set(r.city, (cityCounts.get(r.city) ?? 0) + 1);
  const byCity = [...cityCounts.entries()]
    .map(([label, count]) => ({ label, count, builderCity: BUILDER_CITIES.includes(label) }))
    .filter((c) => c.builderCity || c.count > 0)
    .sort((a, b) => Number(b.builderCity) - Number(a.builderCity) || b.count - a.count || a.label.localeCompare(b.label));

  const days = new Map();
  for (const r of rows) {
    const d = r.date ? new Date(r.date) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  const byDay = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count }));

  return {
    total: rows.length,
    byCity,
    byTrack: countBy(rows, (r) => String(r.track)),
    byCountry: countBy(rows, (r) => String(r.country)),
    byDay,
    unmatchedFields: {
      city: rows.filter((r) => r.city === UNKNOWN_CITY).length,
      date: rows.length - byDay.reduce((n, d) => n + d.count, 0),
    },
  };
}
