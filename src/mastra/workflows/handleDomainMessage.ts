import { domainAgent } from "../agents/domain-agent";

export interface DomainMessage {
  content: string;
}

export const handleDomainMessage = async (message: DomainMessage) => {
  try {
    console.log("User message:", message.content);

    // ✅ Use correct Mastra UI message format
    const stream = await domainAgent.stream([
      {
        id: "unique-id", // Replace with a unique identifier generator if needed
        role: "user",
        content: message.content,
        parts: [
          {
            type: "text",       // ✅ REQUIRED
            text: message.content
          }
        ]
      }
    ]);

    if (!stream || typeof (stream as any).on !== "function") {
      throw new Error("Invalid stream object returned by domainAgent.stream");
    }

    let finalText = "";

    return await new Promise((resolve, reject) => {
      (stream as any).on("message", (msg: any) => {
        // ✅ Mastra sends streaming deltas inside msg.delta.text
        const chunk =
          msg?.delta?.text ??
          msg?.content?.text ??
          msg?.content ??
          "";

        if (chunk) finalText += chunk;
      });

      (stream as any).on("end", () => {
        console.log("✅ Stream finished");
        resolve({
          reply: finalText.trim() || "Domain lookup completed."
        });
      });

      (stream as any).on("error", (err: any) => {
        console.error("❌ Streaming error:", err);
        reject(err);
      });
    });
  } catch (error) {
    console.error("❌ Handler failed:", error);

    return {
      reply: "Something went wrong with the domain checker."
    };
  }
};
