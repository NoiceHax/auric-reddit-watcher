import { Pool } from "pg";
import { config } from "./config";
import type { RedditPost } from "./reddit";
import type { ClassificationResult } from "./classify";

// Single Neon Postgres pool for the whole process. Neon requires SSL; Neon's
// certs are valid, but rejectUnauthorized:false keeps this robust across the
// pooler endpoint / self-signed intermediates without extra CA config.
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
});

// Create tables on startup. Called once from index.ts before polling begins.
export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seen_posts (
      id TEXT PRIMARY KEY,
      subreddit TEXT NOT NULL,
      created_utc BIGINT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS primed_subreddits (
      subreddit TEXT PRIMARY KEY,
      primed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One row per person worth reaching out to. Deduped by reddit username so a
    -- prolific author is only ever captured (and notified) once.
    CREATE TABLE IF NOT EXISTS leads (
      username TEXT PRIMARY KEY,
      subreddit TEXT NOT NULL,
      post_id TEXT NOT NULL,
      post_title TEXT NOT NULL,
      post_permalink TEXT NOT NULL,
      post_created_utc BIGINT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function hasSeen(postId: string): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM seen_posts WHERE id = $1", [postId]);
  return res.rowCount! > 0;
}

export async function markSeen(
  postId: string,
  subreddit: string,
  createdUtc: number
): Promise<void> {
  await pool.query(
    "INSERT INTO seen_posts (id, subreddit, created_utc) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [postId, subreddit, createdUtc]
  );
}

export async function isPrimed(subreddit: string): Promise<boolean> {
  const res = await pool.query("SELECT 1 FROM primed_subreddits WHERE subreddit = $1", [
    subreddit,
  ]);
  return res.rowCount! > 0;
}

export async function markPrimed(subreddit: string): Promise<void> {
  await pool.query(
    "INSERT INTO primed_subreddits (subreddit) VALUES ($1) ON CONFLICT (subreddit) DO NOTHING",
    [subreddit]
  );
}

// Record a person as a lead. Returns true only when this username was newly
// inserted, so the caller notifies Discord exactly once per person (a later
// worthy post from the same author is a no-op).
export async function upsertLead(
  post: RedditPost,
  classification: ClassificationResult
): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO leads (username, subreddit, post_id, post_title, post_permalink, post_created_utc, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (username) DO NOTHING
     RETURNING username`,
    [
      post.author,
      post.subreddit,
      post.id,
      post.title,
      post.permalink,
      post.created_utc,
      classification.reason,
    ]
  );
  return res.rowCount! > 0;
}
