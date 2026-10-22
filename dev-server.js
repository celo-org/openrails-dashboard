// Local preview without Vercel: serves public/ and /api/stats on PORT (default 3456).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { loadStats } from "./api/stats.js";

const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const port = Number(process.env.PORT || 3456);
createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/api/stats") {
    const { status, body } = await loadStats();
    res.writeHead(status, { "content-type": "application/json" });
    return res.end(JSON.stringify(body));
  }
  const file = path === "/" ? "/index.html" : normalize(path);
  if (file.includes("..")) return res.writeHead(400).end();
  try {
    const body = await readFile(new URL(`./public${file}`, import.meta.url));
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
