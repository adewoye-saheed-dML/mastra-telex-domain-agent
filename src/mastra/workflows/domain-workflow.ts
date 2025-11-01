
const domainWorkflow = {
  active: true,
  category: "utilities",
  description: "Checks domain availability and posts a TLD of the Week.",

  id: "hng-domain-agent-001",
  long_description:
    "An agent that allows users to instantly check domain name availability via a no-auth API, and also regularly posts a 'TLD of the Week' from a cached list to inspire new projects.",
  name: "Domain & TLD Agent",

  nodes: [
    {
      id: "domain_agent_node",
      name: "Domain Agent Node",
      parameters: {},
      position: [800, -100],
      type: "a2a/mastra-a2a-node",
      typeVersion: 1,
      url: "https://YOUR_DEPLOYED_URL_HERE/a2a/agent/domainAgent",
    },
  ],
  pinData: {},
  settings: {
    executionOrder: "v1",
  },
  short_description: "Check domain availability.",
};

export default domainWorkflow;
