import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "watcher.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS seen_posts (
    id TEXT PRIMARY KEY,
    subreddit TEXT NOT NULL,
    created_utc INTEGER NOT NULL,
    processed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS primed_subreddits (
    subreddit TEXT PRIMARY KEY,
    primed_at INTEGER NOT NULL
  );
`);

const hasSeenStmt = db.prepare("SELECT 1 FROM seen_posts WHERE id = ?");
const markSeenStmt = db.prepare(
  "INSERT OR IGNORE INTO seen_posts (id, subreddit, created_utc, processed_at) VALUES (?, ?, ?, ?)"
);
const isPrimedStmt = db.prepare("SELECT 1 FROM primed_subreddits WHERE subreddit = ?");
const markPrimedStmt = db.prepare(
  "INSERT OR IGNORE INTO primed_subreddits (subreddit, primed_at) VALUES (?, ?)"
);

export function hasSeen(postId: string): boolean {
  return hasSeenStmt.get(postId) !== undefined;
}

export function markSeen(postId: string, subreddit: string, createdUtc: number): void {
  markSeenStmt.run(postId, subreddit, createdUtc, Date.now());
}

export function isPrimed(subreddit: string): boolean {
  return isPrimedStmt.get(subreddit) !== undefined;
}

export function markPrimed(subreddit: string): void {
  markPrimedStmt.run(subreddit, Date.now());
}
