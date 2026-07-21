# Auric Reddit Watcher

Watches a configurable list of subreddits, uses an NVIDIA NIM-hosted LLM to flag new posts that
are a genuine opportunity to mention [Auric](https://auric.cx), and posts the link + reasoning to
a Discord channel. It never posts to Reddit itself — a human reviews and comments manually.

## How it works

1. Every `POLL_INTERVAL_SECONDS`, it fetches the newest posts from each subreddit in
   `config/subreddits.json` via Reddit's OAuth API.
2. New post IDs are recorded in a local SQLite DB (`data/watcher.db`) so nothing is processed
   twice, even across restarts.
3. The first poll for a subreddit only "primes" the baseline (records existing posts) without
   notifying, so you don't get a backlog dump on first run.
4. Each new post is sent to an NVIDIA NIM model with a rubric describing Auric and what makes a
   post worth commenting on. If it's a match, the post link + reasoning is sent to your Discord
   webhook.

## Setup

### 1. Reddit API credentials

- Go to https://www.reddit.com/prefs/apps → "create another app" → type **script**.
- Note the client ID (under the app name) and client secret.

### 2. Discord webhook

- In your Discord server: Channel Settings → Integrations → Webhooks → New Webhook → copy URL.

### 3. NVIDIA NIM API key

- From https://build.nvidia.com/ → sign in → any model page → "Get API Key".

### 4. Configure

```
cp .env.example .env
# fill in REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT,
# NVIDIA_API_KEY, DISCORD_WEBHOOK_URL
```

Edit `config/subreddits.json` to change which subreddits are watched — no rebuild needed if
running via Docker with the volume mount below, just restart the container.

## Run on the laptop (Docker)

```
docker compose up -d --build
```

- `restart: unless-stopped` in `docker-compose.yml` means it survives crashes and reboots as long
  as Docker itself starts on boot. On Linux, enable that once with:
  ```
  sudo systemctl enable docker
  ```
- Logs: `docker compose logs -f`
- Update after editing `config/subreddits.json`: `docker compose restart`
- Update after code changes: `docker compose up -d --build`

## Run without Docker (for local testing)

```
npm install
npm run dev
```

## Notes / tuning

- Default poll interval is 5 minutes across 7 subreddits — well within Reddit's and NVIDIA NIM's
  rate limits. Increase `POLL_INTERVAL_SECONDS` if you add many more subreddits.
- `CLASSIFIER_MODEL` defaults to `meta/llama-3.3-70b-instruct`; swap to any other NIM model that
  supports tool calling by setting `CLASSIFIER_MODEL` in `.env` (browse models at
  https://build.nvidia.com/). If a model doesn't support tool calling, `classify.ts` falls back
  to parsing a raw JSON object from its response.
- To reset and re-scan everything (e.g. after changing the classification rubric), stop the
  container and delete `data/watcher.db`.
