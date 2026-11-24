// Hackathons the stats site knows about. Adding one is one entry here: dates,
// tracks and projects come from the Loops House API for `loopsSlug`.
// `dune` (optional) points at the Celo team's Dune queries (see lib/dune.js); when set,
// on-chain numbers come from Dune and match the official board. Without it, the site
// falls back to scanning each project's agent wallet on Blockscout (lib/onchain.js).
// Newest first; the stats home lists them in this order.

export const HACKATHONS = [
  {
    slug: "agents-open-for-business",
    name: "Agents Open for Business",
    loopsSlug: "agents-open-for-business",
    loopsUrl: "https://www.loops.house/agents-open-for-business",
  },
  {
    slug: "agents-on-open-rails",
    name: "Agents on Open Rails",
    loopsSlug: "agents-on-open-rails",
    loopsUrl: "https://www.loops.house/agents-on-open-rails",
    dune: { perCode: 8975671, daily: 9006033, totals: 8976481, board: "https://dune.com/celo/agents-on-open-rails-hackathon" },
  },
];

export const getHackathon = (slug) => HACKATHONS.find((h) => h.slug === slug) ?? null;
export const DEFAULT_HACKATHON = getHackathon("agents-on-open-rails");
