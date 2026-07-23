# Auric Reddit Watcher

Watches a configurable list of subreddits, uses an NVIDIA NIM-hosted LLM to flag new posts that
are a genuine opportunity to mention [Auric](https://auric.cx), and turns the **author** of each
such post into a lead: it stores the person in Postgres and posts a Discord alert with a link to
their profile and a pre-filled compose-DM link. It never posts to Reddit itself — a human reviews
each lead and sends the DM manually.

## How it works

1. Every `POLL_INTERVAL_SECONDS`, it fetches the newest posts from each subreddit in
   `config/subreddits.json` (public browser-session mode by default; OAuth optional).
2. Dedup state (seen post IDs, primed subreddits) and the `leads` table live in **Neon Postgres**
   (`DATABASE_URL`). Tables are created automatically on startup. Nothing is processed twice, even
   across restarts or hosts.
3. The first poll for a subreddit (in `new` listing mode) only "primes" the baseline without
   capturing leads, so you don't get a backlog dump on first run.
4. Each new post is classified by an NVIDIA NIM model against a rubric describing Auric. If it's a
   match, the post's author is upserted into the `leads` table.
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

### 3. NVIDIA NIM API key

- From https://build.nvidia.com/ → sign in → any model page → "Get API Key".

### 4. Configure

```
cp .env.example .env
# fill in DATABASE_URL, NVIDIA_API_KEY, DISCORD_WEBHOOK_URL
# (Reddit creds only needed if REDDIT_USE_PUBLIC=false)
```

Edit `config/subreddits.json` to change which subreddits are watched.

## Run (Docker)

```
docker compose up -d --build
```

- `restart: unless-stopped` means it survives crashes and reboots as long as Docker starts on boot.
- Logs: `docker compose logs -f`
- Update after editing `config/subreddits.json`: `docker compose restart`
- Update after code changes: `docker compose up -d --build`

## Run without Docker (for local testing)

```
npm install
npm run dev
```

## Notes / tuning

- Default poll interval is 5 minutes — well within Reddit's and NVIDIA NIM's rate limits. Increase
  `POLL_INTERVAL_SECONDS` if you add many more subreddits.
- `CLASSIFIER_MODEL` defaults to `meta/llama-3.1-8b-instruct` (fast and reliable on NIM's free
  tier; the 70b models frequently stall there). Swap to any other tool-calling NIM model via
  `.env`. If a model doesn't support tool calling, `classify.ts` falls back to parsing a raw JSON
  object from its response.
- To reset and re-scan everything (e.g. after changing the rubric), `TRUNCATE seen_posts,
  primed_subreddits` in Postgres. To clear captured people, `TRUNCATE leads`.
- Auto-sending Reddit DMs is intentionally **not** done here — it requires an authenticated Reddit
  account and risks ToS/spam bans. This tool collects and surfaces leads for manual outreach.
