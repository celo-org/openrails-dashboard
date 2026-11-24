// Local preview without Vercel: serves public/, /api/* and the stats routes on PORT (default 3456).
// STATS_HOST=1 serves the stats site at / like stats.celobuilders.xyz does.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { loadStats } from "./api/stats.js";
import { loadOnchain } from "./api/onchain.js";
import { loadEventStats } from "./api/event.js";
import { loadHackathons } from "./api/hackathons.js";

const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".css": "text/css; charset=utf-8" };
const port = Number(process.env.PORT || 3456);
const statsHost = process.env.STATS_HOST === "1";

function route(path) {
  if (statsHost && path === "/") return "/stats/index.html";
  if (statsHost && /^\/[a-z0-9-]+$/.test(path)) return "/stats/event.html";
  if (path === "/stats" || path === "/stats/") return "/stats/index.html";
  if (/^\/stats\/[a-z0-9-]+$/.test(path)) return "/stats/event.html";
  return path === "/" ? "/index.html" : path;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  const api = {
    "/api/stats": () => loadStats(),
    "/api/onchain": () => loadOnchain(),
    "/api/hackathons": () => loadHackathons(),
    "/api/event": () => loadEventStats(url.searchParams.get("slug") ?? "", { onchain: url.searchParams.get("onchain") === "1" }),
  }[path];
  if (api) {
    const { status, body } = await api();
    res.writeHead(status, { "content-type": "application/json" });
    return res.end(JSON.stringify(body));
  }
  const file = normalize(route(path));
  if (file.includes("..")) return res.writeHead(400).end();
  try {
    const body = await readFile(new URL(`./public${file}`, import.meta.url));
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
