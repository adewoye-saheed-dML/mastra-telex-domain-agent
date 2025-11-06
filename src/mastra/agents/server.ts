// src/mastra/agents/server.ts
import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config({ path: "./.env" });

import { handleDomainMessage, AGENT_ID } from "./domain-agent.js";

const PORT = Number(process.env.PORT ?? 3000);
const A2A_BASE = (process.env.MASTRA_A2A_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();
app.use(express.json({ limit: "2mb" }));

// Discovery
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

// Helper: extract plain user text ONLY (Option A)
function extractUserText(reqBody: any): string {
  const msg = reqBody?.params?.message ?? reqBody?.message ?? null;

  if (msg && Array.isArray(msg.parts)) {
    for (const p of msg.parts) {
      if (!p) continue;
      if (typeof p.text === "string" && p.text.trim()) return p.text.trim();
      if (typeof p.payload === "string" && p.payload.trim()) return p.payload.trim();
      if (typeof p.body === "string" && p.body.trim()) return p.body.trim();
    }
  }

  if (typeof reqBody?.input === "string" && reqBody.input.trim()) return reqBody.input.trim();
  if (typeof reqBody?.params?.input === "string" && reqBody.params.input.trim()) return reqBody.params.input.trim();
  if (typeof reqBody?.text === "string" && reqBody.text.trim()) return reqBody.text.trim();

  return "";
}

function buildJsonRpcResult(idValue: any, resultObj: any) {
  return { jsonrpc: "2.0", id: idValue ?? null, result: resultObj };
}

function buildJsonRpcError(idValue: any, code: number, message: string, data?: any) {
  return { jsonrpc: "2.0", id: idValue ?? null, error: { code, message, data } };
}

async function postToPushUrl(pushUrl: string, payload: any, token?: string | null) {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const resp = await fetch(pushUrl, { method: "POST", headers, body: JSON.stringify(payload) });
    const bodyText = await resp.text().catch(() => "");
    if (!resp.ok) console.error(`[push_to_url] error ${resp.status}: ${bodyText}`);
    else console.log(`[push_to_url] posted final result`);
  } catch (err) {
    console.error("[push_to_url] failed:", err);
  }
}

app.post(`/a2a/agent/${AGENT_ID}`, async (req: Request, res: Response) => {
  console.log("[A2A] headers:", JSON.stringify(req.headers, null, 2));
  console.log("[A2A] body:", JSON.stringify(req.body, null, 2));

  const jsonrpcVersion = req.body?.jsonrpc ?? "2.0";
  const id = req.body?.id ?? null;
  const userText = extractUserText(req.body);

  const pushConfig = req.body?.configuration?.pushNotificationConfig ?? null;
  const pushUrl = req.body?.params?.push_url ?? req.body?.params?.pushUrl ?? pushConfig?.url ?? null;
  const pushToken = req.body?.params?.push_token ?? req.body?.params?.pushToken ?? pushConfig?.token ?? null;

  // ASYNC
  if (pushUrl) {
    try {
      if (id) res.status(202).json({ jsonrpc: jsonrpcVersion, id, result: { status: "accepted" } });
      else res.status(202).json({ ok: true, status: "accepted" });
    } catch {}

    (async () => {
      try {
        const agentReply = await handleDomainMessage(String(userText));

        if (agentReply?.jsonrpc && (agentReply?.result || agentReply?.error))
          return await postToPushUrl(pushUrl, agentReply, pushToken);

        if (agentReply?.result)
          return await postToPushUrl(pushUrl, buildJsonRpcResult(id, agentReply.result), pushToken);

        if (agentReply?.error)
          return await postToPushUrl(pushUrl, buildJsonRpcError(id, agentReply.error.code ?? -32000, agentReply.error.message), pushToken);

        if (typeof agentReply === "string") {
          const payload = buildJsonRpcResult(id, { ok: true, output: { text: agentReply, artifacts: [{ type: "text/plain", parts: [{ text: agentReply }] }] } });
          return await postToPushUrl(pushUrl, payload, pushToken);
        }

        const payload = buildJsonRpcResult(id, { ok: true, output: { text: JSON.stringify(agentReply, null, 2), artifacts: [{ type: "application/json", parts: [{ json: agentReply }] }] } });
        return await postToPushUrl(pushUrl, payload, pushToken);
      } catch (err: any) {
        const errPayload = buildJsonRpcError(id, -32000, String(err?.message ?? err));
        await postToPushUrl(pushUrl, errPayload, pushToken);
      }
    })();
    return;
  }

  // SYNC
  try {
    const agentReply = await handleDomainMessage(String(userText));

    if (agentReply?.jsonrpc) return res.json(agentReply);

    if (agentReply?.result) return res.json(buildJsonRpcResult(id, agentReply.result));

    if (agentReply?.error)
      return res.status(500).json(buildJsonRpcError(id, agentReply.error.code ?? -32000, agentReply.error.message));

    if (typeof agentReply === "string") {
      const payload = buildJsonRpcResult(id, { ok: true, output: { text: agentReply } });
      return res.json(payload);
    }

    return res.json(buildJsonRpcResult(id, { ok: true, output: { text: JSON.stringify(agentReply, null, 2) } }));
  } catch (err: any) {
    return res.status(500).json(buildJsonRpcError(id, -32000, String(err?.message ?? err)));
  }
});

app.listen(PORT, () => {
  console.log(`Mastra A2A invoke URL: ${A2A_BASE}/a2a/agent/${AGENT_ID}`);
  console.log(`Discovery: ${A2A_BASE}/a2a/agent/${AGENT_ID}/.well-known/agent.json`);
  console.log(`Server running on port ${PORT}`);
});
