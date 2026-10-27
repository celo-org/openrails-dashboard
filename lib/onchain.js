// On-chain activity per project, read from Blockscout for each project's agentWallet.
// - Tagged txs: successful txs sent by the agent wallet whose calldata ends in an
//   ERC-8021 suffix carrying the project's attribution code (`project.code`).
// - Volume: ERC-20 transfers in or out of the agent wallet in payment tokens
//   (USD stablecoins, Ripio wFIAT, cNGN, CELO), valued with Blockscout's current
//   exchange rate (USD stablecoins at 1).
// - Counterparties: distinct addresses on the other side of those transfers.
// Only counts leave this module; wallets and hashes stay server-side.

export const ERC_8021_MARKER = "80218021802180218021802180218021";
const BLOCKSCOUT = "https://celo.blockscout.com/api/v2";

// Celo mainnet payment tokens. `usd: 1` pins USD stablecoins; others use Blockscout's rate.
// Anything not listed here (LP and debt tokens, spam) never counts as volume.
export const PAYMENT_TOKENS = new Map(
  [
    ["0xceba9300f2b948710d2653dd7b07f33a8b32118c", { symbol: "USDC", usd: 1 }],
    ["0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e", { symbol: "USDT", usd: 1 }],
    ["0xd2ab3c9a02dbbab236bfec45d1d755df4267f771", { symbol: "USAT", usd: 1 }],
    ["0x765de816845861e75a25fca122bb6898b8b1282a", { symbol: "USDm", usd: 1 }],
    ["0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d", { symbol: "wARS" }],
    ["0xd76f5faf6888e24d9f04bf92a0c8b921fe4390e0", { symbol: "wBRL" }],
    ["0x337e7456b420bd3481e7fa61fa9850343d610d34", { symbol: "wMXN" }],
    ["0x8a1d45e102e886510e891d2ec656a708991e2d76", { symbol: "wCOP" }],
    ["0x4f34c8b3b5fb6d98da888f0fea543d4d9c9f2ebe", { symbol: "wPEN" }],
    ["0x61d450a098b6a7f69fc4b98ce68198fe59768651", { symbol: "wCLP" }],
    ["0xf6829d7393dae24509eb1e52ee8e572e2e271a4f", { symbol: "cNGN" }],
    ["0x471ece3750da237f93b8e339c536989b8978a438", { symbol: "CELO" }],
  ].map(([a, v]) => [a, v]),
);

// ERC-8021 schema 0: [codes ascii, comma-separated][length:1][schema:1][marker:16]
export function decodeAttribution(input) {
  const h = String(input ?? "").replace(/^0x/, "").toLowerCase();
  if (!h.endsWith(ERC_8021_MARKER)) return [];
  const body = h.slice(0, -ERC_8021_MARKER.length);
  const len = parseInt(body.slice(-4, -2), 16);
  if (!Number.isFinite(len) || len === 0 || body.length < 4 + len * 2) return [];
  const hex = body.slice(-4 - len * 2, -4);
  let text = "";
  for (let i = 0; i < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return text.split(",").map((c) => c.trim()).filter(Boolean);
}

export function tokenOf(t) {
  return PAYMENT_TOKENS.get(String(t?.token?.address_hash ?? "").toLowerCase()) ?? null;
}

export function transferUsd(t) {
  const meta = tokenOf(t);
  if (!meta) return 0;
  const decimals = Number(t.total?.decimals ?? t.token?.decimals ?? 18);
  const amount = Number(t.total?.value ?? 0) / 10 ** decimals;
  const rate = meta.usd ?? Number(t.token?.exchange_rate);
  return Number.isFinite(amount) && Number.isFinite(rate) && rate > 0 ? amount * rate : 0;
}

const dayOf = (iso) => new Date(iso).toISOString().slice(0, 10);

// Pure: one project's activity from its wallet's tx and transfer lists.
export function summarizeProject(project, txs, transfers, since, wallet = project.agentWallet) {
  const start = new Date(since).getTime();
  const self = String(wallet ?? "").toLowerCase();
  const days = {};
  const bump = (d, k, v) => {
    days[d] ??= { tagged: 0, volumeUsd: 0 };
    days[d][k] += v;
  };
  let tagged = 0;
  for (const t of txs) {
    if (new Date(t.timestamp).getTime() < start || t.status !== "ok") continue;
    if (!decodeAttribution(t.raw_input).includes(project.code)) continue;
    tagged += 1;
    bump(dayOf(t.timestamp), "tagged", 1);
  }
  let volumeUsd = 0;
  const byToken = {};
  const counterparties = new Set();
  const seen = new Set();
  for (const t of transfers) {
    if (new Date(t.timestamp).getTime() < start) continue;
    const key = `${t.transaction_hash}:${t.log_index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const usd = transferUsd(t);
    if (!usd) continue;
    volumeUsd += usd;
    const sym = tokenOf(t).symbol;
    byToken[sym] = (byToken[sym] ?? 0) + usd;
    bump(dayOf(t.timestamp), "volumeUsd", usd);
    const from = String(t.from?.hash ?? t.from ?? "").toLowerCase();
    const to = String(t.to?.hash ?? t.to ?? "").toLowerCase();
    const other = from === self ? to : from;
    if (other && other !== self) counterparties.add(other);
  }
  return { tagged, volumeUsd, byToken, counterparties: counterparties.size, days };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Blockscout rate-limits bursts with 429s. Retries 429 and 5xx with backoff
// (honouring Retry-After), so a busy minute doesn't zero out a project.
async function getJson(url, fetchImpl, { retries = 6, baseDelay = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url);
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(baseDelay * 2 ** attempt);
      continue;
    }
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new Error(`Blockscout ${res.status}`);
    const after = Number(res.headers?.get?.("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : baseDelay * 2 ** attempt);
  }
}

async function pages(url, since, fetchImpl, maxPages, retry) {
  const out = [];
  let next = null;
  for (let i = 0; i < maxPages; i++) {
    const u = next ? `${url}&${new URLSearchParams(next)}` : url;
    const d = await getJson(u, fetchImpl, retry);
    const items = d.items ?? [];
    out.push(...items);
    const last = items.at(-1);
    if (!d.next_page_params || (last && new Date(last.timestamp) < new Date(since))) break;
    next = d.next_page_params;
  }
  return out;
}

// Fetches every project's activity with limited concurrency. A wallet that fails is
// reported in `failed` instead of silently counting as zero.
export async function loadActivity(projects, since, { fetchImpl = fetch, concurrency = 4, maxPages = 20, retry } = {}) {
  const activity = new Map();
  const failed = [];
  const queue = projects.filter((p) => p.agentWallet && p.code);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let p; (p = queue.shift()); ) {
        const w = p.agentWallet.toLowerCase();
        try {
          // One request at a time per wallet keeps the burst at `concurrency` requests.
          const txs = await pages(`${BLOCKSCOUT}/addresses/${w}/transactions?filter=from`, since, fetchImpl, maxPages, retry);
          const transfers = await pages(`${BLOCKSCOUT}/addresses/${w}/token-transfers?type=ERC-20`, since, fetchImpl, maxPages, retry);
          activity.set(p.id, summarizeProject(p, txs, transfers, since));
        } catch {
          failed.push(p.id);
        }
      }
    }),
  );
  return { activity, failed: failed.length };
}
