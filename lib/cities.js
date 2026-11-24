// City competition for any hackathon: which cities register, ship, transact and
// move volume, and which tracks each city goes for.
//
// Payload shape is the Loops House event API (see lib/aggregate.js). `activity`
// (optional) maps project id -> { tagged, volumeUsd, byToken, counterparties, days }.
// A project counts once in each city its builders registered from.
// Privacy: a city is named only when MIN_GROUP or more builders registered there;
// smaller ones are summed into "Other cities". Only counts leave this module.

import { trackName } from "./aggregate.js";

export const MIN_GROUP = 3;
export const OTHER_CITIES = "Other cities";
export const NO_CITY = "No city";

const strip = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Spellings of one city that registrants type differently. Keys are stripped.
const ALIASES = new Map([
  ["caba", "Buenos Aires"],
  ["ciudad de buenos aires", "Buenos Aires"],
  ["ciudad autonoma de buenos aires", "Buenos Aires"],
  ["capital federal", "Buenos Aires"],
  ["bsas", "Buenos Aires"],
  ["buenos aires", "Buenos Aires"],
  ["san salvador de jujuy", "Jujuy"],
  ["jujuy", "Jujuy"],
  ["cordoba", "Córdoba"],
  ["mdp", "Mar del Plata"],
  ["bangalore", "Bengaluru"],
  ["bengaluru", "Bengaluru"],
  ["new delhi", "Delhi"],
  ["delhi", "Delhi"],
  ["sao paulo", "São Paulo"],
  ["bogota", "Bogotá"],
  ["ciudad de mexico", "Mexico City"],
  ["cdmx", "Mexico City"],
  ["mexico city", "Mexico City"],
  ["nyc", "New York"],
  ["new york city", "New York"],
]);

// Groups spellings of a city: returns { key, label } or null when no city was given.
export function cityKey(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  let s = strip(raw);
  // "Rosario, Santa Fe" / "Lagos - Nigeria" -> first part
  s = s.split(/\s*[,/|-]\s*/)[0] || s;
  const alias = ALIASES.get(s);
  if (alias) return { key: strip(alias), label: alias };
  return { key: s, label: null };
}

