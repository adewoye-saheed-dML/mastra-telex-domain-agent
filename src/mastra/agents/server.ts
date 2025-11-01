import express from "express";
import { domainAgent } from "../agents/domain-agent";

const app = express();
app.use(express.json());

// Mastra A2A endpoint expected by Telex workflow node
app.post("/a2a/agent/domainAgent", async (req, res) => {
  try {
    const userMessage = req.body?.input || req.body?.text || "";
    const reply = await domainAgent.generate([userMessage]);
    res.json({ output: reply, ok: true });
  } catch (err) {
    console.error("A2A error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Mastra A2A endpoint live at http://localhost:${PORT}/a2a/agent/domainAgent`)
);
