# Fahress Agent — setup and design

The Fahress Agent is a chat assistant for the dashboard team (`/dashboard/agent`). It talks naturally in Arabic and English,
remembers the conversation, searches Fahress and the web, compares sources, and prepares exact change proposals. **It never
saves anything by itself**: every permanent change goes through a person approving a specific proposal, and the database
checks that person's permissions again when it runs.

## ملخص سريع (بالعربية)

1. شغّل `supabase/agent-setup.sql` في محرر SQL في Supabase (بعد `dashboard-setup.sql`). آمن لإعادة التشغيل.
2. انشر دالة الحافة `agent-gateway` مرة واحدة: `supabase functions deploy agent-gateway --project-ref vwprdpizbxjokwmnotgl`.
3. انشر الموقع كالمعتاد — **لا توجد متغيرات بيئة جديدة ولا ملفات `.env`**.
4. من لوحة التحكم: **Agent settings → Connections**: الصق مفتاح Fireworks ثم «Save & test»، ثم مفتاح Tavily (للبحث)، وOpenRouter اختياريًا.
5. **Models**: اختر نموذج المحادثة من القائمة ثم «Check this model» للتأكد من دعمه للأدوات والبث.
6. فعّل الأيجنت (**Running → The agent is on**) واحفظ.

المفاتيح تُحفظ مشفّرة في Supabase Vault، ولا يقرؤها إلا دالة `agent-gateway` بهوية الخادم التي يوفرها Supabase تلقائيًا. الصفحة
لا تعرض إلا آخر أربعة أحرف من المفتاح.

---

## 1. Installation

Nothing here adds an environment variable or a `.env` file. All agent settings, keys and permissions are managed from the dashboard.

### Step 1 — database (once, safe to repeat)

Supabase → **SQL Editor** → paste and run [`supabase/agent-setup.sql`](../supabase/agent-setup.sql).
It needs `dashboard-setup.sql` (the `dashboard_roles` table and helper functions) and the **Vault** extension
(Database → Extensions → `supabase_vault`, enabled by default on Supabase projects). The last query prints three checks:
the number of agent tables (16), `vault available = true`, and `agent-staging bucket = true`.

What it adds: settings, integration status, conversations/messages, runs/tool calls, sources and claims, proposals and
approvals, memory, usage, jobs, image staging (private `agent-staging` bucket), the approval executor, and two optional
columns (`fonts.description_ar`, `designers.bio_ar`) that the font and designer editors show once they exist.

> **One change to existing rules (section 12).** The seven font link tables (`font_scripts`, `font_designers`, …) had a rule
> letting any team member change links of any font. That let an editor change the credits or classification of a *published*
> font even though editors can't edit published fonts themselves. The script replaces it with: admins can change all links;
> editors only links of draft / in-review fonts. Effect on the existing dashboard: an editor merging two designer profiles
> that are credited on published fonts now gets "not allowed" (an admin does it).

### Step 2 — the gateway (once)

The gateway is a Supabase Edge Function in [`supabase/functions/agent-gateway/`](../supabase/functions/agent-gateway/).
With the Supabase CLI logged in to the project:

```bash
supabase functions deploy agent-gateway --project-ref vwprdpizbxjokwmnotgl
```

Keep JWT verification on (the default). Supabase gives every Edge Function its project URL and service identity
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) automatically — nothing is configured by hand. The dashboard finds the function
from the existing Supabase address, so there is nothing to set on Vercel either.

### Step 3 — deploy the site

As usual. No environment variables are required.

### Step 4 — keys, models, connection test (in the dashboard)

1. **Agent settings → Status** should say *Gateway: Installed*. If not, step 2 didn't run.
2. **Connections**: paste the **Fireworks** key → **Save & test**. The gateway first tests the key with a free request
   (listing models). A key the provider refuses is not saved. After saving, the page shows only `••••` + the last four characters.
   - **Tavily** (web search): same; the test runs one basic search (about 1 credit).
   - **OpenRouter** (optional): same, then tick *Allow OpenRouter models*.
   - **Test** re-checks a saved key; **Delete** removes it from Vault. Replacing a key takes effect on the next request — no redeploy.
3. **Models**: pick the provider and the chat model (the list comes from the provider, with tool/image support marked ✓ ✗ ?).
   Press **Check this model**: a tiny request (a few tokens) checks that it really calls tools and streams. A model that can't
   call tools is flagged in red; if you use it anyway, the agent answers without tools and says so in the reply.
   Optional: a vision model (describing specimens), a cheaper summary model, and a fallback model with the errors it covers.
4. **Running**: tick *The agent is on* → **Save settings**.

