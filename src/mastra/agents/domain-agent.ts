// agents/domain-agent.js
import { Agent } from "@mastra/core/agent";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { z } from "zod";

dotenv.config({ path: "./.env" });

export const AGENT_ID = "domain-checker-agent";

const WHOISFREAKS_API_KEY = process.env.WHOISFREAKS_API_KEY ?? "";
const WHOIS_API_KEY = WHOISFREAKS_API_KEY;
const WHOISFREAKS_API_BASE = (process.env.WHOISFREAKS_API_BASE ?? "https://api.whoisfreaks.com/v1.0").replace(/\/$/, "");

if (!WHOISFREAKS_API_KEY) console.warn("WHOISFREAKS_API_KEY not set. Add it to .env");

const DomainSchema = z.object({
  domain: z.string().min(3, "Please provide a valid domain name."),
});

// whois tool (kept logic, returned structured output)
const whoisTool = {
  name: "check_domain_status",
  description: "Checks if a domain is registered using the WhoisFreaks API.",
  inputSchema: DomainSchema,
  async execute(...args) {
    let domainArg;
    if (args.length === 1 && typeof args[0] === "string") domainArg = args[0];
    if (args.length === 1 && typeof args[0] === "object" && args[0]?.domain) domainArg = String(args[0].domain);

    if (!domainArg) throw new Error("whoisTool: missing domain argument");

    const domain = domainArg.trim().toLowerCase();
    const url = `${WHOISFREAKS_API_BASE}/whois?apikey=${encodeURIComponent(WHOIS_API_KEY)}&domain=${encodeURIComponent(domain)}`;

    try {
      const resp = await fetch(url, { method: "GET" });
      const rawText = await resp.text().catch(() => "");
      let json = null;
      try { json = rawText ? JSON.parse(rawText) : null; } catch {}

      const registered =
        (json && (json.registered === true || json.is_registered === true || json.domainStatus === "registered")) ||
        (typeof rawText === "string" && /registered/i.test(rawText));

      const expires = json?.expires || json?.expiryDate || json?.expiration_date || null;
      const registrar = json?.registrar || null;

      const structured = {
        status: resp.ok ? "ok" : "error",
        domain,
        registered: Boolean(registered),
        expires,
        registrar,
        raw: json ?? rawText,
      };

      const humanText = structured.registered
        ? `Domain ${domain} appears to be registered.${expires ? ` Expires: ${expires}.` : ""}${registrar ? ` Registrar: ${registrar}.` : ""}`
        : `Domain ${domain} does not appear to be registered.`;

      const output = {
        text: humanText,
        artifacts: [
          { type: "application/json", parts: [{ json: structured }] },
          { type: "text/plain", parts: [{ text: humanText }] },
        ],
        metadata: { tool: whoisTool.name },
      };

      return { status: "ok", data: structured, output };
    } catch (err) {
      return {
        status: "error",
        error: { message: String(err?.message ?? err), code: -32001 },
        output: { text: `Error checking domain ${domain}: ${String(err?.message ?? err)}` },
      };
    }
  },
};

// Create domainAgent (kept as-is for discovery, but we won't rely on streaming generate)
export const domainAgent = new Agent({
  id: AGENT_ID,
  name: "Domain Checker",
  instructions:
    "You are a domain name checking assistant. When asked to check a domain you MUST use the 'check_domain_status' tool and return the tool output verbatim inside the agent output (do not invent additional facts).",
  model: { id: "google/gemini-2.5-pro" },
  tools: { [whoisTool.name]: whoisTool },
});

// helper: remove HTML and extract first domain-like token
function stripHtml(txt) {
  if (!txt || typeof txt !== "string") return txt ?? "";
  return txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractDomainFromText(text) {
  if (!text || typeof text !== "string") return null;
  // strip common url prefixes
  const clean = stripHtml(text).replace(/https?:\/\//gi, "").replace(/www\./gi, "");
  // simple domain regex: handles foo.com, sub.foo.co.uk etc
  const match = clean.match(/\b([a-z0-9-]{1,63}\.)+[a-z]{2,63}\b/i);
  if (!match) return null;
  return match[0].toLowerCase();
}

// expose the whois check function for direct calls
export async function checkDomainStatus(domain) {
  return await whoisTool.execute(domain);
}

/**
 * handleDomainMessage:
 *  - Accepts the Telex message object (the full message with parts).
 *  - Extracts the user's text, finds a domain, calls whoisTool, and returns a JSON-RPC envelope.
 */
export async function handleDomainMessage(message) {
  try {
    if (!message || !message.parts || !Array.isArray(message.parts)) {
      throw new Error("Invalid message object (missing parts)");
    }

    // Find the first text part in message.parts (fallback to first string)
    let userText = "";
    for (const part of message.parts) {
      if ((part.kind === "text" || part.type === "text") && typeof part.text === "string" && part.text.trim()) {
        userText = part.text.trim();
        break;
      }
      // also support nested 'data' arrays in rare cases
      if (part.kind === "data" && Array.isArray(part.data)) {
        for (const nested of part.data) {
          if ((nested.kind === "text" || nested.type === "text") && typeof nested.text === "string" && nested.text.trim()) {
            userText = nested.text.trim();
            break;
          }
        }
        if (userText) break;
      }
    }

    if (!userText) {
      return {
        error: {
          code: -32000,
          message: "Could not extract user text from message parts",
          data: { where: "handleDomainMessage" },
        },
      };
    }

    // Extract domain from the extracted text
    const domain = extractDomainFromText(userText);
    if (!domain) {
      // no domain found — return helpful text (not asking for clarification in code)
      const text = "No domain found in the message. Please provide a domain like 'example.com'.";
      return { result: { ok: true, output: { text, artifacts: [{ type: "text/plain", parts: [{ text }] }] } } };
    }

    // Call the whois tool directly (no model streaming)
    const toolResult = await checkDomainStatus(domain);

    // If whois tool returned structured output & output field, return as expected envelope
    if (toolResult && toolResult.output) {
      return { result: { ok: true, output: toolResult.output } };
    }

    // If tool returned data, format it
    if (toolResult && toolResult.data) {
      const text = JSON.stringify(toolResult.data, null, 2);
      return { result: { ok: true, output: { text, artifacts: [{ type: "application/json", parts: [{ json: toolResult.data }] }] } } };
    }

    // fallback — stringify everything
    return { result: { ok: true, output: { text: JSON.stringify(toolResult, null, 2), artifacts: [{ type: "application/json", parts: [{ json: toolResult }] }] } } };
  } catch (err) {
    console.error("❌ 'handleDomainMessage' failed:", err);
    return {
      error: {
        code: -32000,
        message: String(err?.message ?? err),
        data: { where: "handleDomainMessage" },
      },
    };
  }
}

console.log("domainAgent tools:", (domainAgent as any).tools);
