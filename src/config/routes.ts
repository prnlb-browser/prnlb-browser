import { normalizeMcpSettings } from "../core/mcp/listener.js";
import type { Config } from "../core/types.js";
import type { RouteHandler } from "../core/server/router.js";
import { json, readJson } from "../core/server/http.js";
import { resolverRegistry } from "../core/images/registry.js";
import { getKnownTags } from "../core/known-tags.js";
import { deleteKnownTag, updateKnownTag, TagManagementError, type TagUpdateInput } from "../core/tag-management.js";

export const handleConfigRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  if (url.pathname === "/api/config/tags" && method === "GET") {
    json(res, { tags: getKnownTags(app) });
    return true;
  }

  if (url.pathname === "/api/config/tags" && (method === "PATCH" || method === "DELETE")) {
    let raw: unknown;
    try {
      raw = await readJson<unknown>(req);
    } catch {
      json(res, { error: "Invalid JSON body" }, 400);
      return true;
    }
    const body = raw && typeof raw === "object"
      ? raw as TagUpdateInput
      : {};
    try {
      json(res, method === "PATCH" ? updateKnownTag(app, body) : deleteKnownTag(app, body.name));
    } catch (error) {
      if (!(error instanceof TagManagementError)) throw error;
      json(res, { error: error.message }, error.status);
    }
    return true;
  }

  if (url.pathname === "/api/config" && method === "GET") {
    json(res, app.loadConfig());
    return true;
  }

  if (url.pathname === "/api/config" && method === "PUT") {
    const config = await readJson<Config>(req);
    // LAN sharing has its own validated lifecycle endpoint.
    config.lanSharing = app.loadConfig().lanSharing;
    try {
      config.mcp = normalizeMcpSettings(config.mcp);
      await app.mcp.configure(config.mcp);
    } catch (error) {
      json(res, { error: error instanceof Error ? error.message : "Unable to configure MCP" }, 400);
      return true;
    }
    const previousMcp = app.loadConfig().mcp;
    try {
      app.saveConfig(config);
    } catch (error) {
      await app.mcp.configure(previousMcp);
      throw error;
    }
    json(res, { message: "Config saved" });
    return true;
  }

  if (url.pathname === "/api/usage" && method === "GET") {
    json(res, app.getUsageStore().getStats());
    return true;
  }

  if (url.pathname === "/api/config/turboimagehost/verification-data" && method === "DELETE") {
    await resolverRegistry.clearTurboImageHostVerificationData();
    json(res, {
      message: "TurboImageHost cookies and verification data cleared",
    });
    return true;
  }

  return false;
};
