import { config } from "./config";

export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  author: string;
  url: string;
  permalink: string;
  created_utc: number;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const basicAuth = Buffer.from(
    `${config.reddit.clientId}:${config.reddit.clientSecret}`
  ).toString("base64");

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.reddit.userAgent,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Reddit auth failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.token;
}

export async function fetchNewPosts(subreddit: string, limit: number): Promise<RedditPost[]> {
  const token = await getAccessToken();

  const res = await fetch(
    `https://oauth.reddit.com/r/${subreddit}/new?limit=${limit}&raw_json=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": config.reddit.userAgent,
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch r/${subreddit}: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    data: { children: Array<{ data: RedditPost }> };
  };

  return data.data.children
    .map((child) => child.data)
    .sort((a, b) => a.created_utc - b.created_utc);
}
