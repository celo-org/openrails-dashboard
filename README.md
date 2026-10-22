# Open Rails Submissions

Live submission counts for the [Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon (Celo × Ripio), broken down by the six Argentine builder cities (Buenos Aires, Córdoba, Rosario, Mar del Plata, Salta, Jujuy), track, country, and day.

Planned home: `openrails.celobuilders.xyz`.

## How it works

- `public/index.html`: static page that calls `/api/stats` and refreshes every 5 minutes.
- `api/stats.js`: Vercel function. It fetches submissions from the Loops House API **server-side** and returns only aggregate counts. The API key and raw submission fields (emails, wallets, names) never reach the browser.
- `lib/aggregate.js`: pure counting logic. Cities are normalised (accents, `CABA` → Buenos Aires, free text like `Rosario, Santa Fe`); anything else is bucketed as **Other cities** or **No city**.
- Without `LOOPS_API_KEY` the page shows labelled **example data**, so the deploy works before the key exists.

The Loops House API schema isn't published yet. Field lookup tries common names (`city`, `location.city`, `track`, `submittedAt`, …), and each one can be overridden with env vars without a code change. The footer shows how many submissions had no city field, so a wrong mapping is visible.

## Deploy (Vercel)

1. Import `celo-org/openrails-dashboard` into Vercel (framework preset **Other**, no build command; output is `public/`).
2. Set environment variables (see `.env.example`):
   - `LOOPS_API_KEY`: required for live data
   - `LOOPS_API_AUTH_HEADER`: defaults to `Authorization` (sent as `Bearer <key>`); set e.g. `x-api-key` if Loops House uses a custom header
   - `LOOPS_FIELD_CITY`, `LOOPS_FIELD_TRACK`, `LOOPS_FIELD_COUNTRY`, `LOOPS_FIELD_DATE`: comma-separated paths, only if the defaults don't match
3. Domain: add `openrails.celobuilders.xyz` in Vercel → Project → Domains, then create the DNS record Vercel shows (usually `CNAME openrails → cname.vercel-dns.com`).
4. Check `/api/stats` returns `"sample": false`, and that the footer's "had no city field" count is low.

Responses are cached at the edge for 5 minutes (`s-maxage=300`), so the Loops House API sees at most about one request per 5 minutes per region.

## Local

```bash
npm test            # node --test, no dependencies
npm run dev         # http://localhost:3456; reads .env.local (git-ignored) if present
```
