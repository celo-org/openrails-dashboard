// GET /api/event?slug=<hackathon>&onchain=1 — city competition stats for one
// hackathon listed in lib/hackathons.js. Without onchain=1 it answers from Loops
// House only (fast); with it, on-chain activity is added from the Blob snapshot.

import { getHackathon } from "../lib/hackathons.js";
import { loadEvent } from "../lib/event-data.js";
import { aggregateCities } from "../lib/cities.js";

export async function loadEventStats(slug, { onchain = false, env = process.env, fetchImpl = fetch } = {}) {
  const h = getHackathon(slug);
  if (!h) return { status: 404, body: { error: "Unknown hackathon." } };
  const r = await loadEvent(h, { onchain, env, fetchImpl });
  if (r.error) return { status: r.status, body: { error: r.error } };
  return {
    status: 200,
    body: {
      hackathon: { slug: h.slug, name: h.name, loopsUrl: h.loopsUrl },
      ...r.meta,
      updatedAt: new Date().toISOString(),
      ...aggregateCities(r.payload, r.activity),
    },
  };
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const { status, body } = await loadEventStats(url.searchParams.get("slug") ?? "", { onchain: url.searchParams.get("onchain") === "1" });
  const final = body.status === "final";
  const cache = status !== 200 ? "no-store" : final ? "s-maxage=3600, stale-while-revalidate=86400" : "s-maxage=60, stale-while-revalidate=600";
  res.setHeader("Cache-Control", cache);
  res.status(status).json(body);
}
