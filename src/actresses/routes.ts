import * as fs from "node:fs";
import * as path from "node:path";
import type { AppContext } from "../core/server/context.js";
import type { RouteHandler } from "../core/server/router.js";
import { json, readJson } from "../core/server/http.js";
import { downloadAndCacheImage } from "../core/images/downloader.js";
import { prepareImagesDirectory } from "../downloaded/scanner.js";
import { getActressLookupProvider, getActressLookupProviders } from "../core/actress-lookup/registry.js";
import { validateFolderPath } from "../core/fs-paths.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

// Actress pictures have no associated video file to live next to (unlike
// Downloaded items), so they share the Downloaded Files folder's `.images`
// cache directory instead — same convention and same physical folder used
// for downloaded item post images. Falls back to the app's user data dir
// if no Downloaded Files folder has been configured yet, or if the value
// stored in config no longer points at a valid directory (e.g. it was
// edited manually, the disk was unmounted, or the folder was deleted).
function actressImagesDir(app: AppContext): string {
  const downloadedFolder = app.loadConfig().downloadedFolder;
  const validation = validateFolderPath(downloadedFolder);
  return prepareImagesDirectory(validation.ok ? validation.absolutePath : app.userDataDir);
}

export const handleActressRoutes: RouteHandler = async ({ req, res, url, method, app }) => {
  const store = app.getActressStore();

  if (url.pathname === "/api/actresses" && method === "GET") {
    json(res, store.getAll());
    return true;
  }

  // GET /api/actresses/find?name=... — case-insensitive lookup against the
  // primary name or any alias, used to resolve a "Cast" name to a record.
  if (url.pathname === "/api/actresses/find" && method === "GET") {
    const name = url.searchParams.get("name") ?? "";
    const actress = name.trim() ? store.findByName(name) : undefined;
    json(res, { actress: actress ?? null });
    return true;
  }

  if (url.pathname === "/api/actresses" && method === "POST") {
    const body = await readJson<{ name?: string; otherNames?: unknown; postImageUrl?: string | null }>(req);
    const name = body.name?.trim();
    if (!name) {
      json(res, { error: "name is required" }, 400);
      return true;
    }

    const created = store.insert({ name, otherNames: body.otherNames, postImage: null, cachedImage: null });

    const rawUrl = body.postImageUrl?.trim();
    if (rawUrl) {
      const imagesDir = actressImagesDir(app);
      const cached = await downloadAndCacheImage(rawUrl, `actress-${created.id}`, imagesDir);
      if (cached) store.updateItem(created.id, { postImage: rawUrl, cachedImage: cached });
    }

    json(res, store.getById(created.id), 201);
    return true;
  }

  if (url.pathname === "/api/actresses/item" && method === "PATCH") {
    const body = await readJson<{
      id: number;
      name?: string;
      otherNames?: unknown;
      postImageUrl?: string | null;
    }>(req);
    const { id } = body;
    if (!id) {
      json(res, { error: "id is required" }, 400);
      return true;
    }
    const item = store.getById(id);
    if (!item) {
      json(res, { error: "Actress not found" }, 404);
      return true;
    }

    const fields: { name?: string; otherNames?: unknown; postImage?: string | null; cachedImage?: string | null } = {};
    if ("name" in body && body.name?.trim()) fields.name = body.name.trim();
    if ("otherNames" in body) fields.otherNames = body.otherNames;

    if ("postImageUrl" in body) {
      const rawUrl = body.postImageUrl?.trim() ? body.postImageUrl.trim() : null;
      if (rawUrl) {
        const imagesDir = actressImagesDir(app);
        const cached = await downloadAndCacheImage(rawUrl, `actress-${id}`, imagesDir);
        if (cached) {
          fields.postImage = rawUrl;
          fields.cachedImage = cached;
        }
      } else {
        fields.postImage = null;
        fields.cachedImage = null;
      }
    }

    store.updateItem(id, fields);
    json(res, store.getById(id));
    return true;
  }

  // PATCH /api/actresses/item/favorite — toggle the star pin for an actress.
  if (url.pathname === "/api/actresses/item/favorite" && method === "PATCH") {
    const body = await readJson<{ id?: number }>(req);
    const id = body.id;
    if (!id) {
      json(res, { error: "id is required" }, 400);
      return true;
    }
    const isFavorite = store.toggleFavorite(id);
    if (isFavorite === undefined) {
      json(res, { error: "Actress not found" }, 404);
      return true;
    }
    json(res, { id, isFavorite });
    return true;
  }

  if (url.pathname === "/api/actresses/item" && method === "DELETE") {
    const id = Number.parseInt(url.searchParams.get("id") ?? "", 10);
    if (Number.isNaN(id)) {
      json(res, { error: "id query parameter is required" }, 400);
      return true;
    }
    const item = store.getById(id);
    if (!item) {
      json(res, { error: "Actress not found" }, 404);
      return true;
    }
    if (item.cachedImage) {
      const imagePath = path.join(actressImagesDir(app), item.cachedImage);
      if (fs.existsSync(imagePath)) {
        try { fs.unlinkSync(imagePath); } catch {}
      }
    }
    store.deleteById(id);
    json(res, { deleted: true, id });
    return true;
  }

  // GET /api/actresses/lookup/providers — list available external data sources.
  if (url.pathname === "/api/actresses/lookup/providers" && method === "GET") {
    json(res, getActressLookupProviders().map((p) => ({ id: p.id, label: p.label })));
    return true;
  }

  // GET /api/actresses/lookup/search?provider=&query=... — search an
  // external source (e.g. Boobpedia) for candidate actress pages.
  if (url.pathname === "/api/actresses/lookup/search" && method === "GET") {
    const providerId = url.searchParams.get("provider") ?? "";
    const query = (url.searchParams.get("query") ?? "").trim();
    const provider = getActressLookupProvider(providerId);
    if (!provider) {
      json(res, { error: "Unknown provider" }, 400);
      return true;
    }
    if (!query) {
      json(res, { error: "query is required" }, 400);
      return true;
    }
    try {
      json(res, { matches: await provider.search(query) });
    } catch (err) {
      json(res, { error: (err as Error).message }, 502);
    }
    return true;
  }

  // GET /api/actresses/lookup/details?provider=&title=... — fetch
  // name/aliases/photo for one search match (does not download the image).
  if (url.pathname === "/api/actresses/lookup/details" && method === "GET") {
    const providerId = url.searchParams.get("provider") ?? "";
    const title = (url.searchParams.get("title") ?? "").trim();
    const provider = getActressLookupProvider(providerId);
    if (!provider) {
      json(res, { error: "Unknown provider" }, 400);
      return true;
    }
    if (!title) {
      json(res, { error: "title is required" }, 400);
      return true;
    }
    try {
      const details = await provider.fetchDetails(title);
      if (!details) {
        json(res, { error: "No details found" }, 404);
        return true;
      }
      json(res, details);
    } catch (err) {
      json(res, { error: (err as Error).message }, 502);
    }
    return true;
  }

  // GET /api/actresses/images/:filename — serve a cached actress picture.
  if (url.pathname.startsWith("/api/actresses/images/") && method === "GET") {
    const filename = decodeURIComponent(url.pathname.slice("/api/actresses/images/".length));
    if (!filename || filename.includes("..") || filename.includes("/")) {
      json(res, { error: "Invalid filename" }, 400);
      return true;
    }
    const filePath = path.join(actressImagesDir(app), filename);
    if (!fs.existsSync(filePath)) {
      json(res, { error: "Image not found" }, 404);
      return true;
    }
    res.writeHead(200, {
      "Content-Type": IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "max-age=86400",
    });
    res.end(fs.readFileSync(filePath));
    return true;
  }

  return false;
};
