import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import { createServer } from "./server.js";

export async function startStreamableHttpServer(createMcpServer) {
  const port = Number(process.env.PORT ?? 3001);
  const app = createMcpExpressApp({ host: "0.0.0.0" });
  app.use(cors());

  app.all("/mcp", async (req, res) => {
    const method = req.body?.method;
    const toolName = req.body?.params?.name;
    if (method === "tools/call") {
      console.log(`[tool] ${toolName}`, JSON.stringify(req.body?.params?.arguments ?? {}));
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const httpServer = app.listen(port, (error) => {
    if (error) {
      console.error("Failed to start HTTP transport:", error);
      process.exit(1);
    }
    console.log(`MCP server listening on http://localhost:${port}/mcp`);
  });

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export async function startStdioServer(createMcpServer) {
  await createMcpServer().connect(new StdioServerTransport());
}

async function main() {
  if (process.argv.includes("--stdio")) {
    await startStdioServer(createServer);
    return;
  }

  await startStreamableHttpServer(createServer);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
