// GET /api/stats — Agents on Open Rails registrations and projects from Loops House,
// aggregated for the openrails.celobuilders.xyz page. The API key never reaches the browser.

import { aggregate } from "../lib/aggregate.js";
import { DEFAULT_HACKATHON } from "../lib/hackathons.js";
import { loadEvent } from "../lib/event-data.js";
export { fetchPayload } from "../lib/loops.js";

export async function loadStats(env = process.env, fetchImpl = fetch) {
  const r = await loadEvent(DEFAULT_HACKATHON, { env, fetchImpl });
  if (r.error) return { status: r.status, body: { error: r.error } };
  return { status: 200, body: { ...r.meta, updatedAt: new Date().toISOString(), ...aggregate(r.payload) } };
}

export default async function handler(req, res) {
  const { status, body } = await loadStats();
  res.setHeader("Cache-Control", status === 200 ? "s-maxage=300, stale-while-revalidate=600" : "no-store");
  res.status(status).json(body);
}
