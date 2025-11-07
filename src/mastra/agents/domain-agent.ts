import { Agent } from "@mastra/core/agent";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { z } from "zod";

dotenv.config({ path: "./.env" });

export const AGENT_ID = "domain-checker-agent";

const WHOISFREAKS_API_KEY: string = process.env.WHOISFREAKS_API_KEY ?? "";
const WHOIS_API_KEY: string = WHOISFREAKS_API_KEY;
const WHOISFREAKS_API_BASE: string = (process.env.WHOISFREAKS_API_BASE ?? "https://api.whoisfreaks.com/v1.0").replace(/\/$/, "");

if (!WHOISFREAKS_API_KEY) console.warn("WHOISFREAKS_API_KEY not set. Add it to .env");

const DomainSchema = z.object({
  domain: z.string().min(3, "Please provide a valid domain name."),
});

interface WhoisStructured {
  status: string;
  domain: string;
  registered: boolean;
  expires?: string | null;
  registrar?: string | null;
  raw?: any;
}

interface ToolOutput {
  text: string;
  artifacts: Array<{ type: string; parts: any[] }>;
  metadata?: Record<string, any>;
}

// whois tool
const whoisTool = {
  name: "check_domain_status",
  description: "Checks if a domain is registered using the WhoisFreaks API.",
  inputSchema: DomainSchema,
  async execute(...args: unknown[]): Promise<any> {
    let domainArg: string | undefined;
    if (args.length === 1 && typeof args[0] === "string") domainArg = args[0];
    if (args.length === 1 && typeof args[0] === "object" && (args[0] as any)?.domain)
      domainArg = String((args[0] as any).domain);

    if (!domainArg) throw new Error("whoisTool: missing domain argument");

    const domain = domainArg.trim().toLowerCase();
    const url = `${WHOISFREAKS_API_BASE}/whois?apikey=${encodeURIComponent(WHOIS_API_KEY)}&domain=${encodeURIComponent(domain)}`;

    try {
      const resp = await fetch(url, { method: "GET" });
      const rawText = await resp.text().catch(() => "");
      let json: any = null;
      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        /* ignore */
      }

      const registered =
        (json && (json.registered === true || json.is_registered === true || json.domainStatus === "registered")) ||
        (typeof rawText === "string" && /registered/i.test(rawText));

      const expires = json?.expires || json?.expiryDate || json?.expiration_date || null;
      const registrar = json?.registrar || null;

      const structured: WhoisStructured = {
        status: resp.ok ? "ok" : "error",
        domain,
        registered: Boolean(registered),
        expires,
        registrar,
        raw: json ?? rawText,
      };

      const humanText = structured.registered
        ? `Domain ${domain} appears to be registered.${expires ? ` Expires: ${expires}.` : ""}${
            registrar ? ` Registrar: ${registrar}.` : ""
          }`
        : `Domain ${domain} does not appear to be registered.`;

      const output: ToolOutput = {
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
    "You are a domain name checking assistant. When asked to check a domain you MUST use the 'check_domain_status' tool and return the tool output verbatim inside the agent output.",
  model: { id: "google/gemini-2.5-pro" },
  tools: { [whoisTool.name]: whoisTool },
});

// helpers
function stripHtml(txt: string): string {
  if (!txt || typeof txt !== "string") return txt ?? "";
  return txt.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractDomainFromText(text: string): string | null {
  if (!text || typeof text !== "string") return null;
  const clean = stripHtml(text).replace(/https?:\/\//gi, "").replace(/www\./gi, "");
  const match = clean.match(/\b([a-z0-9-]{1,63}\.)+[a-z]{2,63}\b/i);
  return match ? match[0].toLowerCase() : null;
}

export async function checkDomainStatus(domain: string): Promise<any> {
  return await whoisTool.execute(domain);
}

export async function handleDomainMessage(message: any): Promise<any> {
  try {
    if (!message || !message.parts || !Array.isArray(message.parts)) {
      throw new Error("Invalid message object (missing parts)");
    }

    let userText = "";
    for (const part of message.parts as any[]) {
      if ((part.kind === "text" || part.type === "text") && typeof part.text === "string" && part.text.trim()) {
        userText = part.text.trim();
        break;
      }
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
      const text = "No domain found in the message. Please provide a domain like 'example.com'.";
      return { result: { ok: true, output: { text, artifacts: [{ type: "text/plain", parts: [{ text }] }] } } };
    }

    const domain = extractDomainFromText(userText);
    if (!domain) {
      const text = "No valid domain detected. Provide a domain like 'example.com'.";
      return { result: { ok: true, output: { text, artifacts: [{ type: "text/plain", parts: [{ text }] }] } } };
    }

    const toolResult = await checkDomainStatus(domain);

    if (toolResult?.output) {
      return { result: { ok: true, output: toolResult.output } };
    }

    if (toolResult?.data) {
      const text = JSON.stringify(toolResult.data, null, 2);
      return {
        result: { ok: true, output: { text, artifacts: [{ type: "application/json", parts: [{ json: toolResult.data }] }] } },
      };
    }

    return {
      result: {
        ok: true,
        output: {
          text: JSON.stringify(toolResult, null, 2),
          artifacts: [{ type: "application/json", parts: [{ json: toolResult }] }],
        },
      },
    };
  } catch (err: any) {
    console.error("❌ 'handleDomainMessage' failed:", err);
    return {
      error: { code: -32000, message: String(err?.message ?? err), data: { where: "handleDomainMessage" } },
    };
  }
}

console.log("domainAgent tools:", (domainAgent as any).tools);
