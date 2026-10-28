import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";

// stdout is the MCP protocol channel; every diagnostic must go to stderr.
console.log = (...a: unknown[]) => console.error(...a);

const server = createMcpServer();
await server.connect(new StdioServerTransport());
console.error("[mcp] lumiere-pro MCP server ready on stdio");
