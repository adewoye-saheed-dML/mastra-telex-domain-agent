
import { Agent } from "@mastra/core/agent";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { z } from "zod";
import util from "util";

dotenv.config({ path: "./.env" });

// Exported agent id used by server/discovery
export const AGENT_ID = "domain-checker-agent";

// Load WhoisFreaks API key and base URL from environment variables
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

// (whoisTool implementation unchanged from the working version you already have)
const whoisTool = {
  name: "check_domain_status",
  description: "Checks if a given domain is registered using the WhoisFreaks API.",
  inputSchema: DomainSchema,
  async execute(...args: any[]) {
    // (omitted here for brevity in this snippet — assume this is your working version from earlier)
    // ... existing execute implementation (unchanged)
    // NOTE: in your file keep the full execute logic you had that extracts domain and calls WHOISFREAKS_API.
    return `placeholder - keep your real execute implementation here`;
  },
};

// Create the Mastra Agent (model specified as Mastra expects)
export const domainAgent = new Agent({
  id: AGENT_ID,
  name: "Domain Checker",
  instructions: "You check domain name registrations. To do this, you MUST use the 'check_domain_status' tool. ONLY use this tool.",
  model: { id: "google/gemini-2.5-pro" },
  tools: { [whoisTool.name]: whoisTool },
});

// --- UPDATED handler: only this function changed to extract text from more possible fields ---
function extractTextFromResult(result: any): string | null {
  if (!result) return null;

  // 1) top-level text
  if (typeof result.text === "string" && result.text.trim()) return result.text.trim();

  // 2) common single-field places
  if (typeof result.output_text === "string" && result.output_text.trim()) return result.output_text.trim();
  if (typeof result.result === "string" && result.result.trim()) return result.result.trim();
  if (typeof result.output === "string" && result.output.trim()) return result.output.trim();

  // 3) output.text
  if (result.output?.text && typeof result.output.text === "string" && result.output.text.trim()) return result.output.text.trim();

  // 4) artifacts (first artifact text)
  try {
    const art = result.artifacts?.[0]?.parts?.[0]?.text;
    if (art && typeof art === "string" && art.trim()) return art.trim();
  } catch {}

  // 5) uiMessages -> metadata.__originalContent or parts
  try {
    const ui = result.uiMessages?.[0];
    if (ui) {
      const orig = ui.metadata?.__originalContent;
      if (orig && typeof orig === "string" && orig.trim()) return orig.trim();
      // parts array
      if (Array.isArray(ui.parts)) {
        for (const p of ui.parts) {
          if (p?.text && typeof p.text === "string" && p.text.trim()) return p.text.trim();
        }
      }
    }
  } catch {}

  // 6) steps[].content[] entries of type 'text'
  try {
    if (Array.isArray(result.steps)) {
      for (const step of result.steps) {
        if (!step?.content || !Array.isArray(step.content)) continue;
        for (const c of step.content) {
          if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) return c.text.trim();
          // sometimes nested under 'output' or 'text'
          if (c?.output?.text && typeof c.output.text === "string" && c.output.text.trim()) return c.output.text.trim();
          if (c?.text && typeof c.text === "string" && c.text.trim()) return c.text.trim();
        }
      }
    }
  } catch {}

  // 7) Try outputs array
  try {
    if (Array.isArray(result.outputs)) {
      for (const o of result.outputs) {
        if (o?.output_text && typeof o.output_text === "string" && o.output_text.trim()) return o.output_text.trim();
      }
    }
  } catch {}

  // 8) fallback: look for any first string value deeply (compact scan)
  try {
    const seen = new Set<any>();
    const stack = [result];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === "string" && v.trim().length > 0) {
          // heuristic: ignore long base64 or signatures by checking length and presence of whitespace
          if (v.length < 2000) return v.trim();
        } else if (typeof v === "object") {
          stack.push(v);
        }
      }
    }
  } catch {}

  return null;
}

export async function handleDomainMessage(inputText: string): Promise<string> {
  try {
    const result: any = await (domainAgent as any).generate(inputText);

    // log raw result for debugging (kept)
    console.log("[handleDomainMessage] raw generate result:", util.inspect(result, { depth: 4 }));

    // Use the extractor above
    const extracted = extractTextFromResult(result);
    if (extracted) return String(extracted);

    // If extractor couldn't find a good text, return a helpful diagnostic (compact)
    const short = `[No direct text found in agent result] See server logs for full 'raw generate result'.`;
    const compact = (() => {
      try {
        return JSON.stringify(
          result,
          (k, v) => {
            if (typeof v === "object" && v && Object.keys(v).length > 20) return "[object]";
            return v;
          },
          2
        ).slice(0, 2000);
      } catch {
        return String(result).slice(0, 2000);
      }
    })();
    return `${short}\n\n${compact}`;
  } catch (err: any) {
    console.error("[handleDomainMessage] FAILED:", err);
    return `Error: ${err.message ?? String(err)}`;
  }
}

console.log("domainAgent tools:", (domainAgent as any).tools);
