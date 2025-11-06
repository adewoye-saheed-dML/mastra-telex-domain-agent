import { Agent } from "@mastra/core/agent";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { z } from "zod";

dotenv.config({ path: "./.env" });

export const AGENT_ID = "domain-checker-agent";

// --- API and Tool configuration (Unchanged) ---
const WHOISFREAKS_API_KEY = process.env.WHOISFREAKS_API_KEY ?? "";
const WHOIS_API_KEY = WHOISFREAKS_API_KEY;
const WHOISFREAKS_API_BASE = (process.env.WHOISFREAKS_API_BASE ?? "https://api.whoisfreaks.com/v1.0").replace(/\/$/, "");

if (!WHOISFREAKS_API_KEY) console.warn("WHOISFREAKS_API_KEY not set. Add it to .env");

const DomainSchema = z.object({
  domain: z.string().min(3, "Please provide a valid domain name."),
});

const whoisTool = {
  name: "check_domain_status",
  description: "Checks if a domain is registered using the WhoisFreaks API.",
  inputSchema: DomainSchema,
  async execute(...args: any[]) {
    let domainArg: string | undefined;
    if (args.length === 1 && typeof args[0] === "string") domainArg = args[0];
    if (args.length === 1 && typeof args[0] === "object" && args[0]?.domain) domainArg = String(args[0].domain);

    if (!domainArg) throw new Error("whoisTool: missing domain argument");

    const domain = domainArg.trim();
    const url = `${WHOISFREAKS_API_BASE}/whois?apikey=${encodeURIComponent(WHOIS_API_KEY)}&domain=${encodeURIComponent(domain)}`;

    try {
      const resp = await fetch(url, { method: "GET" });
      const rawText = await resp.text().catch(() => "");
      let json: any = null;
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
    } catch (err: any) {
      return {
        status: "error",
        error: { message: String(err?.message ?? err), code: -32001 },
        output: { text: `Error checking domain ${domain}: ${String(err?.message ?? err)}` },
      };
    }
  },
};

export const domainAgent = new Agent({
  id: AGENT_ID,
  name: "Domain Checker",
  instructions:
    "You are a domain name checking assistant. When asked to check a domain you MUST use the 'check_domain_status' tool and return the tool output verbatim inside the agent output (do not invent additional facts).",
  model: { id: "google/gemini-2.5-pro" },
  tools: { [whoisTool.name]: whoisTool },
});

function looksLikeResultEnvelope(obj: any) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.jsonrpc === "2.0" && ("result" in obj || "error" in obj)) return true;
  if (obj.result && typeof obj.result === "object" && (obj.result.output || obj.result.ok !== undefined)) return true;
  if (obj.output && (obj.output.text || obj.output.artifacts)) return true;
  return false;
}

// --- End of Unchanged Code ---

/**
 * ✅ NEW: Helper function to extract the *actual* query text
 * from the complex message object seen in the logs.
 */
function extractTextFromMessage(message: any): string {
  if (!message || !message.parts || !Array.isArray(message.parts)) {
    return "";
  }
  // Find the first 'text' part and return its content.
  // This ignores the confusing 'data' part.
  for (const part of message.parts) {
    if ((part.kind === 'text' || part.type === 'text') && typeof part.text === 'string') {
      return part.text.trim();
    }
  }
  return ""; // No text part found
}

/**
 * handleDomainMessage (Corrected)
 * - Accepts the full, complex message object from server.ts
 * - Uses `extractTextFromMessage` to find the *real* user query
 * - Builds a *new, clean* message list for the agent
 * - Calls the agent with the clean message
 */
export async function handleDomainMessage(message: any): Promise<any> {
  try {
    // ✅ FIX: Extract the actual user text from the complex message object
    const userText = extractTextFromMessage(message);

    if (!userText) {
      throw new Error("Could not extract user text from the message parts.");
    }

    // ✅ FIX: Build a *clean* message list for the agent,
    // just like we did in the original version.
    const messages = [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ];

    // Call the agent with the CLEAN message list
    const agentResult = await (domainAgent as any).generate(messages);

    // If the agent already returned a proper envelope, pass through
    if (looksLikeResultEnvelope(agentResult)) return agentResult;

    // If the agent/tool returned 'output' (our whoisTool returns output), wrap as expected
    if (agentResult && typeof agentResult === "object") {
      if (agentResult.output) return { result: { ok: true, output: agentResult.output } };
      if (agentResult.output_text || agentResult.text) {
        const text = agentResult.output_text ?? agentResult.text;
        return { result: { ok: true, output: { text, artifacts: [{ type: "text/plain", parts: [{ text }] }] } } };
      }
      if (agentResult.data) {
        return { result: { ok: true, output: { text: JSON.stringify(agentResult.data, null, 2), artifacts: [{ type: "application/json", parts: [{ json: agentResult.data }] }] } } };
      }
    }

    // string fallback
    if (typeof agentResult === "string") {
      const text = agentResult;
      return { result: { ok: true, output: { text, artifacts: [{ type: "text/plain", parts: [{ text }] }] } } };
    }

    // last resort
    return { result: { ok: true, output: { text: JSON.stringify(agentResult, null, 2), artifacts: [{ type: "application/json", parts: [{ json: agentResult }] }] } } };
  } catch (err: any) {
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