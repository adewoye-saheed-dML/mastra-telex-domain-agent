
import { Workflow } from '@mastra/core';
import { z } from 'zod'; 


const inputSchema = z.object({
  // This rule says the input must be an object
  // with a "text" property that is a string.
  // Example: { "text": "/check google.com" }
  text: z.string(),
});

const outputSchema = z.object({
  // This rule says the output will be an object
  // with a "reply" property that is a string.
  // Example: { "reply": "Status for `google.com`: AVAILABLE!" }
  reply: z.string(),
});


const domainWorkflowConfig = {
  active: true,
  category: "utilities",
  description: "Checks domain availability and posts a TLD of the Week.",
  id: "hng-domain-agent-001",
  long_description:
    "An agent that allows users to instantly check domain name availability...",
  name: "Domain & TLD Agent",


  inputSchema: inputSchema,
  outputSchema: outputSchema,

  nodes: [
    {
      id: "domain_agent_node",
      name: "Domain Agent Node",
      parameters: {},
      position: [800, -100],
      type: "a2a/mastra-a2a-node",
      typeVersion: 1,
      url:"https://purring-loud-processor.mastra.cloud/a2a/agent/domainAgent",
    },
  ],
  pinData: {},
  settings: {
    executionOrder: "v1",
  },
  short_description: "Check domain availability.",
};


export const domainWorkflow = new Workflow(domainWorkflowConfig);