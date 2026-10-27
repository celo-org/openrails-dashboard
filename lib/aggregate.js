// Turns the Loops House event payload into the counts the dashboard shows.
// Payload shape (GET /api/v1/celo/agents-on-open-rails):
//   counts        { registrations, projects, submitted, participants }
//   registrations [{ builderId, registeredAt, city, country, projectId }]
//   projects      [{ id, status: "draft"|"submitted", tracks: [{ sponsor, bounty }],
//                    builderIds, hasIdentity, firstTaggedTx, registeredAt, submittedAt, ... }]
//
// `activity` (optional, from lib/onchain.js) maps project id -> { tagged, volumeUsd, days }
// and adds attribution-tagged tx counts and payment volume to every breakdown.
// Only counts leave this module: no names, wallets, repos or builder ids.

export const BUILDER_CITIES = ["Buenos Aires", "Córdoba", "Rosario", "Mar del Plata", "Salta", "Jujuy"];
export const UNKNOWN_CITY = "No city";
export const OTHER_CITY = "Other cities";
export const MIN_GROUP = 3;

function strip(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const CITY_ALIASES = new Map([
  ["caba", "Buenos Aires"],
  ["ciudad de buenos aires", "Buenos Aires"],
  ["ciudad autonoma de buenos aires", "Buenos Aires"],
  ["bsas", "Buenos Aires"],
  ["mdp", "Mar del Plata"],
  ["san salvador de jujuy", "Jujuy"],
  ["salta capital", "Salta"],
]);

export function normalizeCity(raw) {
  if (raw == null || String(raw).trim() === "") return UNKNOWN_CITY;
  const s = strip(String(raw));
  if (CITY_ALIASES.has(s)) return CITY_ALIASES.get(s);
  for (const city of BUILDER_CITIES) if (s.includes(strip(city))) return city;
  return OTHER_CITY;
}

// "Stable Agents: LatAm · 1st place" -> "Stable Agents: LatAm"
export function trackName(t) {
  const raw = t?.bounty || t?.sponsor || "";
  return raw.split(" · ")[0].trim() || "No track";
}

function day(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function inc(map, key, field, by = 1) {
  const row = map.get(key) ?? { registrations: 0, projects: 0, submitted: 0, tagged: 0, volumeUsd: 0 };
  row[field] += by;
  map.set(key, row);
}

const NO_ACTIVITY = { tagged: 0, volumeUsd: 0, byToken: {}, counterparties: 0, days: {} };

export function aggregate(payload, activity = null) {
  const regs = Array.isArray(payload?.registrations) ? payload.registrations : [];
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const act = (p) => activity?.get(p.id) ?? NO_ACTIVITY;

  // Cities: registrations by their own city; a project counts once in each
  // city its builders registered from.
  const cities = new Map(BUILDER_CITIES.map((c) => [c, { registrations: 0, projects: 0, submitted: 0 }]));
  const cityOfBuilder = new Map();
  for (const r of regs) {
    const c = normalizeCity(r.city);
    inc(cities, c, "registrations");
    if (r.builderId) cityOfBuilder.set(r.builderId, c);
  }
  for (const p of projects) {
    const pc = new Set((p.builderIds ?? []).map((b) => cityOfBuilder.get(b) ?? UNKNOWN_CITY));
    if (pc.size === 0) pc.add(UNKNOWN_CITY);
    for (const c of pc) {
      inc(cities, c, "projects");
      if (p.status === "submitted") inc(cities, c, "submitted");
    }
  }
  const byCity = [...cities.entries()]
    .map(([label, v]) => ({ label, ...v, builderCity: BUILDER_CITIES.includes(label) }))
    .filter((c) => c.builderCity || c.registrations + c.projects > 0)
    .sort((a, b) => Number(b.builderCity) - Number(a.builderCity) || b.registrations - a.registrations || a.label.localeCompare(b.label));

  // Tracks: a project entering both the 1st and 2nd place bounty of a track counts once.
  const tracks = new Map();
  for (const p of projects) {
    const names = new Set((p.tracks ?? []).map(trackName));
    if (names.size === 0) names.add("No track");
    for (const n of names) {
      inc(tracks, n, "projects");
      if (p.status === "submitted") inc(tracks, n, "submitted");
      inc(tracks, n, "tagged", act(p).tagged);
      inc(tracks, n, "volumeUsd", act(p).volumeUsd);
    }
  }
  const byTrack = [...tracks.entries()]
    .map(([label, v]) => ({ label, projects: v.projects, submitted: v.submitted, tagged: v.tagged, volumeUsd: v.volumeUsd }))
    .sort((a, b) => (a.label === "No track") - (b.label === "No track") || b.projects - a.projects || a.label.localeCompare(b.label));

  // Largest cities outside the builder list, only when 3+ people registered there,
  // so no single builder is identifiable from the page.
  const outside = new Map();
  for (const r of regs) {
    if (normalizeCity(r.city) !== OTHER_CITY) continue;
    const k = `${String(r.city).trim()}|${r.country ?? ""}`;
    outside.set(k, (outside.get(k) ?? 0) + 1);
  }
  const topOtherCities = [...outside.entries()]
    .filter(([, n]) => n >= MIN_GROUP)
    .map(([k, count]) => ({ label: k.split("|")[0], country: k.split("|")[1] || null, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 8);

  // Rankings. Argentina: the six builder cities always, other Argentine cities from
  // MIN_GROUP up. World: every city from MIN_GROUP up. Rows are sorted by
  // registrations here; the page re-sorts by the metric the viewer picks.
  // A project's txs and volume count once in each city its team registered from.
  const blank = (label, country) => ({ label, country, registrations: 0, projects: 0, submitted: 0, tagged: 0, volumeUsd: 0, _p: new Set() });
  const rankArgentina = new Map(BUILDER_CITIES.map((c) => [c, blank(c, "Argentina")]));
  const rankWorld = new Map();
  const projOfBuilder = new Map();
  for (const p of projects) for (const b of p.builderIds ?? []) projOfBuilder.set(b, p);
  for (const r of regs) {
    if (r.city == null || String(r.city).trim() === "") continue;
    const norm = normalizeCity(r.city);
    const label = norm === OTHER_CITY ? String(r.city).trim() : norm;
    const country = r.country || null;
    const p = projOfBuilder.get(r.builderId);
    for (const [map, key, keep] of [
      [rankWorld, `${label}|${country ?? ""}`, true],
      [rankArgentina, label, country === "Argentina" || BUILDER_CITIES.includes(label)],
    ]) {
      if (!keep) continue;
      const row = map.get(key) ?? blank(label, country);
      row.registrations += 1;
      if (country && !row.country) row.country = country;
      if (p && !row._p.has(p.id)) {
        row._p.add(p.id);
        row.projects += 1;
        if (p.status === "submitted") row.submitted += 1;
        row.tagged += act(p).tagged;
        row.volumeUsd += act(p).volumeUsd;
      }
      map.set(key, row);
    }
  }
  const finish = (rows, keep) =>
    rows
      .filter(keep)
      .map(({ _p, ...r }) => r)
      .sort((a, b) => b.registrations - a.registrations || b.submitted - a.submitted || a.label.localeCompare(b.label));
  const rankings = {
    argentina: finish([...rankArgentina.values()], (r) => BUILDER_CITIES.includes(r.label) || r.registrations >= MIN_GROUP).map((r) => ({ ...r, country: "Argentina" })),
    world: finish([...rankWorld.values()], (r) => r.registrations >= MIN_GROUP),
  };

  const countries = new Map();
  for (const r of regs) {
    const c = r.country || "No country";
    countries.set(c, (countries.get(c) ?? 0) + 1);
  }
  const byCountry = [...countries.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const days = new Map();
  const bump = (d, k, by = 1) => {
    if (!d) return;
    const row = days.get(d) ?? { day: d, registrations: 0, submitted: 0, tagged: 0, volumeUsd: 0 };
    row[k] += by;
    days.set(d, row);
  };
  for (const r of regs) bump(day(r.registeredAt), "registrations");
  for (const p of projects) if (p.status === "submitted") bump(day(p.submittedAt), "submitted");
  for (const p of projects) {
    for (const [d, v] of Object.entries(act(p).days)) {
      if (v.tagged) bump(d, "tagged", v.tagged);
      if (v.volumeUsd) bump(d, "volumeUsd", v.volumeUsd);
    }
  }
  const byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));

  // Volume by token across all projects.
  const tokens = new Map();
  for (const p of projects) for (const [sym, usd] of Object.entries(act(p).byToken ?? {})) tokens.set(sym, (tokens.get(sym) ?? 0) + usd);
  const byToken = [...tokens.entries()].map(([label, volumeUsd]) => ({ label, volumeUsd })).sort((a, b) => b.volumeUsd - a.volumeUsd);

  // Project leaderboard: submitted projects only. They have a public name and Loops
  // House page; drafts are summed into one line so nothing unpublished is named.
  const projectRows = [];
  const drafts = { projects: 0, tagged: 0, volumeUsd: 0 };
  for (const p of projects) {
    const a = act(p);
    if (p.status === "submitted" && p.name) {
      projectRows.push({
        name: p.name,
        url: typeof p.loopsUrl === "string" && /^https:\/\/(www\.)?loops\.house\//.test(p.loopsUrl) ? p.loopsUrl : null,
        tracks: [...new Set((p.tracks ?? []).map(trackName))],
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

  return {
    event: payload?.event ? { name: payload.event.name, submissionDeadline: payload.event.submissionDeadline } : null,
    totals: {
      registrations: payload?.counts?.registrations ?? regs.length,
      projects: payload?.counts?.projects ?? projects.length,
      submitted: payload?.counts?.submitted ?? projects.filter((p) => p.status === "submitted").length,
      countries: byCountry.filter((c) => c.label !== "No country").length,
      taggedTxs: projects.reduce((n, p) => n + act(p).tagged, 0),
      volumeUsd: projects.reduce((n, p) => n + act(p).volumeUsd, 0),
      projectsWithTaggedTx: projects.filter((p) => act(p).tagged > 0).length,
    },
    onchain: activity != null,
    projects: activity ? { submitted: projectRows, drafts } : null,
    byToken,
    readiness: {
      projects: projects.length,
      withIdentity: projects.filter((p) => p.hasIdentity === true).length,
      // With on-chain data, count what the chain shows; Loops House's firstTaggedTx can lag.
      withTaggedTx: activity ? projects.filter((p) => act(p).tagged > 0 || !!p.firstTaggedTx).length : projects.filter((p) => !!p.firstTaggedTx).length,
      withRepo: projects.filter((p) => !!p.repoUrl).length,
    },
    byCity,
    byTrack,
    topOtherCities,
    rankings,
    byCountry,
    byDay,
    unmatched: { registrationsWithoutCity: regs.filter((r) => normalizeCity(r.city) === UNKNOWN_CITY).length },
  };
}
