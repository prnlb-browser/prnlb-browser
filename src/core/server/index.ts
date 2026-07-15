import * as http from "node:http";
import * as path from "node:path";
import { handleConfigRoutes } from "../../config/routes.js";
import { handleCrawlRoutes } from "../../crawl/routes.js";
import { handleResultsRoutes } from "../../results/routes.js";
import { handleSearchRoutes } from "../../search/routes.js";
import { handleDownloadedRoutes } from "../../downloaded/routes.js";
import { handleActressRoutes } from "../../actresses/routes.js";
import { handleImageRoutes } from "../images/routes.js";
import { AppContext } from "./context.js";
import { json, serveStatic } from "./http.js";
import type { RouteHandler } from "./router.js";

const featureRoutes: RouteHandler[] = [
  handleConfigRoutes,
  handleCrawlRoutes,
  handleResultsRoutes,
  handleSearchRoutes,
  handleDownloadedRoutes,
  handleActressRoutes,
  handleImageRoutes,
];

export interface ServerInfo {
  server: http.Server;
  port: number;
}

export interface ServerOptions {
  staticDir?: string;
  userDataDir?: string;
  port?: number;
}

export function startServer(options: ServerOptions = {}): Promise<ServerInfo> {
  const staticDir = options.staticDir ?? path.resolve(__dirname, "../../../../public");
  const userDataDir = options.userDataDir ?? process.cwd();
  const app = new AppContext(staticDir, userDataDir);
  app.loadConfig();
  console.log("✅ Config loaded from", app.configStore.path);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    try {
      for (const route of featureRoutes) {
        if (await route({ req, res, url, method, app })) return;
      }
      if (serveStatic(res, app.staticDir, url.pathname)) return;
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (error) {
      console.error("Request error:", error);
      if (!res.headersSent) json(res, { error: "Internal server error" }, 500);
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    const port = options.port ?? Number.parseInt(process.env.PORT ?? "3000", 10);
    // Bind to the loopback interface explicitly. This server only serves
    // the Electron renderer and its own API; never accept non-local traffic.
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`\n🌐 Server running at http://localhost:${actualPort}`);
      resolve({ server, port: actualPort });
    });
    server.on("error", reject);
  });
}
