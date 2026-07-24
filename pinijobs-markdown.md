# Pini Jobs — Job Application Tracker

A personal PWA + chat-agent system for tracking job applications, built as a plugin on top of **NanoClaw v2** (a self-hosted personal-assistant framework: Node host + per-conversation Docker "agent" containers running Claude, talking to SQLite over a channel-adapter model). This spec describes the system well enough to recreate it standalone (outside NanoClaw) or port it into a new stack.

## 1. Concept

- One user (Pini), one job search. Track applications through a pipeline: `saved → applied → screening → interview → offer / rejected / withdrawn`.
- Two ways to add/update data:
  1. **Manual** — a mobile-first Kanban PWA.
  2. **Automatic** — a scheduled agent scans Gmail every 3 hours for application-related email (confirmations, interview invites, rejections, offers, recruiter outreach), matches it to an existing application by company/domain, and updates status/events itself.
- A **chat tab** in the same PWA lets you talk to the same agent in natural language ("Applied to Wix as Staff Engineer via LinkedIn, recruiter call Thursday 3pm") and it parses + records it.
- Push notifications (Web Push/VAPID) for chat replies and sync summaries.

## 2. Data model (SQLite)

```sql
CREATE TABLE applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company     TEXT NOT NULL,
  role_title  TEXT NOT NULL,
  source      TEXT,             -- e.g. 'linkedin', 'referral'
  url         TEXT,
  location    TEXT,
  salary      TEXT,
  contact     TEXT,
  status      TEXT NOT NULL DEFAULT 'applied',  -- saved|applied|screening|interview|offer|rejected|withdrawn
  applied_at  TEXT,
  notes       TEXT,
  description TEXT,
  requirements TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  ts             TEXT NOT NULL DEFAULT (datetime('now')),
  type           TEXT NOT NULL,   -- note|appointment|reminder|email|learn|status_change
  detail         TEXT,
  due_at         TEXT             -- ISO datetime, for appointment/reminder
);
CREATE INDEX idx_events_app ON events(application_id, ts);
CREATE INDEX idx_events_due ON events(due_at) WHERE due_at IS NOT NULL;

-- Tracks Gmail scan watermark + failure-notification throttle
CREATE TABLE email_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  last_scanned_ts   TEXT,
  seen_ids          TEXT DEFAULT '[]',
  last_notified_ts  TEXT   -- throttles "Gmail broken" push to ~1x/20h
);
```

Matching a company+role that already exists updates in place instead of duplicating (dedup key: lower(company)+lower(role)).

## 3. Backend API (Node/Express-style HTTP; original impl: `src/channels/web-jobs.ts`, ~740 lines)

Single Bearer token auth (`Authorization: Bearer <WEBAPP_JOBS_TOKEN>` → maps to the one user). Domain-gated: only serves requests whose Host header matches a configured public URL, so it can share a port/process with other apps.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Serve the PWA (`index.html`) |
| GET | `/*` | Static files from webapp dir |
| POST | `/api/chat` | Send a chat message → forwarded to the agent pipeline |
| GET | `/api/chat?since=N` | Poll for new agent replies (long-poll style) |
| GET | `/api/applications` | List applications, optional `?status=` filter |
| POST | `/api/applications` | Create an application |
| GET | `/api/applications/:id` | Get one application + its full event timeline |
| PATCH | `/api/applications/:id` | Update fields; a status change auto-inserts a `status_change` event |
| DELETE | `/api/applications/:id` | Delete (cascades events) |
| POST | `/api/applications/:id/events` | Add a timeline event |
| GET | `/api/events/upcoming` | All events with a future `due_at`, across all apps |
| GET | `/api/email-state` | Current `last_scanned_ts` for the "last synced" pill |
| POST | `/api/gmail-sync` | Trigger an immediate Gmail scan (same as the scheduled job, on demand) |
| GET | `/api/push/public-key` | VAPID public key for client subscription |
| POST | `/api/push/subscribe` | Save a Web Push subscription |
| POST | `/api/push/unsubscribe` | Remove it |

