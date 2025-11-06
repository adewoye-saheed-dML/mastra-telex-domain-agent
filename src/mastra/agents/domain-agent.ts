// src/mastra/agents/domain-agent.ts
import { Agent } from "@mastra/core/agent";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { z } from "zod";

dotenv.config({ path: "./.env" });

// Exported agent id used by server/discovery
export const AGENT_ID = "domain-checker-agent";

// WhoisFreaks config (env)
const WHOISFREAKS_API_KEY = process.env.WHOISFREAKS_API_KEY ?? "";
const WHOIS_API_KEY = WHOISFREAKS_API_KEY;
const WHOISFREAKS_API_BASE = (process.env.WHOISFREAKS_API_BASE ?? "https://api.whoisfreaks.com/v1.0").replace(/\/$/, "");

if (!WHOISFREAKS_API_KEY) {
  console.warn("WHOISFREAKS_API_KEY not set. Add it to .env (WHOISFREAKS_API_KEY=...)");
}

// Zod schema for the tool input
const DomainSchema = z.object({
  domain: z.string().min(3, "Please provide a valid domain name."),
});

// Whois tool: returns structured data and a text representation
const whoisTool = {
  name: "check_domain_status",
  description: "Checks if a given domain is registered using the WhoisFreaks API.",
  inputSchema: DomainSchema,
  async execute(...args: any[]) {
    // Accept either: plain string domain OR object { domain: "..." }
    let domainArg: string | undefined;
    if (args.length === 1 && typeof args[0] === "string") domainArg = args[0];
    if (args.length === 1 && typeof args[0] === "object" && args[0]?.domain) domainArg = String(args[0].domain);
    if (args.length > 1 && typeof args[0] === "object" && args[0].domain) domainArg = String(args[0].domain);

    if (!domainArg || typeof domainArg !== "string") {
      throw new Error("whoisTool: missing domain argument");
    }

    const domain = domainArg.trim();

    // Compose API URL (adjust to your whois provider if needed)
    const url = `${WHOISFREAKS_API_BASE}/whois?apikey=${encodeURIComponent(WHOIS_API_KEY)}&domain=${encodeURIComponent(domain)}`;

    try {
      const resp = await fetch(url, { method: "GET" });
      const rawText = await resp.text().catch(() => "");
      let json: any = null;
      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        json = null;
      }

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

// Create the Mastra Agent
export const domainAgent = new Agent({
  id: AGENT_ID,
  name: "Domain Checker",
  instructions:
    "You are a domain name checking assistant. When asked to check a domain you MUST use the 'check_domain_status' tool and return the tool output verbatim inside the agent output (do not invent additional facts). The tool returns both structured artifacts and a human text summary; ensure your final output includes the tool's text and artifacts.",
  model: { id: "google/gemini-2.5-pro" },
  tools: { [whoisTool.name]: whoisTool },
});

/**
 * Minimal check for "already a JSON-RPC-like result"
 */
function looksLikeResultEnvelope(obj: any) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.jsonrpc === "2.0" && ("result" in obj || "error" in obj)) return true;
  if (obj.result && typeof obj.result === "object" && (obj.result.output || obj.result.ok !== undefined)) return true;
  if (obj.output && (obj.output.text || obj.output.artifacts)) return true;
  return false;
}

/**
 * handleDomainMessage - Option A
 * Input: a plain string (user's text)
 * Behavior:
 *  - construct a single clean Mastra message: { role: "user", content: "<text>" }
 *  - call agent.generate({ message: { role, content } })
 *  - prefer agent-native envelope if present; otherwise wrap into { result: { ok: true, output: { ... } } }
 */
export async function handleDomainMessage(userText: string): Promise<any> {
  try {
    const message = { role: "user", content: String(userText ?? "").trim() };

    // Pass the *single* normalized message to the agent
    const agentResult = await (domainAgent as any).generate({ message });

    // If agent already returned a JSON-RPC-like envelope, pass through
    if (looksLikeResultEnvelope(agentResult)) return agentResult;

    // If agent returned an object with output, honor it
    if (agentResult && typeof agentResult === "object") {
      if (agentResult.output) {
        return { result: { ok: true, output: agentResult.output } };
      }
      if (agentResult.output_text || agentResult.text) {
        const text = agentResult.output_text ?? agentResult.text;
        return { result: { ok: true, output: { text, artifacts: [{ type: "text/plain", parts: [{ text }] }] } } };
      }
      if (agentResult.data) {
        return { result: { ok: true, output: { text: JSON.stringify(agentResult.data, null, 2), artifacts: [{ type: "application/json", parts: [{ json: agentResult.data }] }] } } };
      }
    }

    if (typeof agentResult === "string") {
      const text = agentResult;
      return { result: { ok: true, output: { text, artifacts: [{ type: "text/plain", parts: [{ text }] }] } } };
    }

    return { result: { ok: true, output: { text: JSON.stringify(agentResult, null, 2), artifacts: [{ type: "application/json", parts: [{ json: agentResult }] }] } } };
  } catch (err: any) {
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
