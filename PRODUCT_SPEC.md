# Lumen — Product & Technical Specification

> Version: 0.1.0
> Last updated: 2026-04-11
> Stack: Next.js 16 · React 19 · Supabase (PostgreSQL, Auth, RLS) · Gmail API · Vercel

---

## Table of Contents

1. [App Overview](#1-app-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Environment Variables](#3-environment-variables)
4. [Database Schema](#4-database-schema)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [Pages & User Flows](#6-pages--user-flows)
7. [API Routes](#7-api-routes)
8. [Core Library Modules](#8-core-library-modules)
9. [Gmail Sync System](#9-gmail-sync-system)
10. [Content Processing Pipeline](#10-content-processing-pipeline)
11. [Reading State Machine](#11-reading-state-machine)
12. [Data Retention & Pruning](#12-data-retention--pruning)
13. [Admin Dashboard](#13-admin-dashboard)
14. [Component Reference](#14-component-reference)
15. [Known Limitations](#15-known-limitations)
16. [Production Deployment Checklist](#16-production-deployment-checklist)

---

## 1. App Overview

**Lumen** is a calm newsletter reading workspace built on top of Gmail. Instead of reading newsletters in your inbox, Lumen syncs them to a dedicated reader with:

- A distraction-free reading interface
- Per-message reading progress and state tracking
- A curated library organized by publisher (source)
- A search index across all synced newsletters
- Configurable include/exclude rules for which senders to track
- Automatic content pruning with protection for saved/archived items

The app is designed for a single authenticated user per account (each user connects their own Gmail). There is no multi-tenant or team sharing model.

---

## 2. Architecture Summary

```
Browser (React 19 / Next.js App Router)
  │
  ├── Server Components (pages, layouts) — fetch data server-side via data.ts
  ├── Client Components — interactive UI (search, reader progress, sync button)
  │
  └── API Routes (/api/...)
        │
        ├── Supabase (lumen schema, PostgreSQL, RLS)
        │     ├── email_accounts       — Gmail OAuth tokens (encrypted)
        │     ├── newsletter_sources   — publisher profiles
        │     ├── messages             — newsletter issues + reading state
        │     ├── message_bodies       — full HTML/text content (prunable)
        │     ├── sender_rules         — user's include/exclude filters
        │     ├── sync_jobs            — audit log
        │     └── profiles             — user roles
        │
        └── Gmail API (googleapis v1)
              ├── messages.get         — fetch single message
              ├── messages.list        — full query sync
              └── history.list         — incremental sync
```

**Key design decisions:**
- All tables live in the `lumen` custom Postgres schema (not `public`)
- Row Level Security enforces user isolation at the DB layer — no application-level multi-tenancy logic needed
- Gmail OAuth tokens are encrypted at rest with AES-256-GCM before being stored in Supabase
- Reading state is stored directly on the `messages` row (no separate state table)
- Message bodies are stored separately in `message_bodies` so they can be nulled out without losing metadata

---

## 3. Environment Variables

All variables must be set in Vercel project settings (or `.env.local` for local dev).

| Variable | Required | Public | Description |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Yes | Yes | Full app URL, e.g. `https://your-app.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase project REST URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | No | Supabase service role key (bypasses RLS for sync) |
| `GOOGLE_CLIENT_ID` | Yes | No | Google OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | No | Google OAuth 2.0 client secret |
| `GMAIL_REDIRECT_URI` | Yes | No | Must match Google Console exactly. Default: `{APP_URL}/api/integrations/gmail/callback` |
| `APP_ENCRYPTION_KEY` | Yes | No | 64-char hex string (256-bit key) for AES-256-GCM encryption of Gmail tokens |
| `RETENTION_DAYS` | No | No | Days to keep message body content (default: 45) |
| `METADATA_RETENTION_DAYS` | No | No | Days to keep full message rows (default: 90). Saved/archived messages are exempt. |
| `SYNC_LOOKBACK_DAYS` | No | No | How far back to look when syncing a new rule (default: 60) |
| `NEXT_PUBLIC_ENABLE_TEST_LOGIN` | No | Yes | Set to `true` to show email/password login (demo/dev mode only) |

**Generating APP_ENCRYPTION_KEY:**
```bash
openssl rand -hex 32
```

**Critical:** `NEXT_PUBLIC_*` variables are embedded in the client bundle. Never put secrets in them.

---

## 4. Database Schema

Custom Postgres schema: **`lumen`**

PostgREST must be configured to expose this schema:
- Supabase Dashboard → Settings → API → Exposed Schemas → add `lumen`
- The GRANT statements in `schema.sql` must also run

### Tables

#### `lumen.email_accounts`
Stores the user's connected Gmail account and encrypted OAuth tokens.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| provider | text | Always `gmail` for now |
| provider_account_id | text | Gmail address used as account ID |
| access_token_encrypted | text | AES-256-GCM encrypted |
| refresh_token_encrypted | text (nullable) | AES-256-GCM encrypted |
| token_expires_at | timestamptz (nullable) | |
| email_address | text | Display address |
| sync_enabled | boolean | Default true |
| history_id | text (nullable) | Gmail history ID for incremental sync |
| last_synced_at | timestamptz (nullable) | Set after each sync |
| last_error | text (nullable) | Last sync error message |

Unique constraints: `(user_id, provider)`, `(user_id, provider_account_id)`

#### `lumen.newsletter_sources`
One row per publisher (sender) per user. Created automatically when a new newsletter is synced.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| normalized_sender_email | text | Lowercase, trimmed |
| normalized_sender_domain | text | Lowercase, no www |
| display_name | text (nullable) | From email From header |
| description | text (nullable) | Not currently populated |
| category | text (nullable) | Not currently populated |
| logo_url | text (nullable) | Extracted from email HTML |
| include_rule | boolean | Linked sender_rule action=include |
| exclude_rule | boolean | Linked sender_rule action=exclude |
| priority_level | text | `core`, `normal`, `muted` (default: normal) |
| first_seen_at | timestamptz | When first message was received |
| last_seen_at | timestamptz | When most recent message was received |

Constraint: `not (include_rule and exclude_rule)` — a source cannot be both included and excluded.

Unique: `(user_id, normalized_sender_email)`

#### `lumen.messages`
One row per newsletter issue. Contains both metadata and reading state.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| email_account_id | uuid FK → email_accounts | |
| source_id | uuid FK → newsletter_sources | |
| provider_message_id | text UNIQUE | Gmail message ID |
| provider_thread_id | text | Gmail thread ID |
| internet_message_id | text | Email Message-ID header |
| subject | text | |
| from_name | text (nullable) | |
| from_email | text | |
| sent_at | timestamptz | Date header |
| received_at | timestamptz | Gmail internalDate |
| snippet | text (nullable) | Gmail-provided preview |
| unsubscribe_url | text (nullable) | Extracted from List-Unsubscribe header |
| raw_headers_json | jsonb | All email headers |
| detection_method | text | How it was detected as a newsletter |
| **state** | text | `new`, `opened`, `in_progress`, `saved`, `finished`, `archived` |
| **progress_percent** | integer 0–100 | Reading progress |
| **saved** | boolean | Saved for later flag |
| **archived** | boolean | Archived flag |
| opened_at | timestamptz (nullable) | When first opened |
| last_read_at | timestamptz (nullable) | Last time state was updated |
| finished_at | timestamptz (nullable) | When marked finished |
| last_scroll_position | integer | Last scroll Y position in px |

Unique: `provider_message_id`, `(user_id, internet_message_id)`

#### `lumen.message_bodies`
Stores full content separately from metadata. Can be pruned (nulled) without deleting the message row.

| Column | Type | Notes |
|---|---|---|
| message_id | uuid PK FK → messages | |
| user_id | uuid FK → auth.users | |
| html_content | text (nullable) | Raw HTML from Gmail |
| text_content | text (nullable) | Plain text from Gmail |
| sanitized_html_content | text (nullable) | HTML after sanitize pipeline |
| extracted_readable_text | text (nullable) | Text for search index |

#### `lumen.sender_rules`
User-defined filters that drive which emails are imported.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| rule_type | text | `sender_email` or `sender_domain` |
| value | text | The email or domain to match |
| action | text | `include` or `exclude` |
| source_label | text (nullable) | Human-readable label |
| synced_at | timestamptz (nullable) | When last sync ran for this rule |
| active | boolean | Default true |

Unique: `(user_id, rule_type, value)`

#### `lumen.sync_jobs`
Audit log for sync runs. Not currently shown in the UI.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → auth.users | |
| email_account_id | uuid FK → email_accounts (nullable) | |
| sync_type | text | `manual`, `backfill`, `scheduled` |
| status | text | `pending`, `running`, `done`, `failed` |
| started_at / finished_at | timestamptz | |
| cursor | text (nullable) | For resumable syncs |
| error_message | text (nullable) | |

#### `lumen.profiles`
Stores user roles for admin access control.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK FK → auth.users | |
| role | text | `user` or `super_admin` |

To promote a user to super_admin:
```sql
insert into lumen.profiles (id, role) values ('<user-uuid>', 'super_admin')
on conflict (id) do update set role = 'super_admin';
```

### Indexes

| Index | Purpose |
|---|---|
| `idx_messages_user_received_at` | Default sort order (newest first) |
| `idx_messages_user_source_received_at` | Source detail page queries |
| `idx_messages_user_state` | Filter by reading state |
| `idx_messages_user_saved` (partial, saved=true) | Saved page |
| `idx_messages_user_archived` (partial, archived=true) | Archived queries |
| `idx_newsletter_sources_user_email` | Source lookup during sync |
| `idx_newsletter_sources_user_domain` | Domain-based lookups |
| `idx_sender_rules_user_rule` | Rule matching during detection |
| `idx_sync_jobs_user_created` | Sync history queries |
| `idx_sync_jobs_user_status` | Active job checks |
| `idx_messages_search_subject_snippet` | Full-text search (GIN) |
| `idx_message_bodies_search_text` | Full-text search on bodies (GIN, partial) |

### Row Level Security

All tables have RLS enabled. Every table has a policy:
```sql
for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
```
Profiles has select-only (users can read but not change their own role).

---

## 5. Authentication & Authorization

### Sign In

- Provider: **Google OAuth 2.0** via Supabase Auth
- Force account picker on every sign-in: `queryParams: { prompt: "select_account" }` — prevents silent re-auth with a previous Google account
- Callback URL: `/auth/callback` — exchanges Supabase OAuth code for session, then redirects to `/`

### Session Management

- Supabase handles session cookies via `@supabase/ssr`
- Server client reads/writes cookies on every request
- Sessions are stored in browser cookies (not localStorage)
- Sign out clears the Supabase session cookie

### Authorization Layers

1. **Page guard (`requireAuth`)** — server-side redirect to `/login` if not authenticated
2. **API guard (`requireApiAuth`)** — returns 401 JSON if not authenticated
3. **RLS** — database-layer isolation; even if API is bypassed, users cannot read other users' data
4. **Admin guard (`requireAdminPage`)** — checks `profiles.role = 'super_admin'`; redirects to `/` otherwise

### Demo / Test Mode

When `NEXT_PUBLIC_ENABLE_TEST_LOGIN=true` and `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are not set, the app runs in **setup mode**:
- Auth is skipped
- All pages render without a real user
- Mock data or empty states are shown
- Useful for UI development without a Supabase project

---

## 6. Pages & User Flows

### `/login` — Login Page

**What it shows:**
- App logo + name "Lumen"
- Tagline
- "Sign in with Google" button
- Optional: email/password form (only if `NEXT_PUBLIC_ENABLE_TEST_LOGIN=true`)

**Flow:**
1. User clicks "Sign in with Google"
2. `signInWithOAuth({ provider: 'google', options: { queryParams: { prompt: 'select_account' } } })` called
3. Redirects to Google account picker
4. Google redirects to `/auth/callback?code=...`
5. Supabase exchanges code for session
6. Redirect to `/`

**Redirect logic:** If already authenticated, server redirects immediately to `/` without rendering the page.

---

### `/` — Home Page

**What it shows:**
- Today's stats bar: counts of New / In Progress / Saved messages
- **New arrivals** — up to 6 newest `state = 'new'` messages
- **Continue reading** — up to 6 `state = 'opened'` or `'in_progress'` messages
- **Recently read** — up to 4 `state = 'finished'` messages
- **Saved for later** — up to 6 `saved = true` messages
- Onboarding modal on first visit (no Gmail connected + no rules)

**Data source:** `getHomeData()` — fetches the most recent 200 messages, then categorizes them client-side into sections.

**First-time user experience:**
- If the user has no email account and no sender rules, an onboarding modal appears guiding them to Settings to connect Gmail.

**Limitations:**
- Sections are derived from the same 200-message fetch; if there are more than 200 messages, older items may not appear in "recently read" or "saved" sections.

---

### `/library` — Full Message Library

**What it shows:**
- All synced messages, paginated (50 per page)
- Filter tabs: All / New / Reading / Recently Read / Saved
- Each message shown as a `NewsletterCard`
- Delete button per message (in library view)

**Filter mapping:**
| Tab | DB filter |
|---|---|
| All | No filter |
| New | `state = 'new'` |
| Reading | `state IN ('opened', 'in_progress')` |
| Recently Read | `state = 'finished'` |
| Saved | `saved = true` |

**Pagination:** 50 items per page, `?page=N` query param.

---

### `/reader/[messageId]` — Reader Page

**What it shows:**
- Full newsletter content rendered as sanitized HTML
- Source name + date header
- Estimated read time
- Unsubscribe link (if available)
- Reading progress bar

**Flow when opened:**
1. `getLiveMessageById(messageId)` fetches message + body
2. State is set to `'opened'` automatically on first open
3. `ReaderProgress` component tracks scroll position
4. On scroll, sends `POST /api/messages/[id]/state` with progress and scroll position
5. When scroll reaches 95%+, state transitions to `'finished'`

**Content rendering:**
1. If `sanitized_html_content` exists → render as HTML
2. Else if `text_content` exists → render as plain text
3. Else → show "Content no longer available" message (body has been pruned)

**Substack-specific processing:**
- Email chrome (header nav, subscribe banners, footer) is stripped
- Featured image is rescued from the header and placed at top of article
- Leading heading is deduplicated if it matches the email subject

**Body expiry check:**
- If the message's `received_at` is older than `RETENTION_DAYS` and `sanitized_html_content` is null, shows expiry message instead of empty content

**Limitations:**
- Images are loaded directly from the sender's CDN — no image proxying. External images may break if the sender's CDN changes URLs.
- `RefreshContentButton` (re-fetch from Gmail) exists as a component but is not currently wired into the reader page.
- CID (inline attachment) images are replaced with data URLs during parsing, but very large inline images may inflate storage.

---

### `/search` — Search Page

**What it shows:**
- Search input
- Live results as you type (debounced)
- Results show as `NewsletterCard` list

**How search works:**
1. User types in `SearchForm` (client component)
2. Client calls `GET /api/search?q=<query>`
3. Server runs case-insensitive `ilike` across: `subject`, `from_email`, `from_name`, `snippet`
4. Returns up to 50 results
5. Results rendered as newsletter cards linking to reader

**Full-text search note:** The schema has GIN full-text indexes on `subject+snippet` and `extracted_readable_text`. The current `ilike` approach does not use these indexes. The GIN indexes are ready for a future upgrade to `to_tsvector` / `to_tsquery` search.

**Limitations:**
- Max 50 results returned regardless of total matches
- Only searches metadata fields (subject, sender, snippet); does not search full body text despite GIN index existing on `extracted_readable_text`
- No sorting options; results are in DB insertion order

---

### `/sources` — Sources List

**What it shows:**
- All newsletter sources grouped by label (from sender rules)
- "Pending" section for rules that have never been synced
- Each source card shows: logo, name, domain, message count, last received date

**Labels / grouping:**
- Sources linked to a sender rule with a `source_label` are grouped under that label
- Sources with no label appear under their domain
- Pending rules (no `synced_at`) are shown separately with a "Sync now" affordance

---

### `/sources/[sourceId]` — Source Detail

**What it shows:**
- Source header: logo, name, domain, description
- All messages from this source, newest first
- Each as a `NewsletterCard`

---

### `/saved` — Saved Messages

**What it shows:**
- All messages where `saved = true`, newest first
- Same card layout as library

**Note:** Saved messages are exempt from the 45-day body prune and the 90-day row delete. They are kept indefinitely until explicitly deleted or the user deletes all data.

---

### `/settings` — Settings Page

**What it shows:**
- **Gmail connection** status + connected email address
- **Last sync** timestamp and result (or error message if sync failed)
- **Message count** total
- **Sender rules** table — each row has: rule type, value, label, status, message count, action buttons (edit label, sync, delete)
- **Add rule** form — add new sender_email or sender_domain rule
- **Delete data** button — with confirmation modal
- **Delete account** button — with confirmation modal
- **Sign out** button

**Sender rule actions:**
- **Edit label** — inline text input to rename the rule's label
- **Sync** — opens modal to choose "Fresh start" or "Catch up" mode
  - Fresh: marks rule synced; only new emails going forward are captured
  - Catch up: runs full backfill for this sender back to `SYNC_LOOKBACK_DAYS`
- **Delete** — deletes rule, associated source, and all messages from that sender

**Delete data flow:**
1. User clicks "Delete data"
2. Confirmation modal appears
3. On confirm, `DELETE /api/user/data` is called
4. Clears: `message_bodies`, `messages`, `newsletter_sources`, `sender_rules`
5. Resets `email_accounts.history_id` and `last_synced_at` (account stays connected)

**Delete account flow:**
1. User clicks "Delete account"
2. Confirmation modal appears
3. On confirm, `DELETE /api/user/account` is called
4. Deletes Supabase auth user record (all data cascades via FK `on delete cascade`)

---

### `/admin` — Admin Dashboard

**Access:** Requires `profiles.role = 'super_admin'`. Redirects to `/` otherwise.

**What it shows:**
- Platform stats: total users, active last 7 days, Gmail-connected count
- Message stats: total, average per user
- 30-day trends: new signups (bar chart), messages synced (bar chart)
- Reading state breakdown: new / opened / in_progress / finished / saved / archived
- Top 8 sources by number of users
- All users table: email, joined, last sign-in, Gmail status, last sync, message count, rule count

---

## 7. API Routes

### `GET /api/home`
Returns home page data (sections: new, reading, recently read, saved). Auth required.

### `GET /api/library`
Returns all messages. Auth required.

### `GET /api/search?q=<query>`
Full-text search, max 50 results. Auth required.

### `GET /api/messages/[messageId]`
Fetch single message with body. Auth required.

### `DELETE /api/messages/[messageId]`
Delete message. Cascades to message_bodies. Auth required.

### `POST /api/messages/[messageId]/state`
Update reading state. Auth required.

**Request body (all fields optional):**
```json
{
  "state": "new | opened | in_progress | saved | finished | archived",
  "progressPercent": 0,
  "saved": false,
  "archived": false,
  "lastScrollPosition": 0
}
```

**Auto-set fields:**
- `last_read_at` → always set to `now()`
- `opened_at` → set on first open (state = opened or in_progress), never overwritten
- `finished_at` → set when state = finished OR progressPercent = 100

### `POST /api/messages/[messageId]/refresh`
Re-fetches message content from Gmail API and updates `message_bodies`. Useful if content was pruned. Auth required. Requires Gmail to still be connected and message to exist in Gmail.

### `GET /api/sources`
Returns all sources + pending rules. Auth required.

### `POST /api/sender-rules`
Create a new sender rule.

**Request body:**
```json
{
  "ruleType": "sender_email | sender_domain",
  "value": "newsletter@example.com",
  "action": "include | exclude",
  "sourceLabel": "Optional label"
}
```

### `PATCH /api/sender-rules/[ruleId]`
Update a rule's label or active status.

### `DELETE /api/sender-rules/[ruleId]`
Delete rule + associated source + all source's messages.

### `POST /api/sender-rules/[ruleId]/sync`
Run sync for a single rule.

**Request body:**
```json
{ "mode": "fresh | catchup" }
```

### `DELETE /api/integrations/gmail`
Disconnect Gmail. Deletes the `email_accounts` row.

### `POST /api/integrations/gmail/connect`
Initiate Gmail OAuth. Returns redirect URL. Stores CSRF state in httpOnly cookie (10-min expiry).

### `GET /api/integrations/gmail/callback`
Gmail OAuth callback. Validates state cookie, exchanges code for tokens, stores encrypted tokens, redirects to `/settings?gmail=connected`.

### `POST /api/sync/run`
Trigger a full sync. Rate-limited: minimum 60 seconds between syncs per user. Returns sync result as JSON.

### `POST /api/sync/stream`
Trigger a full sync with real-time progress via Server-Sent Events (SSE). Client receives progress events `data: {"progress": 45, "message": "Processing..."}`. Auth required.

### `DELETE /api/user/data`
Delete all user data (messages, sources, rules). Keeps account and Gmail connection. Resets sync state.

### `DELETE /api/user/account`
Delete account entirely via Supabase admin API. All data cascades via FK `on delete cascade`.

### `GET /auth/callback`
Supabase auth callback. Exchanges code → session, redirects to `/`.

---

## 8. Core Library Modules

### `src/lib/env.ts`
Central config. Reads all env vars, provides:
- `appEnv` object with typed values and defaults
- `hasSupabaseConfig()` — checks anon key + URL
- `hasAdminSupabaseConfig()` — checks service role key + URL
- `hasGmailConfig()` — checks Google credentials + encryption key
- `getRuntimeMode()` — returns `'setup'` (missing config) or `'live'`

### `src/lib/auth.ts`
- `requireAuth()` — page guard, server redirect to `/login`
- `requireApiAuth()` — API guard, returns `{user, unauthorized}` where unauthorized is a Response or null
- Skips auth entirely in setup mode (no Supabase configured)

### `src/lib/data.ts`
~1300 lines. All database operations. Key exports:

| Function | Description |
|---|---|
| `getCurrentUser()` | Cached auth user fetch |
| `getHomeData()` | Home page sections |
| `getLibraryData(filter?, page?)` | Paginated message library |
| `getSavedData()` | Saved messages |
| `getSourcesData()` | Sources + pending rules |
| `getSourceData(id)` | Single source + its messages |
| `getShellSummary()` | Sidebar counts |
| `getSettingsData()` | Settings panel data |
| `getLiveMessageById(id)` | Single message with body |
| `searchMessages(query)` | ilike search, 50 results |
| `updateMessageState(id, payload)` | Update reading state |
| `deleteMessage(id)` | Delete message |
| `createSenderRule(input)` | Add new rule |
| `updateSenderRule(id, input)` | Edit rule |
| `deleteSenderRule(id)` | Delete rule + source + messages |
| `deleteUserData()` | Wipe all user data |
| `disconnectGmail()` | Remove Gmail connection |
| `startGmailConnection()` | Generate OAuth URL |
| `completeGmailConnection(code)` | Exchange code, store tokens |
| `runSync(onProgress?)` | Full sync orchestrator |
| `runSyncForRule(ruleId, mode)` | Single-rule sync |

### `src/lib/gmail.ts`
Gmail API integration. Key exports:

| Function | Description |
|---|---|
| `createGmailConnectUrl(state)` | OAuth consent URL |
| `exchangeGmailCode(code)` | Code → tokens + profile |
| `syncNewslettersFromGmail(input)` | Main sync, returns messages[] |
| `fetchIncrementalMessageIds(gmail, historyId)` | History API incremental sync |
| `fetchMessage(gmail, msgId, rules)` | Single message fetch + parse |
| `refetchGmailMessage(accountId, providerId)` | Re-fetch for refresh |

### `src/lib/content.ts`
HTML processing and newsletter detection pipeline.

| Function | Description |
|---|---|
| `detectNewsletter(headers, rules)` | Rule + header heuristic detection |
| `sanitizeNewsletterHtml(html, sender)` | Full sanitize pipeline |
| `extractPublisherLogoUrl(html, sender)` | Find publisher logo in header |
| `extractSubstackArticleHtml(html)` | Substack-specific content extractor |
| `stripDuplicateLeadingHeading(html, subject)` | Remove redundant h1 if = subject |

### `src/lib/crypto.ts`
AES-256-GCM encryption. Key derived via SHA-256 of `APP_ENCRYPTION_KEY`.

- `encryptSecret(value)` → base64 string (IV + authTag + ciphertext)
- `decryptSecret(payload)` → plaintext

### `src/lib/admin.ts`
Admin dashboard logic. Requires service role key.

- `requireAdminPage()` — guards admin page
- `getAdminDashboardData()` — aggregates platform-wide stats

### `src/lib/types.ts`
All shared TypeScript types. Key types: `MessageRecord`, `SourceRecord`, `SenderRule`, `HomeData`, `LibraryData`, `SettingsData`.

---

## 9. Gmail Sync System

### How sync works end-to-end

```
POST /api/sync/run  (or /stream)
  │
  └── runSync()
        │
        ├── 1. Load email_account + sender_rules for user
        │
        ├── 2. For each NEW rule (synced_at is null):
        │     └── syncNewslettersFromGmail({ mode: 'backfill', lookbackDays: SYNC_LOOKBACK_DAYS })
        │           → Uses Gmail query: from:sender@domain.com newer_than:60d
        │           → Fetches matching messages, parses, saves
        │
        ├── 3. For existing rules (synced_at set):
        │     └── syncNewslettersFromGmail({ mode: 'incremental', historyId })
        │           → Tries Gmail history.list since last historyId
        │           → If history expired (404/400) → falls back to full query
        │
        ├── 4. For each fetched message (batches of 10):
        │     ├── upsertSource() — find or create newsletter_sources row
        │     └── upsertMessage() — upsert messages + message_bodies rows
        │           (state columns default to 'new', 0 progress on first insert)
        │           (on re-sync / conflict: metadata updated, state preserved)
        │
        ├── 5. pruneOldBodies()
        │     ├── Pass 1: null body content for messages >RETENTION_DAYS old
        │     │          (skips saved=true and archived=true)
        │     └── Pass 2: delete message rows >METADATA_RETENTION_DAYS old
        │                 (skips saved=true and archived=true)
        │
        ├── 6. Update email_accounts: history_id, last_synced_at, last_error
        │
        └── 7. If OAuth tokens were refreshed during sync: update encrypted tokens
```

### Gmail query format

For `sender_email` rules: `from:newsletter@example.com`
For `sender_domain` rules: `from:@example.com`
Combined: `(from:a@b.com OR from:@c.com) newer_than:Nd`

### Rate limiting

- Minimum 60 seconds between syncs, enforced in the API route by checking `last_synced_at`
- The sync itself processes messages in batches of 10 to avoid Gmail API quota bursts
- Maximum 500 messages per single sync run

### Incremental vs full sync

| Mode | When used | Mechanism |
|---|---|---|
| Incremental | Rule has been synced before AND historyId is valid | Gmail `history.list` API — only new messages since last sync |
| Full (fallback) | historyId expired (>7 days old) OR first sync for rule | Gmail `messages.list` with query + date filter |

### Token refresh

During sync, if the Gmail API triggers an OAuth token refresh, the new tokens are captured via an event listener on the OAuth2 client and re-encrypted and saved back to `email_accounts`.

---

## 10. Content Processing Pipeline

When a Gmail message is fetched, it goes through this pipeline:

```
Raw Gmail message (base64 MIME)
  │
  ├── extractBodyByMimeType()      — find text/html or text/plain part
  ├── decodeBase64Url()            — decode Gmail's base64url encoding
  ├── replaceCidUrls()             — inline CID attachments as data URLs
  │
  ├── detectNewsletter()           — check against rules + headers
  │     ├── Rule match: from:email or from:domain
  │     └── Header heuristics: List-Unsubscribe, List-ID, Precedence: bulk
  │
  ├── sanitizeNewsletterHtml()     — content pipeline
  │     ├── Platform-specific preprocessing:
  │     │     └── [Substack] extractSubstackArticleHtml()
  │     │           ├── Strip SVGs
  │     │           ├── Rescue featured image from header
  │     │           ├── Remove email chrome (nav, subscribe banners)
  │     │           ├── Stop at copyright/footer
  │     │           └── Rescue CTA button
  │     ├── sanitize-html with allowlist:
  │     │     └── Allowed tags: h1-h6, p, a, img, ul, ol, li, blockquote,
  │     │                       div, span, strong, em, br, hr, table, tr, td, th,
  │     │                       figure, figcaption, section, article, pre, code
  │     ├── Convert links → target="_blank" rel="noreferrer"
  │     └── Strip empty elements iteratively
  │
  ├── extractPublisherLogoUrl()    — find publisher logo for source card
  │     ├── Scan first portion of HTML before "read in app/browser" cutoff
  │     ├── Look for img with logo/profile/avatar/headshot in URL or alt
  │     └── Trust CDN domains: substackcdn.com, beehiiv.com, ghost.io, etc.
  │
  ├── stripDuplicateLeadingHeading() — remove h1-h3 if matches subject
  │
  └── estimateReadMinutes()        — word count / 220 WPM
```

### Newsletter detection methods (stored in `detection_method` column)

| Value | Meaning |
|---|---|
| `manual_include` | Matched a user include rule |
| `list_unsubscribe` | Has List-Unsubscribe header |
| `list_id` | Has List-ID header |
| `precedence_bulk` | Has Precedence: bulk header |
| `unknown` | Default if detection failed |

---

## 11. Reading State Machine

Messages follow this state lifecycle:

```
          [sync]
            │
            ▼
          'new'
            │
            │  [first open]
            ▼
         'opened'
            │
            │  [scroll starts]
            ▼
        'in_progress'
            │
            │  [scroll ≥ 95% OR marked done]
            ▼
         'finished'

At any point:
  [user saves]    → saved = true  (state unchanged)
  [user archives] → archived = true (state unchanged)
```

The `state` column and the `saved`/`archived` boolean flags are independent. A message can be `state = 'new'` and `saved = true` simultaneously.

**State update triggers:**
- Opening reader page → `opened` + sets `opened_at`
- Scrolling → `in_progress` + updates `progress_percent` + `last_scroll_position`
- Reaching end → `finished` + sets `finished_at`
- Clicking save → `saved = true`
- Clicking archive → `archived = true`

---

## 12. Data Retention & Pruning

Pruning runs automatically at the end of every sync via `pruneOldBodies()`.

### Pass 1 — Body prune (default: 45 days)

```sql
SELECT id FROM messages
WHERE user_id = ? AND saved = false AND archived = false
  AND received_at < NOW() - INTERVAL '45 days'
```

Then for matching IDs:
```sql
UPDATE message_bodies SET
  html_content = null,
  sanitized_html_content = null,
  text_content = null,
  extracted_readable_text = null
WHERE message_id IN (...)
```

Effect: Message metadata (subject, from, state, progress) is preserved. Full content is gone. Reader page shows "Content no longer available."

### Pass 2 — Row delete (default: 90 days)

```sql
DELETE FROM messages
WHERE user_id = ? AND saved = false AND archived = false
  AND received_at < NOW() - INTERVAL '90 days'
```

Effect: Entire message row deleted. Cascades to `message_bodies`.

### Exemptions

- `saved = true` → exempt from both passes. Kept forever.
- `archived = true` → exempt from both passes. Kept forever.
- Only way to remove saved/archived messages: user clicks "Delete data" or "Delete account."

### Configuration

| Variable | Default | Effect |
|---|---|---|
| `RETENTION_DAYS` | 45 | Days until body content is nulled |
| `METADATA_RETENTION_DAYS` | 90 | Days until message row is deleted |

---

## 13. Admin Dashboard

**Access:** `super_admin` role only. Set via direct DB insert into `lumen.profiles`.

**Metrics displayed:**
- Total registered users
- Active users (synced in last 7 days)
- Gmail-connected users
- Total messages across all users
- Average messages per user
- Signups chart (last 30 days, day buckets)
- Messages synced chart (last 30 days)
- Reading state breakdown (new / opened / in_progress / finished / saved / archived)
- Top 8 newsletter sources by number of subscribers
- User table: email, joined date, last sign-in, Gmail status, last sync time, message count, rule count

**Implementation notes:**
- Uses admin Supabase client with service role key (bypasses RLS to aggregate across all users)
- `auth.admin.listUsers({ perPage: 1000 })` — hard limit of 1000 users per fetch. Beyond 1000 users, pagination would be needed.
- All aggregation is done in application code (not SQL aggregates), which may be slow at scale.

---

## 14. Component Reference

| Component | Type | Location | Purpose |
|---|---|---|---|
| `AppShell` | Server | `app-shell.tsx` | Main layout: sidebar, nav, shell meta |
| `NewsletterCard` | Server | `newsletter-card.tsx` | Message list card |
| `NewsletterIcon` | Client | `newsletter-icon.tsx` | Source logo with fallback to favicon |
| `SettingsPanel` | Client | `settings-panel.tsx` | Settings page interactive UI |
| `SearchForm` | Client | `search-form.tsx` | Search input + live results |
| `OnboardingModal` | Client | `onboarding-modal.tsx` | First-time user guide |
| `ReaderProgress` | Client | `reader-progress.tsx` | Scroll tracker, state updater |
| `QuickSyncButton` | Client | `quick-sync-button.tsx` | Trigger sync |
| `SourceCard` | Server | `source-card.tsx` | Source list card |
| `GoogleSignInButton` | Client | `google-sign-in-button.tsx` | OAuth sign-in trigger |
| `SignOutButton` | Client | `sign-out-button.tsx` | Sign out action |
| `DeleteMessageButton` | Client | `delete-message-button.tsx` | Delete message action |
| `NavLink` | Client | `nav-link.tsx` | Navigation link with active state |
| `LoadingLink` | Client | `loading-link.tsx` | Link with loading indicator |
| `SetupState` | Server | `setup-state.tsx` | Empty state for unconfigured app |
| `TestLoginForm` | Client | `test-login-form.tsx` | Email/password form (demo mode only) |
| `RefreshContentButton` | Client | `refresh-content-button.tsx` | Re-fetch body from Gmail |

### NewsletterIcon — logo resolution logic

```
1. If stored logoUrl contains: logo / profile / avatar / headshot / author
   OR URL domain is substackcdn.com / beehiiv.com / ghost.io / mailchimp.com / convertkit.com
   → use stored logoUrl

2. Else if sender domain is known
   → use Google Favicon API: https://www.google.com/s2/favicons?domain=X&sz=64

3. Else
   → use stored logoUrl as fallback (may be wrong)
```

### ReaderProgress — scroll tracking

- Runs in a `useEffect` with `IntersectionObserver` + scroll listener
- Throttled to avoid excessive API calls
- Sends state update to `/api/messages/[id]/state` on:
  - First visible (→ `opened`)
  - Scroll movement (→ `in_progress` + progress_percent)
  - Scroll ≥ 95% (→ `finished`)
- Restores scroll position from `last_scroll_position` on re-open

---

## 15. Known Limitations

### Sync
- **Max 500 messages per sync.** If more than 500 new matching messages exist, they are silently truncated. Subsequent syncs will pick up more.
- **No scheduled/background sync.** Sync only runs when the user manually triggers it (via sync button or API call). There is no cron job or webhook.
- **Single Gmail account per user.** The schema supports multiple email_accounts but the UI and sync logic assume one per user.
- **historyId expires after ~7 days.** If the user doesn't sync for >7 days, Gmail's history API rejects the stale historyId and falls back to a full query. This can be slow for large inboxes.
- **No attachment support.** Only text/html and text/plain MIME parts are processed. PDF attachments or image-only emails are not supported.

### Content
- **Substack-specific preprocessing.** Only Substack emails get the full article extractor. Other platforms get generic HTML sanitization.
- **Logo extraction is heuristic.** Logo URLs are guessed based on position in HTML and URL patterns. May be wrong for some senders.
- **Images are not proxied.** Images load directly from sender CDNs. Broken images are possible if a newsletter's CDN changes or expires.
- **RefreshContentButton is not wired up.** The component exists but is not included in the reader page. Users cannot re-fetch body content via the UI (only via direct API call).

### Search
- **Only searches metadata.** Searches subject, from, snippet — does not search the full body text even though the GIN index exists.
- **Max 50 results.** No way to paginate search results.
- **No sorting.** Results come back in DB insertion order.

### Admin
- **1000-user limit.** `auth.admin.listUsers` fetches max 1000 users. Beyond that, pagination logic is needed.
- **No pagination on admin user table.** All users are rendered in a single table.
- **In-app aggregation.** Stats are computed in application code, not SQL. Will be slow at scale (1000+ users with many messages each).

### Data
- **90-day limit on unsaved messages.** Normal (not saved, not archived) messages are deleted after 90 days of `received_at`. This is by design but users need to be aware.
- **No export.** There is no way to export newsletter content or reading history.
- **No undo on delete.** Deleting a rule deletes all messages from that sender. There is no recovery path.

### Auth
- **Google OAuth only.** No email/password (except demo mode). No other providers.
- **One user per Google account.** No sharing, teams, or multiple users per household.

---

## 16. Production Deployment Checklist

### Supabase Setup
- [ ] Create Supabase project
- [ ] Run `supabase/schema.sql` in the SQL editor
- [ ] Go to Settings → API → Exposed Schemas → add `lumen`
- [ ] Confirm GRANT statements in schema.sql ran successfully
- [ ] Enable Google OAuth provider in Supabase Auth → Providers
- [ ] Set Google Client ID + Secret in Supabase Auth settings
- [ ] Set authorized redirect URI in Google Console: `https://your-project.supabase.co/auth/v1/callback`

### Google Cloud Console
- [ ] Create OAuth 2.0 credentials (Web application)
- [ ] Add authorized redirect URI: `https://your-app.vercel.app/api/integrations/gmail/callback`
- [ ] Enable Gmail API on the project
- [ ] Set OAuth consent screen (app name, logo, privacy URL, TOS URL)
- [ ] Add required scopes: `https://www.googleapis.com/auth/gmail.readonly`, `openid`, `email`, `profile`
- [ ] If app is in "Testing" mode, add test users; otherwise submit for verification

### Vercel Setup
- [ ] Connect GitHub repo to Vercel
- [ ] Set all required environment variables (see Section 3)
- [ ] Generate `APP_ENCRYPTION_KEY`: `openssl rand -hex 32`
- [ ] Set `NEXT_PUBLIC_APP_URL` to the final deployment URL
- [ ] Set `GMAIL_REDIRECT_URI` to `https://your-app.vercel.app/api/integrations/gmail/callback`
- [ ] Confirm build succeeds (Next.js TypeScript check must pass)

### First Deploy Verification
- [ ] Visit `/login` — Google sign-in button appears
- [ ] Sign in — redirected to home, no 500 errors
- [ ] Go to Settings — connect Gmail
- [ ] Add a sender rule
- [ ] Run sync — messages appear
- [ ] Open a message — reader renders, progress saves
- [ ] Check `/admin` — requires super_admin role (set via direct SQL)

### Admin Access
```sql
-- Run in Supabase SQL editor
insert into lumen.profiles (id, role)
values ('<your-user-uuid>', 'super_admin')
on conflict (id) do update set role = 'super_admin';
```
Get your user UUID from Supabase Auth → Users.

### Security checklist
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is NOT prefixed with `NEXT_PUBLIC_`
- [ ] `APP_ENCRYPTION_KEY` is NOT prefixed with `NEXT_PUBLIC_`
- [ ] `GOOGLE_CLIENT_SECRET` is NOT prefixed with `NEXT_PUBLIC_`
- [ ] RLS is enabled on all tables (verify in Supabase → Table Editor → each table)
- [ ] `NEXT_PUBLIC_ENABLE_TEST_LOGIN` is not set (or explicitly `false`) in production
