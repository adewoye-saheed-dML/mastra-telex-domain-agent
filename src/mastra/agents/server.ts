// server.ts
import express from "express";
import type { Request, Response } from "express";
import { domainAgent, AGENT_ID } from "./domain-agent.ts";
import * as dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const PORT = Number(process.env.PORT ?? 3000);
const A2A_BASE = (process.env.MASTRA_A2A_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * Agent card for discovery (Mastra A2A / client discovery).
 * GET /a2a/agent/:agentId/.well-known/agent.json
 */
app.get(`/a2a/agent/${AGENT_ID}/.well-known/agent.json`, (_req: Request, res: Response) => {
  const invokeUrl = `${A2A_BASE}/a2a/agent/${AGENT_ID}`;
  const agentCard = {
    id: AGENT_ID,
    name: "Domain Checker",
    description: "Checks domain availability and posts a random TLD weekly.",
    a2a_version: "2.0",
    endpoints: {
      invoke: invokeUrl,
    },
    skills: ["domain-check", "tld-of-week"],
    contact: "",
  };

  res.json(agentCard);
});

/** Normalize a domainAgent.generate response to a plain string. */
function normalizeAgentReply(reply: any): string {
  if (!reply && reply !== "") return "";
  if (typeof reply === "string") return reply;
  if (Array.isArray(reply) && typeof reply[0] === "string") return reply[0];
  if (typeof reply === "object") {
    if (typeof (reply as any).text === "string") return (reply as any).text;
    if (typeof (reply as any).output_text === "string") return (reply as any).output_text;
    if ((reply as any).output?.text) return (reply as any).output.text;
    try {
      return JSON.stringify(reply);
    } catch {
      return String(reply);
    }
  }
  return String(reply);
}

/** POST the final result to push_url (A2A async flow). */
async function postToPushUrl(pushUrl: string, payload: any) {
  try {
    const resp = await fetch(pushUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[push_to_url] push_url returned ${resp.status} ${resp.statusText} - ${body}`);
    } else {
      console.log("[push_to_url] successfully posted final result to push_url");
    }
  } catch (err) {
    console.error("[push_to_url] failed to POST to push_url:", err);
  }
}

/**
 * Main A2A endpoint used by Telex / other A2A clients.
 * Supports both synchronous JSON-RPC result and async push_url pattern.
 */
app.post(`/a2a/agent/${AGENT_ID}`, async (req: Request, res: Response) => {
  console.log("[A2A] incoming headers:", JSON.stringify(req.headers, null, 2));
  console.log("[A2A] incoming body:", JSON.stringify(req.body, null, 2));

  const jsonrpc = req.body?.jsonrpc ?? "2.0";
  const id = req.body?.id ?? null;
  const params = req.body?.params ?? req.body;

  const input =
    params?.input ??
    params?.task?.input ??
    params?.text ??
    req.body?.input ??
    req.body?.text ??
    "";

  const pushUrl = params?.push_url ?? params?.pushUrl ?? null;

  function buildResultPayload(idValue: any, text: string) {
    return {
      jsonrpc,
      id: idValue,
      result: {
        ok: true,
        output: {
          text,
          artifacts: [
            {
              type: "text/plain",
              parts: [{ text }],
            },
          ],
        },
      },
    };
  }

  if (pushUrl) {
    try {
      if (id) res.status(202).json({ jsonrpc, id, result: { status: "accepted" } });
      else res.status(202).json({ ok: true, status: "accepted" });
    } catch (ackErr) {
      console.error("[A2A] failed to send ack:", ackErr);
    }

    // Run in background and POST final result to push_url
    (async () => {
      try {
        const rawReply = await domainAgent.generate([String(input)]);
        const replyText = normalizeAgentReply(rawReply) || "No reply from agent.";
        const resultPayload = buildResultPayload(id, replyText);
        await postToPushUrl(pushUrl, resultPayload);
      } catch (err) {
        console.error("[A2A] background processing error:", err);
        const errPayload = { jsonrpc, id, error: { code: -32000, message: String(err) } };
        await postToPushUrl(pushUrl, errPayload);
      }
    })();

    return;
  }

  // Synchronous flow
  try {
    const rawReply = await domainAgent.generate([String(input)]);
    const replyText = normalizeAgentReply(rawReply) || "No reply from agent.";

    if (id) res.json(buildResultPayload(id, replyText));
    else res.json({ ok: true, output: { text: replyText } });
  } catch (err) {
    console.error("[A2A] synchronous handler error:", err);
    if (id) {
      res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } });
    } else {
      res.status(500).json({ ok: false, error: String(err) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Mastra A2A invoke URL: ${A2A_BASE}/a2a/agent/${AGENT_ID}`);
  console.log(`Discovery (agent card): ${A2A_BASE}/a2a/agent/${AGENT_ID}/.well-known/agent.json`);
  console.log(`Local server listening on port ${PORT}`);
});
