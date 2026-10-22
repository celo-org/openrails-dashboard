# Open Rails City Ranking

Live ranking of the cities building for [Agents on Open Rails](https://www.loops.house/agents-on-open-rails), the Celo hackathon: Argentina's six builder cities (Buenos Aires, Córdoba, Rosario, Mar del Plata, Salta, Jujuy) vs the world, plus tracks, judging readiness and daily activity.

Planned home: `openrails.celobuilders.xyz`.

## How it works

- `public/index.html`: static page that calls `/api/stats` and refreshes every 5 minutes.
- `api/stats.js`: Vercel function. It fetches the event payload from the Loops House API **server-side** and returns only aggregate counts. The API key and per-project data (names, wallets, repos, builder ids) never reach the browser.
- `lib/aggregate.js`: counting logic over the payload's `counts`, `registrations` (`city`, `country`, `projectId`) and `projects` (`status`, `tracks`, `builderIds`, `hasIdentity`, `firstTaggedTx`, `repoUrl`):
  - **By city:** registrations by each builder's city; a project counts once in each city its team registered from. City names are normalised (accents, `CABA` → Buenos Aires, `San Salvador de Jujuy` → Jujuy).
  - **Largest other cities:** only cities with 3 or more registrations, so no single builder is identifiable.
  - **By track:** a project entered in both the 1st and 2nd place bounty of a track counts once.
  - **Ready to be judged:** share of projects with an ERC-8004 identity, an attribution-tagged transaction, and a public repo.
  - **Rankings:** Argentina (the six builder cities always, other Argentine cities from 3 builders) and World (top 10 cities with 3+ builders), by registered builders.
- **Share on X:** each ranking has a Share button that opens an X post with the top cities, tagging @Celo and @CeloDevs and linking the page. The text is trimmed to stay under 280 characters.
- Without `LOOPS_API_KEY` the page shows labelled **example data**, so the deploy works before the key is set.

## Branding

- `public/brand/Celo_Symbol_RGB_ProsperityYellow.svg|png`: official Celo symbol from the [Celo brand kit](https://celo.org/brand-kit) (Symbol → RGB → Prosperity Yellow), unmodified.
- `public/favicon-celo-v1.png`, `public/apple-touch-icon.png`: the icons celo.org serves (yellow square, black C), unmodified; `favicon.ico` is the same image at 16/32/48 px. The bare symbol isn't used as a favicon because its C is transparent and disappears on dark tabs.
- Palette and type from the brand kit: Onyx `#000000`, Gypsum `#FCF6F1`, Prosperity Yellow `#FCFF52`, Inter and DM Mono. The page is dark-only on purpose: the yellow symbol reads poorly on light backgrounds.
- `public/og-v1.png` (1200×630): social card. Its bars are decorative so the image never shows stale numbers.
- Icon and OG files are versioned in their names (`-v1`) because browsers and X cache them by URL: when one changes, bump the name and the reference in `index.html`. `vercel.json` sets a one-day cache on them.
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