Env vars: `WEBAPP_JOBS_TOKEN_PINI`, `JOBS_PUBLIC_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

## 4. Frontend (PWA — vanilla JS, no framework; `index.html` + `app.js` ~640 lines + `style.css` ~690 lines)

Mobile-first, installable PWA (manifest + service worker for offline shell + push).

**Layout:** header with an add (`+`) button → 3 bottom-nav tabs:
1. **Board** — Kanban columns by status, one card per application (company, role, days-since, source badge). A "sync" pill button triggers `/api/gmail-sync` on demand and shows last-synced time.
2. **Upcoming** — flat list of all events with a future `due_at`, soonest first (interviews, reminders).
3. **Chat** — message thread with the agent; free-text input, poll-based delivery of replies, unread badge on the nav tab.

Tapping a card opens a **detail sheet**: full fields, editable, full event timeline, delete button, "add event" mini-modal (type + detail + optional due date). An add/edit modal covers company/role/source/url/location/salary/contact/status/applied_at/notes/description/requirements.

Push: registers the service worker, asks permission, subscribes via VAPID public key, used for chat-reply and sync-summary notifications when the tab isn't open.

## 5. The agent (Claude, tool-using)

Runs as a scheduled + on-demand job (in the original: a NanoClaw "agent group" container with `provider: claude`, Python 3 installed for the record-keeping script, Claude Code skills mounted).

**System prompt behavior (`CLAUDE.local.md`):**
- Identity: personal job-application assistant, English.
- All DB writes go through one script (see §6), never raw SQL from the agent — keeps validation and dedup in one place.
- **Free-text parsing**: given a natural message like *"Applied to Wix as a Staff Engineer via LinkedIn, recruiter call Thursday 3pm"*, extract company/role/status/source + any event (type + due date, computing the ISO date from relative text), then `upsert_app` followed by `add_event`. Always confirm back in 1-2 lines.
- **Gmail inbox scan** (manual or scheduled, every 3h):
  1. Read `email_state` for `last_scanned_ts`.
  2. Search Gmail since that date for application-relevant mail (interview/application/assessment/offer/rejection/recruiter keywords).
  3. Classify each: `confirmation` (→ status `applied`), `interview_invite` (→ appointment event + status `interview`), `assessment` (→ reminder event), `offer`/`rejection` (→ status change), `recruiter_outreach` (→ new `saved` app + email event), `irrelevant` (skip).
  4. Match to an existing application by company name / sender domain; if ambiguous, ask the user rather than guessing.
  5. Update `last_scanned_ts` to now.
  6. Push a short summary ("Scanned inbox — 2 updates: 1 interview, 1 rejection." or "Scanned inbox — nothing new.").
  - **Safety rule:** read-only Gmail scope only (`gmail.readonly`); the agent is never granted send/delete/modify tools, and never auto-updates on an ambiguous match without asking.
  - **On auth failure** (see §7): don't retry, don't guess — call the throttled health-check and push a reconnect notice at most once per ~20h, then stop for that run.
- Can `WebFetch` a job-posting URL to summarize it into `description`/`requirements`.

## 6. The record-keeping script (`record_job.py`, ~300 lines, stdlib + sqlite3 only)

CLI tool, one action per DB mutation, JSON out on stdout — this is the agent's *only* write path to the DB (never raw SQL), so validation/dedup lives in one place instead of the LLM's judgment:

```
--action upsert_app         --company --role --status --source --url --location --salary --contact --applied-at [--app-id] --db <path>
--action add_event          --app-id --type --detail [--due-at] --db <path>
--action update_status      --app-id --status --db <path>
--action list                [--status] --db <path>
--action get                 --app-id --db <path>
--action email_state          --db <path>
--action update_email_state  --last-scanned-ts --seen-ids --db <path>
--action scan_health          --db <path>      # see §7
```

`upsert_app` matches on `lower(company)+lower(role)` when `--app-id` isn't given, so re-processing the same email twice doesn't duplicate. `update_status`/status-changing `upsert_app` auto-insert a `status_change` event.

## 7. Gmail integration & auth (the part most likely to bite you on a rebuild)

Gmail access goes through a credential-proxy pattern rather than storing real OAuth tokens in the agent's filesystem:
- The agent container only ever sees a **stub credentials file** (`{"access_token": "onecli-managed", "refresh_token": "onecli-managed", ...}`) — never a real token.
- A local gateway process intercepts outbound calls to `gmail.googleapis.com` and injects the real bearer token at request time, out of the agent's reach.
- The MCP server used: `@gongrzhe/server-gmail-autoauth-mcp`, exposed as `mcp__gmail__search_emails` / `mcp__gmail__read_email` (readonly) only — write/send/delete tools intentionally never wired.

**If you don't have that proxy infra, the simplest rebuild is:** do a normal Google OAuth installed-app flow yourself, store the refresh token, and refresh it in your own backend before each scan.

**⚠️ Known permanent gotcha, confirmed by direct investigation (2026-07-24):** Google auto-expires OAuth refresh tokens after **exactly 7 days** for any app whose OAuth consent screen is in **"Testing"** publish status. Since this is a personal (non-Workspace) Gmail account, "Internal" app type isn't available, so it's stuck in "Testing" — and removing the 7-day cap requires Google's full sensitive-scope verification (weeks-long process, needs a public privacy policy + homepage), which is disproportionate for a single-user tool. **Budget for reconnecting the Gmail OAuth grant roughly every 7 days.** There is no code fix for this.

**Silent-failure trap to avoid on rebuild:** when the refresh token dies, `search_emails` starts erroring on every scheduled run. Don't let the agent "decide" on its own whether to notify — that degrades into silently swallowing the failure for days (this literally happened: it noticed once, told itself "already notified," and stayed silent for 3+ days before the user noticed the tracker had gone stale). Instead, make notification a deterministic function of stored state, not an LLM judgment call:
- `scan_health` action: on scan failure, checks `last_notified_ts`; if null or ≥20h old, push a reconnect notification and stamp `last_notified_ts = now`; otherwise stay silent. A successful scan clears `last_notified_ts` so the next real failure notifies immediately.
- This can only detect the outage *after* it starts (no visibility into the OAuth connect timestamp from inside a sandboxed agent) — it's not a pre-emptive warning, just a guarantee the user actually hears about it once broken.

## 8. Deployment shape (original instance, for reference — adapt to your own infra)

- Domain `pinijobs.duckdns.org`, same VPS as another personal bot, Traefik reverse-proxy → Node process on `:3000`.
- Single-process host handles routing by Host header to this app's handler before falling through to other apps on the same port.
- SQLite file per app, no external DB server.
- Web Push via VAPID keypair, subscriptions stored in a small table (not shown above — add `push_subscriptions(endpoint, keys_json)` if rebuilding).

## 9. Minimum viable rebuild checklist

1. SQLite schema (§2).
2. A small HTTP API (§3) — auth can be as simple as one static bearer token for a single-user tool.
3. Static PWA frontend: 3-tab bottom nav (Board/Upcoming/Chat), Kanban board, detail sheet, add/edit modal (§4).
4. An LLM call (any provider) with tool-access to a `record_job`-equivalent script (§6), given either a Gmail-search tool or a manual chat message as input, following the classification rules in §5.
5. If wiring Gmail: expect and design for the 7-day reconnect cadence up front (§7) — build the throttled-notify-on-failure logic from day one rather than retrofitting it after a silent multi-day outage.
