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

## Messages: Gmail + the contact form in the dashboard

**Dashboard → Inbox → Messages** shows one list with:

- **Website messages** from the new contact form at `/contact` (also linked in the footer and on About), and
- **Your Gmail inbox** (e.g. admin@fahress.com). You can read conversations, see attachments, reply, reply all, write new emails, archive ("Done"), mark unread and delete. Emails are sent through Gmail, so they also appear in Gmail's Sent folder.

Replying to a website message sends an email from your Gmail and moves the message to *Done*. The sidebar Inbox badge counts new website items + unread Gmail. Only **admins** see the mailbox; editors still see website messages.

### One-time setup

1. **Database** — Supabase → SQL Editor → run `supabase/messages-update.sql` (safe to run again).
2. **Google OAuth client** — in [Google Cloud Console](https://console.cloud.google.com/):
   1. Create a project (or use an existing one) and enable the **Gmail API**.
   2. *OAuth consent screen*: User type **External** (or **Internal** if fahress.com is a Google Workspace domain), app name "Fahress Dashboard", add the scope `https://www.googleapis.com/auth/gmail.modify`.
      Then set **Publishing status → In production**. (In "Testing", Google expires the sign-in every 7 days.) Google will show an "unverified app" warning when you connect — click *Advanced → Go to Fahress Dashboard*. That's expected for a private tool used only by you.
   3. *Credentials → Create credentials → OAuth client ID → Web application*. Authorised redirect URIs:
      - `https://fahress.com/api/dashboard/gmail/callback`
      - `http://localhost:3000/api/dashboard/gmail/callback` (for local testing)
3. **Vercel → Settings → Environment Variables**: add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `MAIL_TOKEN_SECRET` (any random 32+ character text, e.g. from `openssl rand -base64 32`). Redeploy.
4. Open **Dashboard → Inbox → Connect Gmail** and sign in with the mailbox you want.

**Security:** the Google sign-in is encrypted with `MAIL_TOKEN_SECRET` and stored in the `mail_account` table, which only dashboard admins can read. No Supabase secret key is used, and emails are not copied into the database. They are read live from Gmail. HTML emails are shown in a sandbox where no scripts can run.
