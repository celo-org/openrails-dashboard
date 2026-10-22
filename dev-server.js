// Local preview without Vercel: serves public/ and /api/stats on PORT (default 3456).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { loadStats } from "./api/stats.js";

const port = Number(process.env.PORT || 3456);
createServer(async (req, res) => {
  if (req.url.startsWith("/api/stats")) {
    const { status, body } = await loadStats();
    res.writeHead(status, { "content-type": "application/json" });
    return res.end(JSON.stringify(body));
  }
  try {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await readFile(new URL("./public/index.html", import.meta.url)));
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
