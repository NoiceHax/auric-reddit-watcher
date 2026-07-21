import { config } from "./config";
import type { RedditPost } from "./reddit";
import type { ClassificationResult } from "./classify";

export async function notifyDiscord(
  post: RedditPost,
  classification: ClassificationResult
): Promise<void> {
  const postUrl = `https://www.reddit.com${post.permalink}`;

  const embed = {
    title: post.title.slice(0, 256),
    url: postUrl,
    description: classification.reason.slice(0, 1000),
    color: 0xd4af37,
    fields: [
      { name: "Subreddit", value: `r/${post.subreddit}`, inline: true },
      { name: "Author", value: `u/${post.author}`, inline: true },
    ],
    timestamp: new Date(post.created_utc * 1000).toISOString(),
  };

  const res = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `New post worth an Auric comment: ${postUrl}`,
      embeds: [embed],
    }),
  });

  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}
