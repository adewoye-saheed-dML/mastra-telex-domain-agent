// src/mastra/agents/server.ts
import express from "express";
import type { Request, Response } from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config({ path: "./.env" });

// Import domain agent and utilities
import { handleDomainMessage, AGENT_ID } from "./domain-agent.js";

const PORT = Number(process.env.PORT ?? 3000);
const A2A_BASE = (process.env.MASTRA_A2A_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ------------- Discovery ----------------
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

// ------------- Helpers ----------------
function extractInputMessage(reqBody: any) {
  // Prefer params.message (Telex / Mastra)
  if (reqBody?.params?.message) return reqBody.params.message;
  // If direct 'message' present
  if (reqBody?.message) return reqBody.message;
  // If a plain string input
  if (typeof reqBody?.input === "string") return { role: "user", parts: [{ kind: "text", text: reqBody.input }] };
  if (typeof reqBody?.text === "string") return { role: "user", parts: [{ kind: "text", text: reqBody.text }] };

  // fallback to full params or the body
  return reqBody?.params ?? reqBody;
}

function buildJsonRpcResult(idValue: any, resultObj: any) {
  return {
    jsonrpc: "2.0",
    id: idValue ?? null,
    result: resultObj,
  };
}

function buildJsonRpcError(idValue: any, code: number, message: string, data?: any) {
  return {
    jsonrpc: "2.0",
    id: idValue ?? null,
    error: {
      code,
      message,
      data,
    },
  };
}

async function postToPushUrl(pushUrl: string, payload: any, token?: string | null) {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
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

// ------------- Main A2A Endpoint ----------------
app.post(`/a2a/agent/${AGENT_ID}`, async (req: Request, res: Response) => {
  console.log("[A2A] headers:", JSON.stringify(req.headers, null, 2));
  console.log("[A2A] body:", JSON.stringify(req.body, null, 2));

  const jsonrpcVersion = req.body?.jsonrpc ?? "2.0";
  const id = req.body?.id ?? null;

  // extract message payload, but keep the whole params available for agent
  const message = extractInputMessage(req.body);
  const params = req.body?.params ?? {};

  // push_url detection (support multiple shapes)
  const pushConfig = req.body?.configuration?.pushNotificationConfig ?? null;
  const pushUrlFromConfig = pushConfig?.url ?? null;
  const pushTokenFromConfig = pushConfig?.token ?? null;

  const pushUrlFromParams = params?.push_url ?? params?.pushUrl ?? params?.pushUrlFrom ?? null;
  const pushTokenFromParams = params?.push_token ?? params?.pushToken ?? null;

  const pushUrl = pushUrlFromParams ?? pushUrlFromConfig ?? null;
  const pushToken = pushTokenFromParams ?? pushTokenFromConfig ?? null;

  // Prepare the input we hand to the agent: keep params and message so agent has full context
  const agentInput = { params, message };

  // ASYNC/push mode
  if (pushUrl) {
    try {
      // acknowledge immediately
      if (id) res.status(202).json({ jsonrpc: jsonrpcVersion, id, result: { status: "accepted" } });
      else res.status(202).json({ ok: true, status: "accepted" });
    } catch (ackErr) {
      console.error("[A2A] ack failed:", ackErr);
    }

    // handle in background and post to push_url
    (async () => {
      try {
        const agentReply = await handleDomainMessage(agentInput);

        // If agentReply already is a full JSON-RPC envelope, post it
        if (agentReply?.jsonrpc && (agentReply?.result || agentReply?.error)) {
          await postToPushUrl(pushUrl, agentReply, pushToken);
          return;
        }

        // If agentReply contains 'result' or 'output', wrap into JSON-RPC result envelope
        if (agentReply?.result) {
          const payload = { jsonrpc: "2.0", id, result: agentReply.result };
          await postToPushUrl(pushUrl, payload, pushToken);
          return;
        }

        // If agentReply contains 'error'
        if (agentReply?.error) {
          const payload = buildJsonRpcError(id, agentReply.error.code ?? -32000, agentReply.error.message ?? "Agent error", agentReply.error.data ?? null);
          await postToPushUrl(pushUrl, payload, pushToken);
          return;
        }

        // fallback: treat agentReply as simple text or object
        if (typeof agentReply === "string") {
          const payload = buildJsonRpcResult(id, { ok: true, output: { text: agentReply, artifacts: [{ type: "text/plain", parts: [{ text: agentReply }] }] } });
          await postToPushUrl(pushUrl, payload, pushToken);
          return;
        }

        // final fallback: JSON.stringify
        const payload = buildJsonRpcResult(id, { ok: true, output: { text: JSON.stringify(agentReply, null, 2), artifacts: [{ type: "application/json", parts: [{ json: agentReply }] }] } });
        await postToPushUrl(pushUrl, payload, pushToken);
      } catch (err: any) {
        console.error("[A2A] background error:", err);
        const errPayload = buildJsonRpcError(id, -32000, String(err?.message ?? err), { where: "background_post" });
        await postToPushUrl(pushUrl, errPayload, pushToken);
      }
    })();

    return;
  }

  // SYNC mode
  try {
    const agentReply = await handleDomainMessage(agentInput);

    // If agentReply already looks like full envelope, return it directly
    if (agentReply?.jsonrpc && (agentReply?.result || agentReply?.error)) {
      return res.json(agentReply);
    }

    // If it's a 'result' shaped object, return a full JSON-RPC envelope (respect id)
    if (agentReply?.result) {
      return res.json({ jsonrpc: "2.0", id, result: agentReply.result });
    }

    if (agentReply?.error) {
      return res.status(500).json(buildJsonRpcError(id, agentReply.error.code ?? -32000, agentReply.error.message ?? "Agent error", agentReply.error.data ?? null));
    }

    // strings
    if (typeof agentReply === "string") {
      const payload = buildJsonRpcResult(id, { ok: true, output: { text: agentReply, artifacts: [{ type: "text/plain", parts: [{ text: agentReply }] }] } });
      return res.json(payload);
    }

    // fallback
    const payload = buildJsonRpcResult(id, { ok: true, output: { text: JSON.stringify(agentReply, null, 2), artifacts: [{ type: "application/json", parts: [{ json: agentReply }] }] } });
    return res.json(payload);
  } catch (err: any) {
    console.error("[A2A] synchronous error:", err);
    const errPayload = buildJsonRpcError(id, -32000, String(err?.message ?? err), { where: "sync_handler" });
    if (id) return res.status(500).json(errPayload);
    else return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

app.listen(PORT, () => {
  console.log(`Mastra A2A invoke URL: ${A2A_BASE}/a2a/agent/${AGENT_ID}`);
  console.log(`Discovery (agent card): ${A2A_BASE}/a2a/agent/${AGENT_ID}/.well-known/agent.json`);
  console.log(`Local server listening on port ${PORT}`);
});
