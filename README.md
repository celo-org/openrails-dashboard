# Open Rails Submissions

Live submission counts for the [Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon (Celo × Ripio), broken down by the six Argentine builder cities (Buenos Aires, Córdoba, Rosario, Mar del Plata, Salta, Jujuy), track, country, and day.

Planned home: `openrails.celobuilders.xyz`.

## How it works

- `public/index.html`: static page that calls `/api/stats` and refreshes every 5 minutes.
- `api/stats.js`: Vercel function. It fetches the event payload from the Loops House API **server-side** and returns only aggregate counts. The API key and per-project data (names, wallets, repos, builder ids) never reach the browser.
- `lib/aggregate.js`: counting logic over the payload's `counts`, `registrations` (`city`, `country`, `projectId`) and `projects` (`status`, `tracks`, `builderIds`, `hasIdentity`, `firstTaggedTx`, `repoUrl`):
  - **By city:** registrations by each builder's city; a project counts once in each city its team registered from. City names are normalised (accents, `CABA` → Buenos Aires, `San Salvador de Jujuy` → Jujuy).
  - **Largest other cities:** only cities with 3 or more registrations, so no single builder is identifiable.
  - **By track:** a project entered in both the 1st and 2nd place bounty of a track counts once.
  - **Ready to be judged:** share of projects with an ERC-8004 identity, an attribution-tagged transaction, and a public repo.
- Without `LOOPS_API_KEY` the page shows labelled **example data**, so the deploy works before the key is set.

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
