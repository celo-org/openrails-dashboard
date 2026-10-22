// Turns the Loops House event payload into the counts the dashboard shows.
// Payload shape (GET /api/v1/celo/agents-on-open-rails):
//   counts        { registrations, projects, submitted, participants }
//   registrations [{ builderId, registeredAt, city, country, projectId }]
//   projects      [{ id, status: "draft"|"submitted", tracks: [{ sponsor, bounty }],
//                    builderIds, hasIdentity, firstTaggedTx, registeredAt, submittedAt, ... }]
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

function inc(map, key, field) {
  const row = map.get(key) ?? { registrations: 0, projects: 0, submitted: 0 };
  row[field] += 1;
  map.set(key, row);
}

export function aggregate(payload) {
  const regs = Array.isArray(payload?.registrations) ? payload.registrations : [];
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];

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
    }
  }
  const byTrack = [...tracks.entries()]
    .map(([label, v]) => ({ label, projects: v.projects, submitted: v.submitted }))
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

  // Rankings by registrations. Argentina: the six builder cities always, other
  // Argentine cities from MIN_GROUP up. World: every city from MIN_GROUP up.
  const rankArgentina = new Map(BUILDER_CITIES.map((c) => [c, { label: c, registrations: 0, projects: 0, submitted: 0 }]));
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
      const row = map.get(key) ?? { label, country, registrations: 0, projects: 0, submitted: 0, _p: new Set() };
      row.registrations += 1;
      if (country && !row.country) row.country = country;
      if (p && !(row._p ??= new Set()).has(p.id)) {
        row._p.add(p.id);
        row.projects += 1;
        if (p.status === "submitted") row.submitted += 1;
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
    world: finish([...rankWorld.values()], (r) => r.registrations >= MIN_GROUP).slice(0, 10),
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
  const bump = (d, k) => {
    if (!d) return;
    const row = days.get(d) ?? { day: d, registrations: 0, submitted: 0 };
    row[k] += 1;
    days.set(d, row);
  };
  for (const r of regs) bump(day(r.registeredAt), "registrations");
  for (const p of projects) if (p.status === "submitted") bump(day(p.submittedAt), "submitted");
  const byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));

  return {
    event: payload?.event ? { name: payload.event.name, submissionDeadline: payload.event.submissionDeadline } : null,
    totals: {
      registrations: payload?.counts?.registrations ?? regs.length,
      projects: payload?.counts?.projects ?? projects.length,
      submitted: payload?.counts?.submitted ?? projects.filter((p) => p.status === "submitted").length,
      countries: byCountry.filter((c) => c.label !== "No country").length,
    },
    readiness: {
      projects: projects.length,
      withIdentity: projects.filter((p) => p.hasIdentity === true).length,
      withTaggedTx: projects.filter((p) => !!p.firstTaggedTx).length,
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
