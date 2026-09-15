# Auric Reddit Watcher

Watches a configurable list of subreddits, uses an LLM (via the local `llm-gateway`) to flag new posts that
are a genuine opportunity to mention [Auric](https://auric.cx), and turns the **author** of each
such post into a lead: it stores the person in Postgres and posts a Discord alert with a link to
their profile and a pre-filled compose-DM link. It never posts to Reddit itself — a human reviews
each lead and sends the DM manually.

## How it works

1. Each subreddit in `config/subreddits.json` has its own `intervalHours` (6h for the core
   audience, 12h by default), and a scheduler polls each one when it comes due. It fetches
   the newest posts using a **real, logged-in Chrome** driven by Playwright. Reddit
   answers logged-out JSON requests with a 302 to `/login` and flags headless Chrome, so the
   browser runs headful on an Xvfb virtual display with a persistent profile.

   > A logged-in browser is the only route left. The unauthenticated JSON endpoints are closed
   > to logged-out traffic regardless of User-Agent, and OAuth is not an alternative: the API
   > still serves anyone holding credentials, but Reddit stopped issuing new ones in response
   > to bot abuse, so there are none to obtain. Don't spend time registering a script app.
2. Dedup state (seen post IDs, primed subreddits) and the `leads` table live in **Neon Postgres**
   (`DATABASE_URL`). Tables are created automatically on startup. Nothing is processed twice, even
   across restarts or hosts.
3. The first poll for a subreddit (in `new` listing mode) only "primes" the baseline without
   capturing leads, so you don't get a backlog dump on first run.
4. Each new post is classified against a rubric describing Auric. The request goes to
   **`llm-gateway`**, which owns the shared NVIDIA key pool and ranks the `auric` project's model
   list, failing over automatically when a model is throttled or retired. If it's a match, the
   post's author is upserted into the `leads` table.
5. **A Discord alert fires only for a brand-new lead** — deduped by Reddit username, so a prolific
   author is captured (and pinged) exactly once. The alert centers on the person (profile link +
   compose-DM link), not the full post; the triggering post is linked for context.

## The `leads` table

| column             | notes                                             |
| ------------------ | ------------------------------------------------- |
| `username`         | primary key — Reddit author, deduped              |
| `subreddit`        | where the triggering post was found               |
| `post_id`          | Reddit post id                                    |
| `post_title`       | title of the triggering post                      |
| `post_permalink`   | permalink path of the triggering post             |
| `post_created_utc` | post creation time (unix seconds)                 |
| `reason`           | the classifier's rationale                        |
| `status`           | workflow status, defaults to `new`                |
| `created_at`       | when the lead was captured                        |

Track outreach by updating `status` (e.g. `new` → `dm_sent` → `replied`) yourself in Postgres.

## Setup

### 1. Postgres (Neon)

- Create a database at https://neon.tech and copy its connection string into `DATABASE_URL`.
- No manual migration needed — tables are created on first run.

### 2. Discord webhook

- In your Discord server: Channel Settings → Integrations → Webhooks → New Webhook → copy URL.

### 3. Classifier (llm-gateway)

No API key here — the watcher authenticates to `llm-gateway` with the project token `auric`
(`LLM_TOKEN`) and the gateway supplies keys from its pool. The model priority list lives in
`llm-gateway/projects.yml` under `projects.auric`, ordered from the
[nimstats leaderboard](https://nimstats.maurodruwel.be/). Editing that list needs no change here.

> The gateway mounts `projects.yml` as a **single-file bind mount**, so an editor that replaces the
> file (rather than truncating in place) detaches the mount and the container keeps serving the old
> copy. After editing, confirm with `docker exec llm-gateway grep -c auric /app/projects.yml`; if
> it reports 0, run `docker compose up -d --force-recreate` in `compose/llm-gateway`.

### 4. Configure

```
cp .env.example .env
# fill in DATABASE_URL and DISCORD_WEBHOOK_URL
```

Edit `config/subreddits.json` to change which subreddits are watched.

### 5. Log in to Reddit (once per deployment)

The browser profile is a named Docker volume, so this survives restarts and rebuilds. On first
start the watcher blocks and waits for a session, printing instructions. From your machine:

```
ssh -L 5900:127.0.0.1:5900 minty@homelab     # tunnel the VNC port
# then point any VNC client at 127.0.0.1:5900 and log in to Reddit
```

The port is published on `127.0.0.1` only, so it is never exposed to the LAN. To re-authenticate
later without restarting the poll loop: `docker compose exec auric-reddit-watcher npm run login`.

## Run (Docker)

```
docker compose up -d --build
```

- `restart: unless-stopped` means it survives crashes and reboots as long as Docker starts on boot.
- Logs: `docker compose logs -f`
- Update after editing `config/subreddits.json`: `docker compose restart`
- Update after code changes: `docker compose up -d --build`

## Run without Docker (for local testing)

Needs a real display — the browser runs headful. This works on a desktop, not on the headless
homelab box (which has no X session; that is what the container's Xvfb provides).

```
npm install
npx playwright install chromium
npm run dev
```

## Notes / tuning

- Poll cadence is per subreddit, set by `intervalHours` in `config/subreddits.json`
  (`defaultIntervalHours` covers any entry that omits it). `SCHEDULER_TICK_SECONDS` only controls
  how often the scheduler checks what is due — it is not the poll rate.
- `CLASSIFIER_MODEL` is blank by default, which lets the gateway rank the `auric` project's
  models. Setting it pins that model first and leaves the project list as its fallbacks. If a
  model doesn't support tool calling, `classify.ts` falls back to parsing a raw JSON object from
  its response.
- If every listing errors with a redirect to `/login`, the Reddit session has expired — re-run the
  login step above.
- To reset and re-scan everything (e.g. after changing the rubric), `TRUNCATE seen_posts,
  primed_subreddits` in Postgres. To clear captured people, `TRUNCATE leads`.
- Auto-sending Reddit DMs is intentionally **not** done here — it requires an authenticated Reddit
  account and risks ToS/spam bans. This tool collects and surfaces leads for manual outreach.
