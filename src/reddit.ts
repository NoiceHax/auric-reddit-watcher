import { chromium, type BrowserContext, type Page } from "playwright";
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

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Query string for the configured listing ("new", "hot", or "top?t=day").
function listingQuery(limit: number): string {
  const params = `limit=${limit}&raw_json=1`;
  return config.redditListing === "top" ? `${params}&t=${config.redditTopTime}` : params;
}

let context: BrowserContext | null = null;
let page: Page | null = null;
// Dedicated tab for session probes, kept off the page a human may be typing on.
let probePage: Page | null = null;

// A persistent, headful Chrome. Reddit serves logged-out JSON requests a 302 to
// /login regardless of User-Agent, and flags headless Chrome outright, so the
// only durable way in is a real browser carrying a real logged-in session.
async function ensureBrowser(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  context = await chromium.launchPersistentContext(config.browser.profileDir, {
    headless: config.browser.headless,
    viewport: { width: 1280, height: 900 },
    // Only override the UA if explicitly configured; otherwise Chrome's own
    // (genuine, self-consistent) User-Agent is used.
    ...(config.reddit.userAgent ? { userAgent: config.reddit.userAgent } : {}),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
  return page;
}

// Ground-truth login check. Probing the API beats looking for a named session
// cookie: Reddit has renamed those before, and a stale name would report
// "logged in" right up until every listing came back as a login page.
//
// Runs in its own tab, not the visible one: this is polled while a human is
// typing into the login form, and navigating that page out from under them
// every few seconds would wipe what they had entered.
async function hasSession(): Promise<boolean> {
  if (!context) return false;
  try {
    probePage = probePage && !probePage.isClosed() ? probePage : await context.newPage();
    const res = await probePage.goto("https://old.reddit.com/api/me.json", {
      waitUntil: "domcontentloaded",
      // Bounded so a slow or hung probe cannot stall startup or the wait loop.
      timeout: 15000,
    });
    if (!res || !res.ok()) return false;
    if (probePage.url().includes("/login")) return false;
    const body = JSON.parse(await res.text()) as { data?: { name?: string } };
    return !!body?.data?.name;
  } catch {
    return false;
  }
}

// Block startup until a human has logged in through the VNC session. Polling
// beats failing fast here: the container is expected to come up before anyone
// is around to log in, and the profile makes this a once-per-deployment step.
export async function ensureLoggedIn(): Promise<void> {
  const p = await ensureBrowser();

  if (await hasSession()) {
    log("Reddit session found in browser profile.");
    return;
  }

  await p.goto("https://old.reddit.com/login/", { waitUntil: "domcontentloaded" }).catch(() => {});
  log("=".repeat(72));
  log("NOT LOGGED IN TO REDDIT. The browser is waiting on the virtual display.");
  log("From your machine:  ssh -L 5900:127.0.0.1:5900 minty@<homelab>");
  log("Then point a VNC client at 127.0.0.1:5900 and log in to Reddit.");
  log(`Waiting up to ${config.browser.loginWaitSeconds}s for the login to complete...`);
  log("=".repeat(72));

  const deadline = Date.now() + config.browser.loginWaitSeconds * 1000;
  while (Date.now() < deadline) {
    await sleep(5000);
    if (await hasSession()) {
      log("Reddit login detected. Continuing.");
      return;
    }
  }
  throw new Error(
    `No Reddit session after ${config.browser.loginWaitSeconds}s. Log in over VNC and restart.`
  );
}

export async function closeBrowser(): Promise<void> {
  await context?.close().catch(() => {});
  context = null;
  page = null;
  probePage = null;
}

export async function fetchNewPosts(subreddit: string, limit: number): Promise<RedditPost[]> {
  const p = await ensureBrowser();
  const url = `https://old.reddit.com/r/${subreddit}/${config.redditListing}.json?${listingQuery(limit)}`;

  const res = await p.goto(url, { waitUntil: "domcontentloaded" });
  if (!res) throw new Error(`No response for r/${subreddit}`);

  // The failure that hid the original outage: Reddit answers a logged-out
  // request with a 302 to /login, which lands on a 200 HTML page. Checking the
  // status alone says "ok" and the HTML only fails later, at JSON.parse.
  const finalUrl = p.url();
  if (finalUrl.includes("/login")) {
    throw new Error(`Reddit redirected r/${subreddit} to login — session expired; log in over VNC.`);
  }

  const contentType = (res.headers()["content-type"] ?? "").toLowerCase();
  if (!res.ok() || !contentType.includes("json")) {
    throw new Error(
      `Failed to fetch r/${subreddit}: ${res.status()} content-type=${contentType || "none"} url=${finalUrl}`
    );
  }

  const data = JSON.parse(await res.text()) as {
    data: { children: Array<{ data: RedditPost }> };
  };

  return data.data.children
    .map((child) => child.data)
    .filter((post) => !post.stickied) // hot/top listings include pinned mod posts
    .sort((a, b) => a.created_utc - b.created_utc);
}
