import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getProjectIntegrations } from "../integrations/store.js";
import { MCP_SERVER_FACTORIES } from "./servers.js";

const SEP = "__";

/**
 * Connects an MCP client to every integration server the project has connected,
 * runs `fn` with a tool hub, then closes all sessions.
 */
export async function withMcpHub(ctx, fn) {
  const integrations = await getProjectIntegrations(ctx.uid, ctx.project);
  const sessions = [];

  try {
    for (const [name, factory] of Object.entries(MCP_SERVER_FACTORIES)) {
      if (!factory.connectedWhen(integrations)) continue;
      const server = factory.create(ctx);
      const client = new Client({ name: `blazly-agent-${name}`, version: "1.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      sessions.push({ name, server, client, tools });
    }

    const hub = {
      connected: sessions.map((s) => s.name),
      tools: sessions.flatMap((s) =>
        s.tools.map((tool) => ({
          name: `${s.name}${SEP}${tool.name}`,
          description: `[${s.name}] ${tool.description || ""}`.trim(),
          input_schema: tool.inputSchema || { type: "object", properties: {} },
        })),
      ),
      async call(qualifiedName, args) {
        const [serverName, toolName] = qualifiedName.split(SEP);
        const session = sessions.find((s) => s.name === serverName);
        if (!session) return { isError: true, text: `Unknown integration tool: ${qualifiedName}` };
        const result = await session.client.callTool({ name: toolName, arguments: args || {} });
        const text = (result.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        return { isError: Boolean(result.isError), text };
      },
    };

    return await fn(hub);
  } finally {
    await Promise.allSettled(sessions.flatMap((s) => [s.client.close(), s.server.close()]));
  }
}
