import { config } from "./config";
import { fetchNewPosts } from "./reddit";
import { classifyPost } from "./classify";
import { notifyDiscord } from "./discord";
import { hasSeen, markSeen, isPrimed, markPrimed } from "./db";

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSubreddit(subreddit: string): Promise<void> {
  const posts = await fetchNewPosts(subreddit, config.postsPerPoll);
  const unseen = posts.filter((post) => !hasSeen(post.id));

  if (!isPrimed(subreddit)) {
    // First time seeing this subreddit: record the current front page as a
    // baseline without notifying, so startup doesn't dump a backlog of alerts.
    for (const post of unseen) {
      markSeen(post.id, subreddit, post.created_utc);
    }
    markPrimed(subreddit);
    log(`Primed r/${subreddit} with ${unseen.length} existing posts (no notifications sent).`);
    return;
  }

  for (const post of unseen) {
    markSeen(post.id, subreddit, post.created_utc);

    try {
      const classification = await classifyPost(post);
      if (classification.worthy) {
        await notifyDiscord(post, classification);
        log(`Flagged: r/${subreddit} "${post.title}" — ${classification.reason}`);
      } else {
        log(`Skipped: r/${subreddit} "${post.title}" — ${classification.reason}`);
      }
    } catch (err) {
      log(`Error processing post ${post.id} in r/${subreddit}: ${(err as Error).message}`);
    }

    // small pacing delay to stay well under Reddit/Anthropic/Discord rate limits
    await sleep(1000);
  }
}

async function pollAll(): Promise<void> {
  for (const subreddit of config.subreddits) {
    try {
      await pollSubreddit(subreddit);
    } catch (err) {
      log(`Error polling r/${subreddit}: ${(err as Error).message}`);
    }
    await sleep(1000);
  }
}

async function main(): Promise<void> {
  log(`Starting Auric Reddit watcher. Watching: ${config.subreddits.join(", ")}`);
  log(`Poll interval: ${config.pollIntervalSeconds}s`);

  while (true) {
    await pollAll();
    await sleep(config.pollIntervalSeconds * 1000);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
