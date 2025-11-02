// workflows/domain-workflow.ts
import { Workflow } from "@mastra/core";
import { z } from "zod";
import { AGENT_ID } from "../agents/domain-agent"; 

export const WORKFLOW_ID = "hng-domain-agent-001"; 

const inputSchema = z.object({
  text: z.string(),
});

const outputSchema = z.object({
  reply: z.string(),
});

const A2A_BASE = process.env.MASTRA_A2A_BASE_URL ?? "https://purring-loud-processor.mastra.cloud";
const agentInvokeUrl = `${A2A_BASE.replace(/\/$/, "")}/a2a/agent/${AGENT_ID}`;

const domainWorkflowConfig = {
  active: true,
  category: "utilities",
  description: "Checks domain availability and posts a TLD of the Week.",
  id: WORKFLOW_ID,
  long_description: "An agent that allows users to instantly check domain name availability...",
  name: "Domain & TLD Agent",

  inputSchema,
  outputSchema,

  nodes: [
    {
      id: "domain_agent_node",
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
