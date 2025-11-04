Mastra Domain Checker Agent
===========================

This is a simple A2A (Agent-to-Agent) service built with the [Mastra SDK](https://www.google.com/search?q=https://www.mastra.io/) and Node.js/Express. It provides an API endpoint that uses the [WhoisFreaks API](https://whoisfreaks.com/) to check the registration status and availability of a given domain name.

The agent uses a Google Gemini model (gemini-2.5-pro) to understand the user's request and call the appropriate tool.

Tech Stack
----------

*   **Framework:** Mastra SDK
    
*   **Server:** Node.js, Express
    
*   **Language:** TypeScript
    
*   **Dependencies:** zod (for validation), node-fetch
    
*   **External API:** WhoisFreaks (for WHOIS lookups)
    
*   **AI Model:** Google Gemini 2.5 Pro
    

Getting Started
---------------

Follow these steps to set up and run the agent on your local machine.

### 1\. Installation

Clone the repository and install the required dependencies:

```
# Clone this repository  
git clone <your-repo-url>
cd mastra-telex-domain-agent 

# Install dependencies  
npm install   

 ```

### 2\. Configuration (The .env file)

This is the most important step. The agent relies on environment variables for API keys and server configuration.

Create a .env file in the root of the project:


Now, add the following variables to your new .env file:

```
# --- WhoisFreaks API ---  
# Get this from your WhoisFreaks dashboard  

WHOISFREAKS_API_KEY=your_whoisfreaks_api_key_here  
WHOISFREAKS_API_BASE=[https://api.whoisfreaks.com/v1.0](https://api.whoisfreaks.com/v1.0) 

# --- Google API Key ---  
# Get this from Google AI Studio for the Gemini model  
GOOGLE_GENERATIVE_AI_API_KEY=your_google_ai_api_key_here  

# --- SDK Compatibility Aliases ---  
# The Mastra SDK (or its underlying libraries) may look for these specific names.

# Setting these aliases ensures the Google API key is found.  
GOOGLE_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY}  
GEMINI_API_KEY=${GOOGLE_GENERATIVE_AI_API_KEY} 

# --- Server Configuration ---  
PORT=3000  
MASTRA_A2A_BASE_URL=http://localhost:3000  

```

### 3\. Build and Run the Agent

This project uses TypeScript, so you must **build** the code before running the server.

```
# 1. Compile the TypeScript (from src/ to dist/)  
    npm run build  
# 2. Start the compiled server 
     npm run start   

 ```

Your server should now be running and listening on http://localhost:3000.

Usage (Testing the Agent)
-------------------------

Once the server is running, you can test the agent by sending a curl request to its invoke endpoint.

```
curl -X POST http://localhost:3000/a2a/agent/domain-checker-agent \  
-H "Content-Type: application/json" \      
 -d '{"jsonrpc":"2.0","id":"1","params":{"message":{"role":"user","parts":[{"kind":"text","text":"Check domain insightsdataacademy.com"}]}}}'   `

#### Example Success Response

``
{    "jsonrpc": "2.0",    "id": "1",    "result": {      "ok": true,      
"output": {        "text": "✅ Status for `insightsdataacademy.com`: REGISTERED\nRegistrar: NAMECHEAP INC\nCreated: 2023-11-15\nExpiry: 2024-11-15",        "artifacts": [          {            "type": "text/plain",            "parts": [              {                "text": "✅ Status for `insightsdataacademy.com`: REGISTERED\nRegistrar: NAMECHEAP INC\nCreated: 2023-11-15\nExpiry: 2024-11-15"              }            ]          }        ]      }    }  }   

```

Troubleshooting
---------------

If you encounter errors, check the following common issues:

1.  **Error: promise 'text' was not resolved...**
    
    *   **Cause:** This is almost always an authentication error with the Google Gemini API.
        
    *   **Fix:** Double-check your .env file. Ensure GOOGLE\_GENERATIVE\_AI\_API\_KEY is correct and that you have also set the GOOGLE\_API\_KEY and GEMINI\_API\_KEY aliases.
        
2.  **Error: Error: Tool ... not found**
    
    *   **Cause:** The AI model is trying to call a tool name that doesn't match the name property defined in src/mastra/agents/domain-agent.ts. The AI can be non-deterministic and "guess" different names.
        
    *   **Fix:** Check your server log for the _exact_ name the AI tried to call (e.g., whois\_freaks.check\_domain or whoisfreaks.is\_domain\_registered).
        
    *   **Solution:** Open src/mastra/agents/domain-agent.ts, find the whoisTool definition, and set its name property to match the one in the error log.
        
    *   instructions: "You check domain name registrations. To do this, you MUST use the 'check\_domain\_status' tool. ONLY use this tool."...and then set the tool's name to check\_domain\_status.
        
3.  **Error: Cannot read properties of undefined (reading 'trim')**
    
    *   **Cause:** This is an error with the tool's execute function signature. The Mastra SDK passes two arguments (context and inputs), but the function is only defined to accept one.
        
    *   async execute(\_: any, input: z.infer) { ... }
        
4.  **My Code Changes Aren't Working!**
    
    *   **Cause:** You are running the compiled code from the dist/ folder. If you edit files in src/, your changes will not be reflected until you re-compile.
        
    *   **Fix:** Stop the server (Ctrl+C) and run npm run build _before_ running npm run start again.