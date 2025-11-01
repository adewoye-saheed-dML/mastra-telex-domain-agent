// src/agents/domain-agent.ts
import { Agent } from "@mastra/core/agent";
import * as dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID ?? "";
const TELEX_WEBHOOK_URL = process.env.TELEX_WEBHOOK_URL ?? ""; // <-- set this to your send endpoint
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";

const TLD_LIST = [".dev", ".ai", ".app", ".io", ".xyz", ".tech", ".bot", ".new"];

// -------------------------------
// Create the Mastra agent
// -------------------------------
export const domainAgent = new Agent({
  id: "domain_agent",
  name: "Domain Checker",
  description: "Checks domain availability and posts a random TLD weekly.",
  instructions: "You are a concise assistant that checks domain availability and posts TLD-of-the-week.",
  model: {
    id: "google/gemini-2.5-pro", // correct model id shape
    apiKey: GEMINI_API_KEY || undefined,
  },
});

// -------------------------------
// Helper: HTTP send to your webhook (Telex or other relay)
// This removes any reliance on mastra.callAction/send APIs.
// Expected body: { channel: string, text: string } - adapt server side if needed.
// -------------------------------
async function sendToChannel(channel: string, text: string) {
  if (!TELEX_WEBHOOK_URL) {
    // Fallback: if no webhook configured, log the message
    console.log(`[sendToChannel] (no webhook) channel=${channel} text=${text}`);
    return;
  }

  try {
    const res = await fetch(TELEX_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[sendToChannel] webhook responded ${res.status} ${res.statusText} - ${body}`
      );
      throw new Error(`Webhook error: ${res.status}`);
    }
  } catch (err) {
    console.error("[sendToChannel] failed to POST to webhook:", err);
    throw err;
  }
}

// -------------------------------
// Domain availability function
// -------------------------------
async function checkDomainAvailability(domain: string): Promise<string> {
  try {
    const url = `https://api.domainsdb.info/v1/domains/search?domain=${encodeURIComponent(domain)}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`DomainsDB API error: ${response.status} ${response.statusText}`);
      return `⚠️ Could not check the domain right now (API error ${response.status}).`;
    }

    const data = (await response.json()) as { domains?: any[] };
    const isAvailable = !data.domains || data.domains.length === 0;

    return isAvailable
      ? `✅ **Status for \`${domain}\`:** AVAILABLE!`
      : `❌ **Status for \`${domain}\`:** TAKEN`;
  } catch (err) {
    console.error("Error fetching domain info:", err);
    return "⚠️ Sorry, I could not check that domain right now.";
  }
}

// -------------------------------
// Handler for incoming "/check" style messages
// Returns a string that the caller (Telex webhook, HTTP endpoint, or Mastra workflow) can send.
// -------------------------------
export async function handleDomainMessage(rawText: string): Promise<string> {
  const text = rawText?.trim() ?? "";

  if (!text.startsWith("/check ")) {
    return "❌ Invalid command. Use `/check example.com`.";
  }

  const parts = text.split(/\s+/);
  const domain = parts[1];
  if (!domain) {
    return "⚠️ Please provide a domain to check. Usage: `/check google.com`";
  }

  return await checkDomainAvailability(domain);
}

// -------------------------------
// Weekly TLD post function (proactive)
// - Generates an optional LLM-polished message via domainAgent.generate([...])
// - Sends to TELEX_WEBHOOK_URL (or logs if webhook not set)
// -------------------------------
async function postTldOfTheWeek() {
  if (!WEEKLY_CHANNEL_ID) {
    console.warn("WEEKLY_CHANNEL_ID not set. Skipping scheduled TLD post.");
    return;
  }

  const tld = TLD_LIST[Math.floor(Math.random() * TLD_LIST.length)];
  const baseMessage = `✨ TLD of the Week: ${tld}\nPerfect for your next side project!`;

  try {
    // Generate (LLM) text if you want to transform / style the message first.
    // domainAgent.generate accepts string | string[] | MessageInput etc. string[] is safe.
    const genResult = await domainAgent.generate([baseMessage]);

    // Extract text safely from genResult (best-effort; adapt if your runtime returns another shape)
    let generatedText: string;
    if (typeof genResult === "string") {
      generatedText = genResult;
    } else if ((genResult as any)?.text) {
      generatedText = (genResult as any).text;
    } else if ((genResult as any)?.output_text) {
      generatedText = (genResult as any).output_text;
    } else if (Array.isArray(genResult) && typeof genResult[0] === "string") {
      generatedText = genResult[0];
    } else {
      generatedText = baseMessage;
    }

    // Send the final text to the channel via webhook (Telex or your relay)
    await sendToChannel(WEEKLY_CHANNEL_ID, generatedText);

    console.log("✅ Successfully posted TLD of the Week.");
  } catch (error) {
    console.error("❌ Failed to post TLD of the Week:", error);
  }
}

// -------------------------------
// Local quick test when run directly
// -------------------------------
if (require.main === module) {
  (async () => {
    console.log("🚀 Running local tests for domain agent...");

    const checkResponse = await handleDomainMessage("/check openai.com");
    console.log("Check response:", checkResponse);

    // For a one-off test (don't schedule in serverless)
    await postTldOfTheWeek();
  })();
}
