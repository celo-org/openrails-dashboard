# Open Rails City Ranking + Celo Hackathon Stats

Live ranking of the cities building for [Agents on Open Rails](https://www.loops.house/agents-on-open-rails), the Celo hackathon: Argentina's six builder cities (Buenos Aires, Córdoba, Rosario, Mar del Plata, Salta, Jujuy) vs the world, plus tracks, judging readiness and daily activity.

Planned home: `openrails.celobuilders.xyz`.

## Celo Hackathon Stats (stats.celobuilders.xyz)

A city competition for every Celo hackathon: which cities register, ship, transact and move volume, which tracks each city ships for, daily participation, top projects and volume by currency.

- `/` lists every hackathon in `lib/hackathons.js` with its status (upcoming, live, final) and headline totals; `/<slug>` is one hackathon. This is the same on every host (openrails.celobuilders.xyz today, stats.celobuilders.xyz once its DNS exists); `/stats` and `/stats/<slug>` are aliases.
- **Add a hackathon:** one entry in `lib/hackathons.js` (`slug`, `name`, `loopsSlug`, `loopsUrl`). Dates, tracks, projects and builders come from the Loops House API for that slug, with the same `LOOPS_API_KEY`.
- **Official on-chain numbers come from Dune.** Give the hackathon a `dune` entry with the Celo team's query IDs (`perCode`: one row per attribution code with `tx_count`, `unique_users`, `volume_usd` and the `ripio_*`/`textile_*`/`buy_*`/`tether_*`/`cngn_*` columns; `daily`: `day, code, tx_count`; `totals`: a row with `unique_users`) and set `DUNE_API_KEY` in Vercel. `lib/dune.js` reads the last executed results (no re-execution) and only the metric columns, so builder names and handles in those queries never reach this app. Agents on Open Rails reads queries 8975671 / 9006033 / 8976481 and matches the official board exactly (21,421 tagged txs, $6,188,837.7). A hackathon without a `dune` entry, or a Dune error, falls back to the Blockscout scan of agent wallets, and the page says so.
- Daily volume from the `daily` query isn't used: it is measured differently from `perCode` and would contradict the headline, so the daily chart shows transactions only.
- `api/event.js?slug=&onchain=1` and `api/hackathons.js` serve the data; `lib/cities.js` does the city aggregation. Spellings of a city are grouped (accents, case, `City, Region`, a few aliases like CABA → Buenos Aires). A city is named only from 3 builders; smaller ones are summed as "Other cities".
- On-chain activity per hackathon lives in a private Blob (`activity/<slug>.json`) holding per-project counts. It covers the hackathon's start to its submission deadline; a complete snapshot taken after the deadline is final and never rescanned, so finished hackathons keep their final numbers.
- DNS: `stats.celobuilders.xyz` is added to this Vercel project and needs `CNAME stats → eba01d8fed45ae88.vercel-dns-016.com` (the same target as `openrails`) in Cloudflare.

## How it works

- `public/openrails.html`: the original Open Rails page, kept at `/openrails`. The stats site is what every host serves at `/` (see `vercel.json` rewrites; there is no `public/index.html` because Vercel serves static files before rewrites). It calls `/api/stats` and `/api/onchain`.
- `api/stats.js`: Vercel function. It fetches the event payload from the Loops House API **server-side** and returns only aggregate counts. The API key and per-project data (names, wallets, repos, builder ids) never reach the browser.
- `lib/aggregate.js`: counting logic over the payload's `counts`, `registrations` (`city`, `country`, `projectId`) and `projects` (`status`, `tracks`, `builderIds`, `hasIdentity`, `firstTaggedTx`, `repoUrl`):
  - **By city:** registrations by each builder's city; a project counts once in each city its team registered from. City names are normalised (accents, `CABA` → Buenos Aires, `San Salvador de Jujuy` → Jujuy).
  - **Largest other cities:** only cities with 3 or more registrations, so no single builder is identifiable.
  - **By track:** a project entered in both the 1st and 2nd place bounty of a track counts once.
  - **Ready to be judged:** share of projects with an ERC-8004 identity, an attribution-tagged transaction, and a public repo.
  - **Rankings:** Argentina (the six builder cities always, other Argentine cities from 3 builders) and World (top 10 cities with 3+ builders), by registered builders.
- **Share on X:** each ranking has a Share button that opens an X post with the top cities, tagging @Celo and @CeloDevs and linking the page. The text is trimmed to stay under 280 characters.
- Without `LOOPS_API_KEY` the page shows labelled **example data**, so the deploy works before the key is set.

## On-chain activity

`api/onchain.js` returns everything `/api/stats` does plus on-chain activity, read from [Blockscout](https://celo.blockscout.com) for every project's `agentWallet` since the event started (`lib/onchain.js`):

- **Tagged transactions:** successful txs sent by the agent wallet whose calldata ends in an ERC-8021 suffix carrying the project's attribution code (`project.code` from Loops House).
- **Volume:** transfers in or out of the agent wallet in USDC, USDT, USAT, USDm, the six Ripio wFIAT, cNGN and CELO, valued at Blockscout's current exchange rate (USD stablecoins at 1). Other tokens (LP, debt, spam) never count.
- **Counterparties:** distinct wallets on the other side of those transfers.

The page shows them as on-chain KPIs, a Builders / Transactions / Volume switch on the city rankings (the X share text follows it), a top-projects leaderboard (submitted projects only, since drafts have no public name; drafts are summed in one line), volume by currency, daily tagged txs with cumulative volume, and tx/volume per track.

Scanning every wallet takes about a minute (65 s for 74 projects on 2026-11-04) and grows with the hackathon, so the last complete result is kept in a private **Vercel Blob** (`onchain/latest.json`, store `openrails-onchain`, `BLOB_READ_WRITE_TOKEN`). Requests answer from that snapshot in about half a second; when it is older than 10 minutes, the same request starts a rescan in the background (`waitUntil`) that replaces it. A rescan only replaces the snapshot when every wallet was read, so one bad round never swaps good totals for lower ones. The function has `maxDuration: 300`, concurrent requests share one in-flight scan, each Blockscout request times out after 20 s, and 429s are retried with backoff. Wallets that still fail are reported (`failedWallets`) instead of silently counting as zero.

While on-chain data loads (only on the very first scan, or without a Blob store locally), the page shows skeleton placeholders and a status line; once loaded the status shows how old the snapshot is.

Known limits: tagged txs sent from a wallet other than the agent wallet (e.g. end users of a project's frontend) aren't counted; volume uses current rates, not the rate at transfer time; transfers between two agent wallets count for both projects.

## Branding

- `public/brand/Celo_Symbol_RGB_ProsperityYellow.svg|png`: official Celo symbol from the [Celo brand kit](https://celo.org/brand-kit) (Symbol → RGB → Prosperity Yellow), unmodified.
- `public/favicon-celo-v1.png`, `public/apple-touch-icon.png`: the icons celo.org serves (yellow square, black C), unmodified; `favicon.ico` is the same image at 16/32/48 px. The bare symbol isn't used as a favicon because its C is transparent and disappears on dark tabs.
- Palette and type from the brand kit: Onyx `#000000`, Gypsum `#FCF6F1`, Prosperity Yellow `#FCFF52`, Inter and DM Mono. The page is dark-only on purpose: the yellow symbol reads poorly on light backgrounds.
- `public/og-v1.png` (1200×630): social card. Its bars are decorative so the image never shows stale numbers.
- Icon and OG files are versioned in their names (`-v1`) because browsers and X cache them by URL: when one changes, bump the name and the references in `openrails.html` and `stats/`. `vercel.json` sets a one-day cache on them.
- `og:image`, `og:url` and the share link use `https://openrails.celobuilders.xyz/`, so link previews work once the domain points at the deploy.

## Deploy (Vercel)

1. Import `celo-org/openrails-dashboard` into Vercel (framework preset **Other**, no build command; output is `public/`).
2. Set environment variables (see `.env.example`):
   - `LOOPS_API_KEY`: required for live data
   - `LOOPS_API_AUTH_HEADER`: optional, defaults to `Authorization` (sent as `Bearer <key>`, which is what Loops House accepts today)
3. Domain: add `openrails.celobuilders.xyz` in Vercel → Project → Domains, then create the DNS record Vercel shows (usually `CNAME openrails → cname.vercel-dns.com`).
4. Check `/api/stats` returns `"sample": false`.

Responses are cached at the edge for 5 minutes (`s-maxage=300`), so the Loops House API sees at most about one request per 5 minutes per region.

## Local

```bash
npm test            # node --test, no dependencies
npm run dev         # http://localhost:3456; reads .env.local (git-ignored) if present
```
