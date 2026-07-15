import type { Config } from "../core/types.js";
import type { RouteHandler } from "../core/server/router.js";
import { json, readJson } from "../core/server/http.js";

export const handleConfigRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  if (url.pathname === "/api/config" && method === "GET") {
    json(res, app.loadConfig());
    return true;
  }

  if (url.pathname === "/api/config" && method === "PUT") {
    app.saveConfig(await readJson<Config>(req));
    json(res, { message: "Config saved" });
    return true;
  }

  return false;
};
