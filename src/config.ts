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

const subredditsPath = path.join(__dirname, "..", "config", "subreddits.json");
const subredditsFile = JSON.parse(fs.readFileSync(subredditsPath, "utf-8")) as {
  subreddits: string[];
};

export const config = {
  reddit: {
    clientId: required("REDDIT_CLIENT_ID"),
    clientSecret: required("REDDIT_CLIENT_SECRET"),
    userAgent: required("REDDIT_USER_AGENT"),
  },
  nvidia: {
    apiKey: required("NVIDIA_API_KEY"),
    baseUrl: process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
  },
  discordWebhookUrl: required("DISCORD_WEBHOOK_URL"),
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS ?? 300),
  postsPerPoll: Number(process.env.POSTS_PER_POLL ?? 25),
  classifierModel: process.env.CLASSIFIER_MODEL ?? "meta/llama-3.3-70b-instruct",
  subreddits: subredditsFile.subreddits,
};
