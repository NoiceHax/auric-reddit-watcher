import { config } from "./config";
import type { RedditPost } from "./reddit";
import type { ClassificationResult } from "./classify";

// Notify Discord about a *person* to DM, not the post itself. The post is only
// the trigger — the payload centers on the lead: who they are, a link to their
// profile, and a pre-filled compose-DM link to reach out.
export async function notifyLead(
  post: RedditPost,
  classification: ClassificationResult
): Promise<void> {
  const profileUrl = `https://www.reddit.com/user/${post.author}`;
  const composeDmUrl = `https://www.reddit.com/message/compose/?to=${encodeURIComponent(post.author)}`;
  const postUrl = `https://www.reddit.com${post.permalink}`;

  const embed = {
    title: `u/${post.author}`,
    url: profileUrl,
    description: classification.reason.slice(0, 1000),
    color: 0xd4af37,
    fields: [
      { name: "Subreddit", value: `r/${post.subreddit}`, inline: true },
      { name: "Send DM", value: `[Compose message](${composeDmUrl})`, inline: true },
      { name: "Triggering post", value: `[${post.title.slice(0, 200)}](${postUrl})` },
    ],
    timestamp: new Date(post.created_utc * 1000).toISOString(),
  };

  const res = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `New lead to DM: u/${post.author} — ${composeDmUrl}`,
      embeds: [embed],
    }),
  });

  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}
