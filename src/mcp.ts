import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { vaultIndexer } from "./services/indexer.js";
import { processQuery } from "./routers/query.js";
import { librarianAgent } from "./services/librarian.js";

// Wait for LanceDB to init
await vaultIndexer.init();

const server = new Server(
  {
    name: "MondayVault-MCP",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ask_vault",
        description: "The primary 'God' retrieval tool. Ask the Vault anything you don't know natively. It will automatically search personal memory, recent web data, or perform deep iterative web crawling as needed.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The question, topic, or fact you need information about.",
            },
            projectScope: {
              type: "string",
              description: "Optional. Limit the search to a specific project folder.",
            },
            sessionId: {
              type: "string",
              description: "Optional. Used to track multi-turn state (e.g. if the Vault returns a search plan for user approval). Pass this back if you are continuing a deep search workflow.",
            }
          },
          required: ["query"],
        },
      },
      {
        name: "save_memory",
        description: "Directly save a snippet of text to the Vault.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
            project: { type: "string", description: "Default is 'System'" }
          },
          required: ["title", "content"]
        }
      },
      {
        name: "unify_tags",
        description: "Trigger the Librarian Sub-Agent to scan all markdown files, find redundant tags, and unify them intelligently using the LLM.",
        inputSchema: {
          type: "object",
          properties: {},
          required: []
        }
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === "ask_vault") {
      const { query, projectScope, sessionId } = request.params.arguments as any;
      const result = await processQuery(query, projectScope, sessionId);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    if (request.params.name === "save_memory") {
      const { title, content, project } = request.params.arguments as any;
      const fileId = title.replace(/\s+/g, '_');
      await vaultIndexer.indexDocument(fileId, project || 'System', content);
      return {
        content: [{ type: "text", text: `Successfully indexed ${title} into LanceDB.` }]
      }
    }

    if (request.params.name === "unify_tags") {
      const result = await librarianAgent.unifyTags();
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      }
    }

    throw new Error("Tool not found");
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool: ${(error as Error).message}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("JarvisVault MCP Server running on stdio");
