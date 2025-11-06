// index.ts
import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";

import { domainWorkflow, WORKFLOW_ID } from "./workflows/domain-workflow.js";
import { domainAgent, AGENT_ID } from "./agents/domain-agent.js";

const libsqlUrl = process.env.LIBSQL_URL ?? ":memory:";
const logLevel = (process.env.LOG_LEVEL || "info") as any;

export const mastra = new Mastra({
  workflows: { [WORKFLOW_ID]: domainWorkflow },
  agents: { [AGENT_ID]: domainAgent },
  storage: new LibSQLStore({
    url: libsqlUrl,
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: logLevel,
  }),
  telemetry: {
    enabled: process.env.MASTRA_TELEMETRY_ENABLED === "true",
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: { enabled: true },
  },
});

console.log("Mastra runtime initialized with domain workflow and agent.");
