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

// A recent desktop Chrome User-Agent. Used so the watcher's requests blend in
// with a human browsing/commenting Reddit at the same time, rather than looking
// like a separate bot client.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Public mode fetches Reddit's unauthenticated JSON endpoints with a browser
// User-Agent (no OAuth). OAuth mode uses the official API and needs client creds.
const usePublicApi = bool("REDDIT_USE_PUBLIC", true);

const subredditsPath = path.join(__dirname, "..", "config", "subreddits.json");
const subredditsFile = JSON.parse(fs.readFileSync(subredditsPath, "utf-8")) as {
  subreddits: string[];
};

export const config = {
  reddit: {
    usePublicApi,
    // In public mode we don't need Reddit API credentials at all.
    clientId: usePublicApi ? optional("REDDIT_CLIENT_ID") : required("REDDIT_CLIENT_ID"),
    clientSecret: usePublicApi
      ? optional("REDDIT_CLIENT_SECRET")
      : required("REDDIT_CLIENT_SECRET"),
    // Default to a browser UA; still overridable via env.
    userAgent: optional("REDDIT_USER_AGENT", BROWSER_USER_AGENT),
  },
  nvidia: {
    apiKey: required("NVIDIA_API_KEY"),
    baseUrl: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  },
  discordWebhookUrl: required("DISCORD_WEBHOOK_URL"),
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 300),
  postsPerPoll: Number(process.env.POSTS_PER_POLL ?? 25),
  classifierModel: process.env.CLASSIFIER_MODEL ?? "meta/llama-3.1-8b-instruct",
  classifyTimeoutMs: Number(process.env.CLASSIFY_TIMEOUT_MS ?? 30000),
  subreddits: subredditsFile.subreddits,
};
