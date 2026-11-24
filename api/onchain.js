// GET /api/onchain — /api/stats plus on-chain activity (attribution-tagged txs,
// payment volume, counterparties) for Agents on Open Rails. Activity comes from the
// hackathon's Blob snapshot (lib/snapshot.js); after the deadline it is final.

import { aggregate } from "../lib/aggregate.js";
import { DEFAULT_HACKATHON } from "../lib/hackathons.js";
import { loadEvent } from "../lib/event-data.js";

export async function loadOnchain(env = process.env, fetchImpl = fetch) {
  const r = await loadEvent(DEFAULT_HACKATHON, { onchain: true, env, fetchImpl });
  if (r.error) return { status: r.status, body: { error: r.error } };
  return { status: 200, body: { ...r.meta, updatedAt: new Date().toISOString(), ...aggregate(r.payload, r.activity) } };
}

export default async function handler(req, res) {
  const { status, body } = await loadOnchain();
  res.setHeader("Cache-Control", status === 200 ? "s-maxage=60, stale-while-revalidate=600" : "no-store");
  res.status(status).json(body);
}