Every settings change is versioned (two admins can't overwrite each other silently) and recorded in *Changes to these settings*,
without key values.

## 2. Using it

- Sidebar → **Fahress Agent**, or **Ask the agent about this font / designer / foundry** on an editor page (the conversation
  is linked to that record; its data is read fresh from the database at every reply).
- Conversations are private to their owner (not visible to other team members, including admins). They can be searched,
  renamed, archived and deleted. Replies stream; **Stop** ends a reply; a failed or stopped reply can be retried.
- **Edit** a message or **Regenerate** a reply to start a new version of the conversation from there (‹ 1 / 2 › switches
  between versions). Pending proposals of the replaced version are closed so they can't be approved by mistake.
- Sources appear as chips next to the facts and as a list under the reply (opened page vs. search snippet, page dates, the quote).
- **Proposals** list each change with the current value, the proposed value and its evidence. Untick changes you don't want,
  edit a value (creates a new version), **Approve**, **Reject**, or **Share for review** so a team member who may approve it
  can see it (only the proposal and its evidence, not the conversation). Saying "only the description and links" in the chat
  pre-ticks those changes; you still press Approve.
- **Batch jobs** ("find release years for fonts missing one"): the agent starts a resumable job; its card shows progress and
  has Pause / Resume / Cancel. Each record's result is a separate proposal.

## 3. How it is built

```
Browser (dashboard)                Next.js routes (Vercel)                      Supabase
───────────────────               ───────────────────────────                 ─────────────────────────────
chat, cards, settings  ──JWT──▶   /api/dashboard/agent/*                ──JWT──▶ Postgres (RLS as the person)
                                   ├ agent engine (lib/agent/engine.ts)            agent_* tables, executor
                                   ├ Fahress tools (read with the person's RLS)
                                   ├ web reader (SSRF-safe fetch, PDF, images)
                                   └ model / search calls ──JWT──▶ Edge Function agent-gateway
                                                                     ├ checks sign-in, permissions, run, limits
                                                                     ├ reads the key from Vault (service identity)
                                                                     ├ calls fixed provider hosts only
                                                                     └ records usage as reported
```

### Secrets (decided first)

- **Where**: Supabase Vault (`vault.secrets`). Vault encrypts with a root key that Supabase keeps outside the database
  (not in SQL, not in backups) — the encryption key is not stored next to the data, and not in this code.
- **Who can read a key**: only `agent_vault_read()`, executable only by `service_role`. People signed in to the dashboard
  can save, replace, test and delete keys (with `manage_secrets`) but never read one back — not through the page, the API
  or the database API.
- **Who holds the service identity**: only the `agent-gateway` Edge Function, which receives it from the Supabase platform.
  The Next.js server has no service key (as before); it only forwards the person's own sign-in to the gateway.
- **Where keys may go**: the provider addresses are fixed in `supabase/functions/agent-gateway/lib.ts`
  (`api.fireworks.ai`, `openrouter.ai`, `api.tavily.com`), redirects are refused, and only whitelisted request fields are
  forwarded. No setting can point a key at another host.
- **What leaves the gateway**: replies and errors are scrubbed of anything that looks like a key or token. Keys never enter
  the model's context, messages, tool results, logs, the settings log or browser storage. A test scans the built browser
  bundle for vault access and key patterns.

### Approvals and execution

- The model has **no tool that saves, approves, publishes, deletes or runs SQL**. `propose_changes` stores a proposal only;
  `select_changes` only pre-ticks boxes in the card.
- Proposals are typed changes (`set`, `create`, `link`, `status`, `image_add`, `image_remove`, `image_order`, `cover`, `merge`,
  `delete`, `restore`, `revert`, `taxonomy_create`). When a proposal is created or edited the database records the **current
  value of every field it touches** — from the database, not from what the model claimed.
- **Approve** calls `agent_execute_proposal(id, version, chosen changes, request id, image paths)`, which runs **as the person**
  (their row-level security applies) and in **one transaction**:
  1. the person is signed in and still on the team; their agent permissions are checked for each change
     (e.g. editing a published font needs `approve_font_published`, publishing needs `approve_publish`);
  2. the version matches what they saw; the proposal is pending and not expired;
  3. each field still has the value recorded at proposal time — if someone changed it meanwhile, nothing is saved
     (status *conflict*, with the field named); "Start from the current data" makes a new version to review;
  4. values, links and publishing requirements are validated;
  5. all chosen changes, the approval and the history entries are written together; any failure undoes all of them.
- The approval is used once: the same request id returns the first result; a second approval of the same version is
  refused (unique key), and two simultaneous approvals wait on a row lock (tested with two parallel sessions).
- Images: approved images are copied from the private staging bucket to `studio/agent/…` just before execution and removed
  again if the database refuses (storage isn't part of the database transaction). Unused staged images are discarded by the
  hourly clean-up. Existing images and the cover are never touched unless a change says so.
- Restoring a deleted record and reverting an agent edit are proposals too, and check for newer changes first.

### Permissions

The **Permissions** table in Agent settings maps permissions to the existing roles (admin / editor). It can only narrow what the
roles allow: rows marked *admins only* (edit published fonts, publish, merge, delete, restore, keys, this table) can never be
given to editors — enforced in the page, in `agent_can()` in the database, and by the existing row-level security. Admins
always keep access to the agent, its settings and keys. If a role can't be read, everything is refused (never "assume admin").

### Evidence

Every opened page, PDF page and search result is stored as a source (URL, title, publisher, excerpt, page dates, retrieval time,
PDF page number). Findings and proposals cite sources by `src:xxxxxxxx`; on save the server checks that the source was really
opened in this conversation and that the quoted words are in it. Rules enforced in code (`lib/agent/evidence.ts`):

- facts (year, license, links, credits, awards, country…) need an *opened* source (a search snippet isn't enough) or the
  person's own words in the conversation;
- a release year needs a statement of release (`date_kind: release`) containing the year — a page date, update, design date,
  award year or copyright line is refused;
- conflicting sources block the change (shown side by side instead);
- written text (descriptions, bios) must name what it is based on.

Dates found on pages carry their kind (release, design, update, page published/updated, award, copyright) and precision
(year / month / day); a month or day is never added when the source gives only a year. Citations in replies that don't match a
real source are removed, with a note.

### Memory and context

- Messages, tool results, the conversation summary and "recently discussed records", personal preferences, team editorial
  guidance and archive facts are kept apart. Summaries and preferences are context only — never evidence or approval.
- Long conversations are summarised (summary model) once they exceed the context budget.
- Preferences are saved only when the person asks ("remember that…"); they can be listed and deleted in Agent settings →
  Memory, as can all conversation summaries. Deleting a conversation deletes its messages, tool results, sources, findings
  and summary; proposals stay (without the conversation) as part of the change history, with their evidence snapshot.

### Limits and reliability

- Per reply: time limit, tool steps, token budget, context size; repeated identical tool calls are refused and a loop stops.
- Concurrency per person and per team, and daily token limits per person and team, are checked in the database when a reply
  starts and by the gateway before every provider call. Usage is what the provider reports; costs are estimates
  (OpenRouter reports cost; Fireworks costs come from the prices you enter) and are labelled as such.
- A reply keeps running and saving if the page is closed; reopening the conversation follows it. Sending the same request again
  (double click, retry, two tabs) never starts a second run.
- One short retry for passing provider errors; the fallback model only answers when the main model failed before writing
  anything, and never if it lacks tool support.
- Web reading: http(s) only, ports 80/443/8080/8443, private / loopback / link-local / metadata addresses refused at
  connection time (also after DNS and on every redirect), at most 5 redirects, one total time limit, size limits while
  downloading. SVGs are made inert and every image is re-encoded before it is stored.

### Batch jobs

Jobs are stored item by item with a lease (one worker at a time). A worker processes records for about four minutes and then
hands over to a fresh request, so the job continues after the page is closed **while the person's sign-in is valid (about an
hour)**. After that, or after a crash, the job waits; opening its card and pressing *Continue working* resumes it. A record
in progress when a worker stopped is retried (at most 3 attempts). Pause, resume and cancel take effect before the next record.

## 4. Tests

```bash
npm run lint        # TypeScript
npm test            # unit + UI rendering + database tests
```

- `tests/agent/*.test.ts` — engine with a scripted model and fake search/web/store (streaming in Arabic and English, tool
  validation, loop and step limits, timeouts, stop, fallback, models without tools, prompt injection in a page, invented
  citations, release-year evidence), settings/permission parity with the SQL, name matching across Arabic/Latin, dates,
  evidence rules, duplicates, stream parsing, key masking/scrubbing, SSRF guards, size limits, SVG neutralising, and a scan of
  the built browser bundle.
- `tests/ui/markdown.test.tsx` — reply rendering can't inject HTML or `javascript:` links; RTL/LTR blocks.
- `tests/sql/agent.test.sql` (via `tests/sql/run.sh`, needs a local Postgres; `tests/sql/supabase-stub.sql` imitates the parts
  of Supabase it needs) — permission ceilings, versioned settings, keys unreadable by people, run limits and idempotency,
  private conversations, partial approval, stale versions, single use, editor limits (also on link tables), revoked roles,
  conflicts with rollback, sharing for review, publishing requirements, merge/delete/restore, branch superseding, expiry, jobs,
  image attachment, and two simultaneous approvals.
- `tests/ui/agent-ui.e2e.mjs` — browser test of the chat and settings pages with the agent API mocked
  (run the app in demo mode first; see the file header).

All of these run without network access. **Not tested against the real services:** Supabase Vault and Edge Functions
(the SQL tests use a stand-in), and real calls to Fireworks, OpenRouter and Tavily. Their request/response handling is covered by
unit tests on recorded shapes; the first real check is Step 4 above (Save & test, Check this model).

## 5. Not verified while building

- The production database schema and policies could not be inspected (no database access from the build environment).
  The migration only relies on the columns the dashboard already uses, adds columns with `if not exists`, and writes values
  through `jsonb_populate_record`, so `text[]`/`jsonb` arrays and an enum or text `status` all work.
- Provider documentation could not be fetched from the build environment. The integration follows the OpenAI-compatible chat
  API (Fireworks, OpenRouter), OpenRouter's model list (`supported_parameters`, `architecture.input_modalities`) and Tavily's
  `/search` and `/extract`. Fields a provider doesn't return are treated as unknown, and "Check this model" verifies tool calls
  and streaming with a real request.
