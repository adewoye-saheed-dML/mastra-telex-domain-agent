import { Workflow } from "@mastra/core";
import { z } from "zod";

import { AGENT_ID } from "../agents/domain-agent.js"; 

export const WORKFLOW_ID = "hng-domain-agent-001";

const inputSchema = z.object({
  text: z.string(),
});

const outputSchema = z.object({
  reply: z.string(),
});

// ---BASE URL & AGENT CONFIG ---
let A2A_BASE = process.env.MASTRA_A2A_BASE_URL?.trim() ||
  "https://mastra-telex-domain-agent-production.up.railway.app";

A2A_BASE = A2A_BASE.replace(/\/$/, "");
const agentId = AGENT_ID?.trim() || "domain-checker-agent";
const agentInvokeUrl = `${A2A_BASE}/a2a/agent/${agentId}`;

// Validate config
if (!A2A_BASE.startsWith("http")) {
  throw new Error(`Invalid MASTRA_A2A_BASE_URL: ${A2A_BASE}`);
}
if (!agentId) {
  throw new Error("Missing AGENT_ID (check your domain-agent.js or .env file)");
}

const domainWorkflowConfig = {
  active: true,
  category: "utilities",
  description: "Checks domain availability.",
  id: WORKFLOW_ID,
  
  // --- THE FINAL, SIMPLEST PROMPT ---
  long_description: `
      You are a domain checking bot.
      When a user asks to check a domain (e.g., "is example.com available?"), you MUST use the **domain-checker-agent** tool.
      After the tool runs, you MUST respond with the **exact, complete text** you receive from the tool. Do not add any other words.
  `,
  
  name: "Domain Agent",
  inputSchema,
  outputSchema,

  nodes: [
    {
      id: "domain-checker-agent", // Correctly matches prompt
      name: "Domain Agent Node",
      parameters: {},
      position: [800, -100],
      type: "a2a/mastra-a2a-node",
      typeVersion: 1,
      url: agentInvokeUrl,
    },
  ],
  pinData: {},
  settings: {
    executionOrder: "v1",
  },
  short_description: "Check domain availability.",
};

// Export the workflow (named export)
export const domainWorkflow = new Workflow(domainWorkflowConfig);