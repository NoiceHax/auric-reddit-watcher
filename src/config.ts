import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  const value = process.env[name];
  // Treat a blank/whitespace value the same as unset so an empty line in .env
  // (e.g. REDDIT_USER_AGENT=) falls back instead of sending an empty string.
  return value && value.trim() !== "" ? value : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export interface WatchedSubreddit {
  name: string;
  intervalHours: number;
}

// Entries may be a bare string (inherits defaultIntervalHours) or an object
// with its own intervalHours, so busy communities can be polled more often
// than slow ones without a separate config file.
type SubredditEntry = string | { name: string; intervalHours?: number };

const subredditsPath = path.join(__dirname, "..", "config", "subreddits.json");
const subredditsFile = JSON.parse(fs.readFileSync(subredditsPath, "utf-8")) as {
  defaultIntervalHours?: number;
  subreddits: SubredditEntry[];
};

const defaultIntervalHours = subredditsFile.defaultIntervalHours ?? 12;

const watchedSubreddits: WatchedSubreddit[] = subredditsFile.subreddits.map((entry) => {
  const name = typeof entry === "string" ? entry : entry.name;
  const intervalHours =
    typeof entry === "string" ? defaultIntervalHours : entry.intervalHours ?? defaultIntervalHours;
  if (!name) throw new Error(`Subreddit entry missing a name: ${JSON.stringify(entry)}`);
  if (!(intervalHours > 0)) {
    throw new Error(`Subreddit ${name} has a non-positive intervalHours: ${intervalHours}`);
  }
  return { name, intervalHours };
});

export const config = {
  reddit: {
    // Empty means "use the browser's own User-Agent". Overriding it with a
    // hand-written string is what made the old fetch mode detectable, so this
    // is only here as an escape hatch.
    userAgent: optional("REDDIT_USER_AGENT", ""),
  },
  browser: {
    // Persistent Chrome profile: the Reddit login survives restarts, so the
    // one-time interactive login is genuinely one-time.
    profileDir: optional("BROWSER_PROFILE_DIR", "/data/browser-profile"),
    // Headful by default. Reddit blocks headless Chrome; a real browser on a
    // virtual display (Xvfb) is what gets served actual JSON.
    headless: bool("BROWSER_HEADLESS", false),
    navigationTimeoutMs: Number(process.env.BROWSER_NAV_TIMEOUT_MS ?? 45000),
    // How long to wait at startup for a human to complete the Reddit login.
    loginWaitSeconds: Number(process.env.LOGIN_WAIT_SECONDS ?? 900),
  },
  llm: {
    // Routed through llm-gateway: it owns the NVIDIA key pool and fails over
    // when a model is retired, which is what took this service down before.
    baseUrl: optional("LLM_BASE_URL", "http://llm-gateway:8080/v1"),
    // The gateway maps this bearer token to a project profile in projects.yml.
    token: optional("LLM_TOKEN", "auric"),
  },
  discordWebhookUrl: required("DISCORD_WEBHOOK_URL"),
  // Neon Postgres connection string — holds dedup state and the leads table.
  databaseUrl: required("DATABASE_URL"),
  // How often the scheduler wakes to see which subreddits are due. This is not
  // the poll rate — each subreddit has its own intervalHours.
  schedulerTickSeconds: Number(process.env.SCHEDULER_TICK_SECONDS ?? 60),
  postsPerPoll: Number(process.env.POSTS_PER_POLL ?? 25),
  // Which listing to poll: "new" (default), "hot", or "top".
  // "top" is scoped by redditTopTime (hour/day/week/month/year/all).
  redditListing: (process.env.REDDIT_LISTING ?? "new") as "new" | "hot" | "top",
  redditTopTime: process.env.REDDIT_TOP_TIME ?? "day",
  // Empty means "let the gateway rank the project's models". Setting one
  // pins that model first and leaves the project list as its fallbacks.
  classifierModel: optional("CLASSIFIER_MODEL", ""),
  classifyTimeoutMs: Number(process.env.CLASSIFY_TIMEOUT_MS ?? 30000),
  // Reasoning models emit chain-of-thought before the verdict; 300 truncated
  // them mid-thought and roughly a third of posts came back unparsable.
  classifyMaxTokens: Number(process.env.CLASSIFY_MAX_TOKENS ?? 1500),
  subreddits: watchedSubreddits,
};
