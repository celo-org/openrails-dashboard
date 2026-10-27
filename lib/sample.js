// Example payload in the Loops House shape, shown only when LOOPS_API_KEY is not set.
// The response carries `sample: true` and the page labels it as example data.

const TRACKS = [
  { sponsor: "Stable Agents: LatAm | Ripio x Celo Core Co", bounty: "Stable Agents: LatAm · 1st place" },
  { sponsor: "Stable Agents: Open Corridors | Textile FX", bounty: "Open Corridors: Textile FX · 1st place" },
  { sponsor: "Stable Agents: Open Corridors | USA₮ with x402", bounty: "Open Corridors: USA₮ with x402 · 1st place" },
  { sponsor: "Build with buy", bounty: "Build with buy · 5 winners, $200 each" },
];
const PLACES = [
  ["Buenos Aires", "Argentina"], ["Córdoba", "Argentina"], ["San Salvador de Jujuy", "Argentina"], ["Salta", "Argentina"],
  ["Rosario", "Argentina"], ["Mar del Plata", "Argentina"], ["Lagos", "Nigeria"], ["Bengaluru", "India"], ["São Paulo", "Brazil"], [null, null],
];

export function samplePayload(nRegs = 60, nProjects = 18) {
  const start = Date.UTC(2026, 9, 6);
  const at = (i) => new Date(start + ((i * i * 13 * 3600 * 1000) % (16 * 86400 * 1000))).toISOString();
  const registrations = Array.from({ length: nRegs }, (_, i) => {
    const [city, country] = PLACES[(i * 3) % PLACES.length];
    return { builderId: `b${i}`, registeredAt: at(i), city, country, projectId: i < nProjects * 2 ? `p${i % nProjects}` : null };
  });
  const projects = Array.from({ length: nProjects }, (_, i) => ({
    id: `p${i}`,
    status: i % 2 ? "submitted" : "draft",
    name: i % 2 ? `Sample agent ${i}` : null,
    loopsUrl: i % 2 ? "https://www.loops.house/agents-on-open-rails" : null,
    tracks: [TRACKS[i % TRACKS.length]],
    builderIds: registrations.filter((r) => r.projectId === `p${i}`).map((r) => r.builderId),
    hasIdentity: i % 3 !== 0,
    firstTaggedTx: i % 4 === 0 ? null : "0xsample",
    repoUrl: i % 2 ? "https://github.com/example/repo" : null,
    submittedAt: i % 2 ? at(i + 7) : null,
  }));
  return {
    event: { name: "Agents on Open Rails", submissionDeadline: "2026-11-09T09:00:00.000Z" },
    counts: { registrations: nRegs, projects: nProjects, submitted: projects.filter((p) => p.status === "submitted").length },
    registrations,
    projects,
  };
}

// Example on-chain activity for the sample payload (same shape as lib/onchain.js output).
export function sampleActivity(payload) {
  return new Map(
    payload.projects.map((p, i) => {
      const tagged = (i * 7) % 23;
      const volumeUsd = tagged * 3.5;
      const d = (p.submittedAt ?? "2026-10-15T00:00:00.000Z").slice(0, 10);
      const byToken = volumeUsd ? { [["USDT", "USDC", "wBRL", "wARS", "cNGN"][i % 5]]: volumeUsd } : {};
      return [p.id, { tagged, volumeUsd, byToken, counterparties: tagged % 9, days: tagged ? { [d]: { tagged, volumeUsd } } : {} }];
    }),
  );
}
