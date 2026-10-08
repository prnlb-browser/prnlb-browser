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
    app.saveConfig(await readJson<Config>(req));
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