const mostCommon = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
const titleCase = (s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

const NO_ACTIVITY = { tagged: 0, volumeUsd: 0, byToken: {}, counterparties: 0, days: {} };
const day = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

export function aggregateCities(payload, activity = null, { minGroup = MIN_GROUP } = {}) {
  const regs = Array.isArray(payload?.registrations) ? payload.registrations : [];
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const act = (p) => activity?.get(p.id) ?? NO_ACTIVITY;
  const tracksOf = (p) => [...new Set((p.tracks ?? []).map(trackName))];
  const allTracks = [...new Set(projects.flatMap(tracksOf))].sort();

  // 1. Group registrations into cities.
  const raw = new Map(); // key -> { spellings, countries, builders }
  const keyOfBuilder = new Map();
  for (const r of regs) {
    const k = cityKey(r.city);
    const key = k ? k.key : NO_CITY;
    const c = raw.get(key) ?? { aliasLabel: k?.label ?? null, spellings: new Map(), countries: new Map(), builders: 0 };
    c.builders += 1;
    if (k) c.spellings.set(String(r.city).trim(), (c.spellings.get(String(r.city).trim()) ?? 0) + 1);
    if (r.country) c.countries.set(r.country, (c.countries.get(r.country) ?? 0) + 1);
    raw.set(key, c);
    if (r.builderId) keyOfBuilder.set(r.builderId, key);
  }
  // Cities under the privacy floor collapse into one bucket.
  const bucketOf = (key) => {
    if (key === NO_CITY) return NO_CITY;
    return (raw.get(key)?.builders ?? 0) >= minGroup ? key : OTHER_CITIES;
  };

  const rows = new Map();
  const row = (bucket) => {
    if (!rows.has(bucket)) {
      const c = raw.get(bucket);
      const label = bucket === NO_CITY || bucket === OTHER_CITIES ? bucket : c.aliasLabel ?? titleCase(mostCommon(c.spellings) ?? bucket);
      rows.set(bucket, {
        label,
        country: c ? mostCommon(c.countries) : null,
        named: bucket !== NO_CITY && bucket !== OTHER_CITIES,
        builders: 0,
        projects: 0,
        submitted: 0,
        tagged: 0,
        volumeUsd: 0,
        tracks: Object.fromEntries(allTracks.map((t) => [t, 0])),
      });
    }
    return rows.get(bucket);
  };
  for (const [key, c] of raw) row(bucketOf(key)).builders += c.builders;

  // 2. Projects count in each city their builders registered from.
  for (const p of projects) {
    const buckets = new Set((p.builderIds ?? []).map((b) => bucketOf(keyOfBuilder.get(b) ?? NO_CITY)));
    if (buckets.size === 0) buckets.add(NO_CITY);
    const a = act(p);
    for (const b of buckets) {
      const r = row(b);
      r.projects += 1;
      r.tagged += a.tagged;
      r.volumeUsd += a.volumeUsd;
      if (p.status === "submitted") {
        r.submitted += 1;
        for (const t of tracksOf(p)) r.tracks[t] += 1;
      }
    }
  }
  const cities = [...rows.values()].sort(
    (a, b) => Number(b.named) - Number(a.named) || b.submitted - a.submitted || b.builders - a.builders || a.label.localeCompare(b.label),
  );

  // 3. Tracks, with the city that sent the most submissions to each.
  const byTrack = allTracks.map((t) => {
    const ps = projects.filter((p) => tracksOf(p).includes(t));
    const top = cities.filter((c) => c.named && c.tracks[t] > 0).sort((a, b) => b.tracks[t] - a.tracks[t])[0];
    return {
      label: t,
      projects: ps.length,
      submitted: ps.filter((p) => p.status === "submitted").length,
      tagged: ps.reduce((n, p) => n + act(p).tagged, 0),
      volumeUsd: ps.reduce((n, p) => n + act(p).volumeUsd, 0),
      topCity: top ? { label: top.label, submitted: top.tracks[t] } : null,
    };
  });

  // 4. Daily participation.
  const days = new Map();
  const bump = (d, k, by = 1) => {
    if (!d) return;
    const r = days.get(d) ?? { day: d, registrations: 0, submitted: 0, tagged: 0, volumeUsd: 0 };
    r[k] += by;
    days.set(d, r);
  };
  for (const r of regs) bump(day(r.registeredAt), "registrations");
  for (const p of projects) {
    if (p.status === "submitted") bump(day(p.submittedAt), "submitted");
    for (const [d, v] of Object.entries(act(p).days ?? {})) {
      if (v.tagged) bump(d, "tagged", v.tagged);
      if (v.volumeUsd) bump(d, "volumeUsd", v.volumeUsd);
    }
  }

  // 5. Volume by currency and the project leaderboard (submitted projects only: drafts have no public name).
  const tokens = new Map();
  for (const p of projects) for (const [sym, usd] of Object.entries(act(p).byToken ?? {})) tokens.set(sym, (tokens.get(sym) ?? 0) + usd);
  const projectRows = [];
  const drafts = { projects: 0, tagged: 0, volumeUsd: 0 };
  for (const p of projects) {
    const a = act(p);
    if (p.status === "submitted" && p.name) {
      projectRows.push({
        name: p.name,
        url: typeof p.loopsUrl === "string" && /^https:\/\/(www\.)?loops\.house\//.test(p.loopsUrl) ? p.loopsUrl : null,
        tracks: tracksOf(p),
        tagged: a.tagged,
        volumeUsd: a.volumeUsd,
        counterparties: a.counterparties ?? 0,
      });
    } else {
      drafts.projects += 1;
      drafts.tagged += a.tagged;
      drafts.volumeUsd += a.volumeUsd;
    }
  }
  projectRows.sort((a, b) => b.volumeUsd - a.volumeUsd || b.tagged - a.tagged || a.name.localeCompare(b.name));

  const countries = new Set(regs.map((r) => r.country).filter(Boolean));
  return {
    event: payload?.event
      ? { name: payload.event.name, startsAt: payload.event.startsAt, submissionDeadline: payload.event.submissionDeadline }
      : null,
    onchain: activity != null,
    totals: {
      builders: payload?.counts?.registrations ?? regs.length,
      projects: payload?.counts?.projects ?? projects.length,
      submitted: payload?.counts?.submitted ?? projects.filter((p) => p.status === "submitted").length,
      countries: countries.size,
      cities: [...raw.keys()].filter((k) => k !== NO_CITY).length,
      taggedTxs: projects.reduce((n, p) => n + act(p).tagged, 0),
      volumeUsd: projects.reduce((n, p) => n + act(p).volumeUsd, 0),
      projectsWithTaggedTx: projects.filter((p) => act(p).tagged > 0).length,
    },
    tracks: allTracks,
    cities,
    byTrack,
    byDay: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byToken: [...tokens.entries()].map(([label, volumeUsd]) => ({ label, volumeUsd })).sort((a, b) => b.volumeUsd - a.volumeUsd),
    projects: activity ? { submitted: projectRows, drafts } : null,
  };
}
