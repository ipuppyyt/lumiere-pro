// Usage: node scripts/mcp-call.mjs <tool> '<json args>'
// Calls the built stdio MCP server exactly as Claude Code would.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [tool = "get_project_state", args = "{}"] = process.argv.slice(2);
const client = new Client({ name: "mcp-call", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["packages/mcp/dist/index.js"], stderr: "inherit" }));
const r = await client.callTool({ name: tool, arguments: JSON.parse(args) });
console.log(r.content[0].text);
await client.close();
