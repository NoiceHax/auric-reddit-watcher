import { config } from "./config";
import type { RedditPost } from "./reddit";

export interface ClassificationResult {
  worthy: boolean;
  reason: string;
}

const AURIC_BLURB = `
Auric is an offline MCP server that sits inside a developer's IDE and automatically syncs
project context across Claude, Gemini, and other AI models/chats. Value props:
- Zero re-explaining project context when starting a new AI chat or switching IDEs/models
- Better, more grounded AI responses because the model has real codebase context
- ~45% token reduction in initial simulations
- Closed beta launching soon, waitlist at auric.cx
`.trim();

const SYSTEM_PROMPT = `
You are screening new Reddit posts for a small team building "Auric" to decide whether a post
is a good, genuine opportunity for a real person to reply with a helpful comment that naturally
mentions Auric.

${AURIC_BLURB}

A post is WORTHY only if a thoughtful, non-spammy human comment mentioning Auric would add real
value there. Good signals:
- OP is frustrated with re-explaining project/codebase context to AI tools repeatedly
- OP is asking about switching between AI coding tools/IDEs (Claude Code, Cursor, Windsurf, etc.)
  and losing context/history
- OP is discussing MCP servers, context management, or token costs from repeated context-setting
- OP is asking for tool recommendations for AI-assisted development workflows

A post is NOT worthy if:
- It's unrelated to AI coding tools, context management, or dev workflows
- It's a post where product mentions would clearly be unwelcome (e.g. venting with no ask,
  strict rules against self-promotion, a completed/closed discussion)
- It's low-effort, a meme, or a duplicate/very generic post
- Mentioning Auric would feel like an obvious non-sequitur or spam

Respond by calling the classify_post tool exactly once. If for any reason you cannot call the
tool, respond with only a JSON object of the form {"worthy": boolean, "reason": string} and
nothing else.
`.trim();

const TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "classify_post",
    description: "Classify whether this Reddit post is worth a genuine Auric-related comment.",
    parameters: {
      type: "object" as const,
      properties: {
        worthy: {
          type: "boolean",
          description: "True if a genuine comment mentioning Auric would add real value here.",
        },
        reason: {
          type: "string",
          description: "One or two sentences explaining the verdict, referencing the post content.",
        },
      },
      required: ["worthy", "reason"],
    },
  },
};

function extractJsonObject(text: string): ClassificationResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Classifier response contained no JSON object: ${text}`);
  }
  return JSON.parse(match[0]);
}

export async function classifyPost(post: RedditPost): Promise<ClassificationResult> {
  const userContent = `Subreddit: r/${post.subreddit}
Title: ${post.title}
Body: ${post.selftext?.slice(0, 2000) || "(no body / link post)"}`;

  // Bound the request so a stalled/unavailable model errors (and gets caught and
  // logged per-post) instead of hanging the whole poll loop indefinitely.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.classifyTimeoutMs);

  let res: Response;
  try {
    res = await fetch(`${config.nvidia.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.nvidia.apiKey}`,
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.classifierModel,
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "function", function: { name: "classify_post" } },
      }),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(
        `Classification timed out after ${config.classifyTimeoutMs}ms (model: ${config.classifierModel})`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Classification request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: Array<{ function: { name: string; arguments: string } }>;
      };
    }>;
  };

  const message = data.choices[0]?.message;
  const toolCall = message?.tool_calls?.find((call) => call.function.name === "classify_post");

  if (toolCall) {
    return JSON.parse(toolCall.function.arguments);
  }

  // Some NIM models ignore tool_choice under load; fall back to parsing JSON from content.
  if (message?.content) {
    return extractJsonObject(message.content);
  }

  throw new Error("Classifier returned neither a tool call nor content");
}
