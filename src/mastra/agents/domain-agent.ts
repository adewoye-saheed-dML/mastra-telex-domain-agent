// agents/domain-agent.ts
import { Agent } from "@mastra/core/agent";
import * as dotenv from "dotenv";

dotenv.config({ path: "./.env" });

// exported ID to be reused in server/workflow/config
export const AGENT_ID = "domainAgent";

const WEEKLY_CHANNEL_ID = process.env.WEEKLY_CHANNEL_ID ?? "";
const TELEX_WEBHOOK_URL = process.env.TELEX_WEBHOOK_URL ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const DOMAINSDB_API_KEY = process.env.DOMAINSDB_API_KEY ?? "";

const TLD_LIST = [".dev", ".ai", ".app", ".io", ".xyz", ".tech", ".bot", ".new"];

// Create the Mastra agent
export const domainAgent = new Agent({
  id: AGENT_ID,
  name: "Domain Checker",
  description: "Checks domain availability and posts a random TLD weekly.",
  instructions: "You are a concise assistant that checks domain availability and posts TLD-of-the-week.",
  model: {
    id: "google/gemini-2.5-pro",
    apiKey: GEMINI_API_KEY || undefined,
  },
});

async function sendToChannel(channel: string, text: string) {
  if (!TELEX_WEBHOOK_URL) {
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
      console.error(`[sendToChannel] webhook responded ${res.status} ${res.statusText} - ${body}`);
      throw new Error(`Webhook error: ${res.status}`);
    }
  } catch (err) {
    console.error("[sendToChannel] failed to POST to webhook:", err);
    throw err;
  }
}

// ✅ Updated domain availability function
export async function checkDomainAvailability(domain: string): Promise<string> {
  try {
    // Use Google DNS resolver to check if domain exists
    const dnsRes = await fetch(`https://dns.google/resolve?name=${domain}`);
    const dnsData = await dnsRes.json();
    const hasRecords = dnsData.Answer && dnsData.Answer.length > 0;

    if (hasRecords) {
      return `**Status for \`${domain}\`:** TAKEN`;
    } else {
      return `**Status for \`${domain}\`:** AVAILABLE!`;
    }
  } catch (err) {
    console.error("Error checking domain:", err);
    return "Sorry, I couldn’t check that domain right now.";
  }
}

// Handler for incoming "/check" style messages
export async function handleDomainMessage(rawText: string): Promise<string> {
  const text = rawText?.trim() ?? "";

  if (!text.startsWith("/check ")) {
    return "Invalid command. Use `/check example.com`.";
  }

  const parts = text.split(/\s+/);
  const domain = parts[1];
  if (!domain) {
    return "Please provide a domain to check. Usage: `/check google.com`";
  }

  return await checkDomainAvailability(domain);
}

// Weekly TLD post function (proactive)
export async function postTldOfTheWeek() {
  if (!WEEKLY_CHANNEL_ID) {
    console.warn("WEEKLY_CHANNEL_ID not set. Skipping scheduled TLD post.");
    return;
  }

  const tld = TLD_LIST[Math.floor(Math.random() * TLD_LIST.length)];
  const baseMessage = `TLD of the Week: ${tld}\nPerfect for your next side project!`;

  try {
    const genResult = await domainAgent.generate([baseMessage]);

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

    await sendToChannel(WEEKLY_CHANNEL_ID, generatedText);

    console.log("Successfully posted TLD of the Week.");
  } catch (error) {
    console.error("Failed to post TLD of the Week:", error);
  }
}
