// GET /api/hackathons — every hackathon on the stats site with its dates, status and headline totals.

import { HACKATHONS } from "../lib/hackathons.js";
import { loadEvent } from "../lib/event-data.js";

export async function loadHackathons(env = process.env, fetchImpl = fetch) {
  const items = await Promise.all(
    HACKATHONS.map(async (h) => {
      const r = await loadEvent(h, { env, fetchImpl });
      const base = { slug: h.slug, name: h.name, loopsUrl: h.loopsUrl };
      if (r.error) return { ...base, error: r.error };
      const p = r.payload;
      const tracks = [...new Set((p.projects ?? []).flatMap((x) => (x.tracks ?? []).map((t) => t.sponsor)))];
      return {
        ...base,
        status: r.meta.status ?? "live",
        startsAt: p.event?.startsAt ?? null,
        submissionDeadline: p.event?.submissionDeadline ?? null,
        builders: p.counts?.registrations ?? 0,
        projects: p.counts?.projects ?? 0,
        submitted: p.counts?.submitted ?? 0,
        tracks: tracks.length,
      };
    }),
  );
  return { status: 200, body: { hackathons: items, updatedAt: new Date().toISOString() } };
}

export default async function handler(req, res) {
  const { status, body } = await loadHackathons();
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(status).json(body);
}
