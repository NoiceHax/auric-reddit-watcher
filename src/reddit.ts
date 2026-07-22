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
  stickied?: boolean;
}

// Query string for the configured listing ("new", "hot", or "top?t=day").
function listingQuery(limit: number): string {
  const params = `limit=${limit}&raw_json=1`;
  return config.redditListing === "top"
    ? `${params}&t=${config.redditTopTime}`
    : params;
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

// Headers that mimic a normal browser request, so this traffic blends in with a
// person browsing/commenting Reddit at the same time.
function browserHeaders(): Record<string, string> {
  return {
    "User-Agent": config.reddit.userAgent,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

// Node's fetch has no cookie jar. Reddit blocks unauthenticated JSON requests
// that arrive with no cookies, so we prime a session against old.reddit.com to
// pick up its Set-Cookie values, then replay them (plus a browser UA) on each
// JSON request — the same trick as a requests.Session with a warm-up GET.
let sessionCookie = "";

async function primeSession(): Promise<void> {
  try {
    const res = await fetch("https://old.reddit.com/", {
      headers: browserHeaders(),
    });
    const cookies = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]) // keep only name=value, drop attributes
      .filter(Boolean);
    if (cookies.length) {
      sessionCookie = cookies.join("; ");
    }
    // Drain the body so the connection is released.
    await res.text();
  } catch {
    // Best-effort — if priming fails we still try the request; it may re-prime.
  }
}

async function fetchPublicOnce(subreddit: string, limit: number): Promise<Response> {
  const headers = browserHeaders();
  if (sessionCookie) headers.Cookie = sessionCookie;
  // old.reddit.com is far less aggressive about blocking than www.
  return fetch(
    `https://old.reddit.com/r/${subreddit}/${config.redditListing}.json?${listingQuery(limit)}`,
    { headers }
  );
}

async function fetchPublic(subreddit: string, limit: number): Promise<Response> {
  if (!sessionCookie) await primeSession();

  let res = await fetchPublicOnce(subreddit, limit);
  // If we get blocked, the cookie is likely stale/missing — re-prime once and retry.
  if (res.status === 403 || res.status === 429) {
    await primeSession();
    res = await fetchPublicOnce(subreddit, limit);
  }
  return res;
}

async function fetchOAuth(subreddit: string, limit: number): Promise<Response> {
  const token = await getAccessToken();
  return fetch(
    `https://oauth.reddit.com/r/${subreddit}/${config.redditListing}?${listingQuery(limit)}`,
    {
      headers: {
        ...browserHeaders(),
        Authorization: `Bearer ${token}`,
      },
    }
  );
}

export async function fetchNewPosts(subreddit: string, limit: number): Promise<RedditPost[]> {
  const res = config.reddit.usePublicApi
    ? await fetchPublic(subreddit, limit)
    : await fetchOAuth(subreddit, limit);

  if (!res.ok) {
    throw new Error(`Failed to fetch r/${subreddit}: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    data: { children: Array<{ data: RedditPost }> };
  };

  return data.data.children
    .map((child) => child.data)
    .filter((post) => !post.stickied) // hot/top listings include pinned mod posts
    .sort((a, b) => a.created_utc - b.created_utc);
}
