
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

// const A2A_BASE = process.env.MASTRA_A2A_BASE_URL ?? "https://mastra-telex-domain-agent-production.up.railway.app/";
// const agentInvokeUrl = `${A2A_BASE.replace(/\/$/, "")}/a2a/agent/${AGENT_ID}`;


// --- SAFER BASE URL & AGENT CONFIG ---
let A2A_BASE = process.env.MASTRA_A2A_BASE_URL?.trim() ||
  "https://mastra-telex-domain-agent-production.up.railway.app";

// Clean trailing slash
A2A_BASE = A2A_BASE.replace(/\/$/, "");

// Ensure agent ID exists
const agentId = AGENT_ID?.trim() || "domain-checker-agent";

// Construct full agent invoke URL
const agentInvokeUrl = `${A2A_BASE}/a2a/agent/${agentId}`;

// Validate config to catch misconfiguration early
if (!A2A_BASE.startsWith("http")) {
  throw new Error(`Invalid MASTRA_A2A_BASE_URL: ${A2A_BASE}`);
}
if (!agentId) {
  throw new Error("Missing AGENT_ID (check your domain-agent.js or .env file)");
}

const domainWorkflowConfig = {
  active: true,
  category: "utilities",
  description: "Checks domain availability and posts a TLD of the Week.",
  id: WORKFLOW_ID,
  long_description: `
      You are a helpful Domain Assistant. Your job is to check the availability of domain names for a user.

      When a user asks to check a domain (e.g., "is example.com available?"), you MUST use the **domainCheckerTool** to find the answer.
      
      - Always ask for a domain name if one is not provided.
      - Clearly state the answer you get from the tool.
  `,
  name: "Domain & TLD Agent",

  inputSchema,
  outputSchema,

  nodes: [
    {
      id: "domainCheckerTool",
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