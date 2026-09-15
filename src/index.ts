import { config } from "./config";
import { fetchNewPosts, ensureLoggedIn, closeBrowser } from "./reddit";
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

// When each subreddit is next eligible, keyed by name. Everything starts at 0
// so the first pass covers the whole list, then each falls into its own cadence.
const nextDueAt = new Map<string, number>();

async function pollDue(): Promise<void> {
  const now = Date.now();
  for (const { name, intervalHours } of config.subreddits) {
    if ((nextDueAt.get(name) ?? 0) > now) continue;

    try {
      await pollSubreddit(name);
    } catch (err) {
      log(`Error polling r/${name}: ${(err as Error).message}`);
    }
    // Scheduled from completion, not from when it came due, so a slow poll
    // cannot make a subreddit immediately due again.
    nextDueAt.set(name, Date.now() + intervalHours * 3_600_000);
    await sleep(1000);
  }
}

async function main(): Promise<void> {
  await initDb();
  const byInterval = new Map<number, string[]>();
  for (const { name, intervalHours } of config.subreddits) {
    byInterval.set(intervalHours, [...(byInterval.get(intervalHours) ?? []), name]);
  }
  log(`Starting Auric Reddit lead watcher. Watching ${config.subreddits.length} subreddits:`);
  for (const hours of [...byInterval.keys()].sort((a, b) => a - b)) {
    log(`  every ${hours}h: ${byInterval.get(hours)!.join(", ")}`);
  }

  // Blocks until the browser profile holds a Reddit session. Without one every
  // listing request is answered with a redirect to the login page.
  await ensureLoggedIn();
  while (true) {
    await pollDue();
    await sleep(config.schedulerTickSeconds * 1000);
  }
}

// Close Chrome on the way out, otherwise the persistent profile keeps a lock
// that makes the next container start fail.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`Received ${signal}, shutting down.`);
    void closeBrowser().finally(() => process.exit(0));
  });
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  await closeBrowser();
  process.exit(1);
});
