// Example submissions, shown only when LOOPS_API_KEY is not set.
// The response carries `sample: true` and the page labels it as example data.

const TRACKS = ["Stable Agents: LatAm", "Open Corridors: Textile FX", "Open Corridors: USA₮ x402", "Build with buy"];
const CITIES = ["Buenos Aires", "Buenos Aires", "Buenos Aires", "Córdoba", "Córdoba", "Rosario", "Mar del Plata", "Salta", "Jujuy", "CABA", "Montevideo", "São Paulo", "", "Lagos"];

export function sampleSubmissions(n = 42) {
  const start = Date.UTC(2026, 9, 6);
  const COUNTRY = { "São Paulo": "Brazil", Lagos: "Nigeria", Montevideo: "Uruguay" };
  return Array.from({ length: n }, (_, i) => {
    const city = CITIES[(i * 5) % CITIES.length];
    return {
      id: `sample-${i + 1}`,
      city,
      country: COUNTRY[city] ?? "Argentina",
      track: TRACKS[(i * 3) % TRACKS.length],
      submittedAt: new Date(start + Math.floor((i * i * 3600 * 1000 * 13) % (16 * 86400 * 1000))).toISOString(),
    };
  });
}
