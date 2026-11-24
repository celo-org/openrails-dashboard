// Hackathons the stats site knows about. Adding one is one entry here: dates,
// tracks and projects come from the Loops House API for `loopsSlug`.
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
  },
];

export const getHackathon = (slug) => HACKATHONS.find((h) => h.slug === slug) ?? null;
export const DEFAULT_HACKATHON = getHackathon("agents-on-open-rails");
