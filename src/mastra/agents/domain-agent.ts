// src/mastra/agents/domain-agent.ts
import { Agent } from "@mastra/core/agent";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { z } from "zod";

dotenv.config({ path: "./.env" });

export const AGENT_ID = "domain-checker-agent";

const WHOISFREAKS_API_KEY = process.env.WHOISFREAKS_API_KEY ?? "";
const WHOIS_API_KEY = WHOISFREAKS_API_KEY;
const WHOISFREAKS_API_BASE = (process.env.WHOISFREAKS_API_BASE ?? "https://api.whoisfreaks.com/v1.0").replace(/\/$/, "");

if (!WHOISFREAKS_API_KEY) console.warn("WHOISFREAKS_API_KEY missing");

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
    if (args.length === 1 && typeof args[0] === "object" && args[0]?.domain) domainArg = args[0].domain;

    if (!domainArg) throw new Error("whoisTool: missing domain");

    const domain = String(domainArg).trim();
    const url = `${WHOISFREAKS_API_BASE}/whois?apikey=${encodeURIComponent(WHOIS_API_KEY)}&domain=${encodeURIComponent(domain)}`;

    try {
      const resp = await fetch(url);
      const rawText = await resp.text();
      let json: any = null;
      try {
        json = JSON.parse(rawText);
      } catch {}

      const registered = json?.registered || json?.is_registered || /registered/i.test(rawText);
      const expires = json?.expires ?? json?.expiryDate ?? json?.expiration_date ?? null;
      const registrar = json?.registrar ?? null;

      const structured = {
        status: resp.ok ? "ok" : "error",
        domain,
        registered: Boolean(registered),
        expires,
        registrar,
        raw: json ?? rawText,
      };

      const text = registered
        ? `Domain ${domain} is registered.${expires ? ` Expires: ${expires}.` : ""}`
        : `Domain ${domain} is not registered.`;

      return {
        status: "ok",
        data: structured,
        output: {
          text,
          artifacts: [
            { type: "application/json", parts: [{ json: structured }] },
            { type: "text/plain", parts: [{ text }] },
          ],
        },
      };
    } catch (err: any) {
      return {
        status: "error",
        error: { code: -32001, message: String(err) },
        output: { text: `Error checking ${domain}: ${String(err)}` },
      };
    }
  },
};

export const domainAgent = new Agent({
  id: AGENT_ID,
  name: "Domain Checker",
  instructions:
    "When asked to check a domain, ALWAYS use the check_domain_status tool and return its output directly.",
  model: { id: "google/gemini-2.5-pro" },
  tools: { [whoisTool.name]: whoisTool },
});

function looksLikeResultEnvelope(obj: any) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.jsonrpc === "2.0" && ("result" in obj || "error" in obj)) return true;
  if (obj.result?.output) return true;
  if (obj.output) return true;
  return false;
}

export async function handleDomainMessage(userText: string): Promise<any> {
  try {
    const message = { role: "user", content: userText.trim() };

    const agentResult = await (domainAgent as any).generate({ message });

    if (looksLikeResultEnvelope(agentResult)) return agentResult;

    if (agentResult?.output)
      return { result: { ok: true, output: agentResult.output } };

    if (agentResult?.text)
      return { result: { ok: true, output: { text: agentResult.text } } };

    return {
      result: {
        ok: true,
        output: {
          text: JSON.stringify(agentResult, null, 2),
        },
      },
    };
  } catch (err: any) {
    return { error: { code: -32000, message: String(err) } };
  }
}

console.log("domainAgent tools:", (domainAgent as any).tools);
