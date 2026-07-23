import { config } from "./config";
import { fetchNewPosts } from "./reddit";
import { classifyPost } from "./classify";
import { notifyLead } from "./discord";
import { initDb, hasSeen, markSeen, isPrimed, markPrimed, upsertLead } from "./db";

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Authors that aren't real people to reach out to.
function isReachableAuthor(author: string): boolean {
  if (!author) return false;
  const lower = author.toLowerCase();
  return lower !== "[deleted]" && lower !== "automoderator";
}

async function pollSubreddit(subreddit: string): Promise<void> {
  const posts = await fetchNewPosts(subreddit, config.postsPerPoll);
  const seenFlags = await Promise.all(posts.map((post) => hasSeen(post.id)));
  const unseen = posts.filter((_, i) => !seenFlags[i]);

  // Priming only applies to the "new" listing: there the startup backlog is
  // noise. For "hot"/"top" the current listing IS the content we want to
  // classify, so we process it from the very first poll.
  if (config.redditListing === "new" && !(await isPrimed(subreddit))) {
    // First time seeing this subreddit: record the current front page as a
    // baseline without notifying, so startup doesn't dump a backlog of leads.
    for (const post of unseen) {
      await markSeen(post.id, subreddit, post.created_utc);
    }
    await markPrimed(subreddit);
    log(`Primed r/${subreddit} with ${unseen.length} existing posts (no leads captured).`);
    return;
  }

  for (const post of unseen) {
    await markSeen(post.id, subreddit, post.created_utc);

    try {
      const classification = await classifyPost(post);
      if (!classification.worthy) {
        log(`Skipped: r/${subreddit} "${post.title}" — ${classification.reason}`);
      } else if (!isReachableAuthor(post.author)) {
        log(`Worthy but unreachable author (${post.author}): r/${subreddit} "${post.title}"`);
      } else {
        // Store the person as a lead; only a brand-new lead triggers a Discord
        // ping, so we never notify twice for the same author.
        const isNewLead = await upsertLead(post, classification);
        if (isNewLead) {
          await notifyLead(post, classification);
          log(`Lead: u/${post.author} (r/${subreddit}) — ${classification.reason}`);
        } else {
          log(`Already a lead: u/${post.author} (r/${subreddit}) — skipped notification.`);
        }
      }
    } catch (err) {
      log(`Error processing post ${post.id} in r/${subreddit}: ${(err as Error).message}`);
    }

    // small pacing delay to stay well under Reddit/NVIDIA/Discord rate limits
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
  await initDb();
  log(`Starting Auric Reddit lead watcher. Watching: ${config.subreddits.join(", ")}`);
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
