// workflows/domain-workflow.js
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

let A2A_BASE = process.env.MASTRA_A2A_BASE_URL?.trim() || "https://mastra-telex-domain-agent-production.up.railway.app";
A2A_BASE = A2A_BASE.replace(/\/$/, "");
const agentId = AGENT_ID?.trim() || "domain-checker-agent";
const agentInvokeUrl = `${A2A_BASE}/a2a/agent/${agentId}`;

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
  long_description: `
      You are a domain checking bot.
      When a user asks to check a domain (e.g., "is example.com available?"), the workflow will call the domain-checker-agent A2A node.
      The agent MUST return a JSON-RPC-like result with result.output.text and result.output.artifacts (the agent's tool output).
      The workflow should pass through the agent result as received.
  `,
  name: "Domain Agent",
  inputSchema,
  outputSchema,
  nodes: [
    {
      id: "domain-checker-agent",
      name: "Domain Agent Node",
      parameters: {
        message: {
          role: "user",
          parts: [
            {
              text: "{{ inputs.text }}",
            },
          ],
        },
      },
      position: [800, -100],
      type: "a2a/mastra-a2a-node",
      typeVersion: 1,
      url: agentInvokeUrl,
    },
    {
      id: "workflow-output-node",
      name: "Workflow Output",
      type: "workflow-output-node",
      typeVersion: 1,
      position: [1200, -100],
      parameters: {
        outputs: {
          reply:
            "{{ nodes['domain-checker-agent'].result.output.text | default: 'Error mapping agent response.' }}",
        },
      },
    },
  ],
  pinData: {},
  settings: {
    executionOrder: "v1",
  },
  short_description: "Check domain availability.",
};

export const domainWorkflow = new Workflow(domainWorkflowConfig);
