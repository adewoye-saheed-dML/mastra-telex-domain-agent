// src/mastra/agents/server.ts
import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

// ✅ Import domain agent and utilities
import { handleDomainMessage, AGENT_ID } from "./domain-agent.js";

const PORT = Number(process.env.PORT ?? 3000);
const A2A_BASE = (process.env.MASTRA_A2A_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ----------------------
// 🧩 Agent Discovery Endpoint
// ----------------------
app.get(`/a2a/agent/${AGENT_ID}/.well-known/agent.json`, (_req: Request, res: Response) => {
  const invokeUrl = `${A2A_BASE}/a2a/agent/${AGENT_ID}`;
  res.json({
    id: AGENT_ID,
    name: "Domain Checker",
    description: "Checks domain availability using WhoisFreaks API.",
    a2a_version: "2.0",
    endpoints: { invoke: invokeUrl },
    skills: ["domain-check"],
    contact: "",
  });
});

// ----------------------
// 🔍 Helper: Extract text input
// ----------------------
function extractInputText(reqBody: any): string {
  const pm = reqBody?.params?.message ?? reqBody?.params?.message;
  if (pm?.parts && Array.isArray(pm.parts)) {
    for (const p of pm.parts) {
      const t = p.text ?? p.payload ?? p.body ?? (p.kind === "text" ? p.text : undefined);
      if (t && typeof t === "string" && t.trim()) return t.trim();
    }
  }

  if (typeof reqBody.input === "string" && reqBody.input.trim()) return reqBody.input.trim();
  if (typeof reqBody.params?.input === "string" && reqBody.params.input.trim()) return reqBody.params.input.trim();
  if (typeof reqBody.text === "string" && reqBody.text.trim()) return reqBody.text.trim();

  try {
    return JSON.stringify(reqBody.params?.message ?? reqBody.params ?? reqBody);
  } catch {
    return "";
  }
}

// ----------------------
// 🧾 Helper: Build JSON-RPC Response
// ----------------------
function buildResultPayload(idValue: any, text: string) {
  return {
    jsonrpc: "2.0",
    id: idValue,
    result: {
      ok: true,
      output: {
        text,
        artifacts: [{ type: "text/plain", parts: [{ text }] }],
      },
    },
  };
}

// ----------------------
// 📡 Helper: Post back to push_url
// ----------------------
async function postToPushUrl(pushUrl: string, payload: any, token?: string | null) {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    console.log("[A2A] posting to push_url:", pushUrl, "payload:", JSON.stringify(payload, null, 2));
    const resp = await fetch(pushUrl, { method: "POST", headers, body: JSON.stringify(payload) });
    const bodyText = await resp.text().catch(() => "");
    if (!resp.ok) {
      console.error(`[push_to_url] returned ${resp.status} ${resp.statusText} - ${bodyText}`);
    } else {
      console.log(`[push_to_url] posted final result (status ${resp.status})`);
    }
  } catch (err) {
    console.error("[push_to_url] failed to POST to push_url:", err);
  }
}

// ----------------------
// 🧠 Main Agent Endpoint
// ----------------------
app.post(`/a2a/agent/${AGENT_ID}`, async (req: Request, res: Response) => {
  console.log("[A2A] headers:", JSON.stringify(req.headers, null, 2));
  console.log("[A2A] body:", JSON.stringify(req.body, null, 2));

  const jsonrpc = req.body?.jsonrpc ?? "2.0";
  const id = req.body?.id ?? null;
  const params = req.body?.params ?? req.body;
  const input = extractInputText(req.body) ?? "";

  // Optional push config (for async jobs)
  const pushConfig = req.body?.configuration?.pushNotificationConfig ?? null;
  const pushUrlFromConfig = pushConfig?.url ?? null;
  const pushTokenFromConfig = pushConfig?.token ?? null;

  const pushUrlFromParams = params?.push_url ?? params?.pushUrl ?? null;
  const pushTokenFromParams = params?.push_token ?? params?.pushToken ?? null;

  const pushUrl = pushUrlFromParams ?? pushUrlFromConfig ?? null;
  const pushToken = pushTokenFromParams ?? pushTokenFromConfig ?? null;

  // If async mode (push URL provided)
  if (pushUrl) {
    try {
      if (id) res.status(202).json({ jsonrpc, id, result: { status: "accepted" } });
      else res.status(202).json({ ok: true, status: "accepted" });
    } catch (ackErr) {
      console.error("[A2A] ack failed:", ackErr);
    }

    (async () => {
      try {
        const rawReply = await handleDomainMessage(String(input));
        const replyText = rawReply ?? "No reply from agent.";
        const resultPayload = buildResultPayload(id, replyText);
        await postToPushUrl(pushUrl, resultPayload, pushToken);
      } catch (err) {
        console.error("[A2A] background error:", err);
        const errPayload = { jsonrpc, id, error: { code: -32000, message: String(err) } };
        await postToPushUrl(pushUrl, errPayload, pushToken);
      }
    })();

    return;
  }

  // Normal (sync) mode
  try {
    const rawReply = await handleDomainMessage(String(input));
    const replyText = rawReply ?? "No reply from agent.";
    if (id) res.json(buildResultPayload(id, replyText));
    else res.json({ ok: true, output: { text: replyText } });
  } catch (err) {
    console.error("[A2A] synchronous error:", err);
    if (id) res.status(500).json({ jsonrpc: "2.0", id, error: { code: -32000, message: String(err) } });
    else res.status(500).json({ ok: false, error: String(err) });
  }
});

// ----------------------
// 🚀 Start Server
// ----------------------
app.listen(PORT, () => {
  console.log(`Mastra A2A invoke URL: ${A2A_BASE}/a2a/agent/${AGENT_ID}`);
  console.log(`Discovery (agent card): ${A2A_BASE}/a2a/agent/${AGENT_ID}/.well-known/agent.json`);
  console.log(`Local server listening on port ${PORT}`);
});
