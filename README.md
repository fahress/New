# Fahress — The Arabic Type Design Archive

The 2026 redesign of [fahress.com](https://fahress.com): a black-and-white archive where the only colour comes from the designers' own presentation images.

Built with Next.js (App Router). All content — fonts, designers, foundries, scripts, styles, types, genres, languages and awards — is read live from the existing Supabase project, so anything added in the Fahress dashboard appears on the site within about 10 minutes.

## Pages

| Route | What it shows |
| --- | --- |
| `/` | Hero, live search, scrolling specimen wall, counters, newest fonts, browse by script, designer of the week, award winners, foundry ticker |
| `/fonts` | Catalog with the full filter sidebar: script, style, type, genre, designers, foundries, license, language, weights, release year, awards. Filters are kept in the address so views can be shared. Old links such as `/search?scripts=1` still work. |
| `/fonts/[slug]` | Image gallery, credits, tags, where to buy, awards, more by the designer, similar fonts |
| `/designers`, `/foundries` | A–Z directory with search and image preview on hover |
| `/designers/[slug]` | Designer or foundry profile: bio, links, stats, all typefaces, collaborators |
| `/about` | About Fahress and how to submit a font |

URLs match the old site, so existing links and Google results keep working.

## Setup

1. The public Supabase URL and anon key are built in (`lib/config.ts`), so no setup is required. To point at another project, copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` — the project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the public **anon** key (never the service_role key)
   - `NEXT_PUBLIC_SITE_URL` — `https://fahress.com`
2. `npm install`
3. `npm run dev` and open http://localhost:3000

The Supabase tables the site reads need a read-only "Public read" policy (already added). Private tables — `profiles`, `collections`, `collection_fonts`, `designer_followers` — are not read and stay locked.

## Deploying on Vercel

Import this repository in Vercel and deploy — no environment variables are required. Every branch gets its own preview link; search engines are told not to index previews.

## Offline development

Set `FAHRESS_FIXTURE=/path/to/snapshot.json` (an export of the tables as `{ "fonts": [...], "designers": [...], ... }`) to build without network access.
