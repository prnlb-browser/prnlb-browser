import type { AppContext } from "./server/context.js";
import { getKnownTags } from "./known-tags.js";
import { normalizeTags, type Tag } from "./tags.js";

type TagManagementApp = Pick<AppContext, "getTopicStore" | "getDownloadedStore">;

export interface TagUpdateInput {
  name?: unknown;
  newName?: unknown;
  color?: unknown;
}

export interface TagManagementResult {
  tags: Tag[];
  updatedResults: number;
  updatedDownloaded: number;
}

export class TagManagementError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
    this.name = "TagManagementError";
  }
}

function requireKnownTag(app: TagManagementApp, rawName: unknown): { existing: Tag; tags: Tag[] } {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) throw new TagManagementError("Tag name is required", 400);
  const tags = getKnownTags(app);
  const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
  if (!existing) throw new TagManagementError("Tag not found", 404);
  return { existing, tags };
}

function persistTagChange(app: TagManagementApp, name: string, replacement: Tag | null): TagManagementResult {
  const updatedResults = app.getTopicStore().updateTagEverywhere(name, replacement);
  const updatedDownloaded = app.getDownloadedStore().updateTagEverywhere(name, replacement);
  return { tags: getKnownTags(app), updatedResults, updatedDownloaded };
}

// Shared by Config HTTP routes and MCP so both enforce the same global edit rules.
export function updateKnownTag(app: TagManagementApp, input: TagUpdateInput): TagManagementResult {
  const { existing, tags } = requireKnownTag(app, input.name);
  const newName = input.newName === undefined ? existing.name
    : typeof input.newName === "string" ? input.newName.trim() : "";
  if (!newName) throw new TagManagementError("Tag name is required", 400);
  if (tags.some((tag) => tag.name.toLowerCase() === newName.toLowerCase()
    && tag.name.toLowerCase() !== existing.name.toLowerCase())) {
    throw new TagManagementError("A tag with this name already exists", 409);
  }
  const color = input.color === undefined ? existing.color : input.color;
  const replacement = normalizeTags([{ name: newName, color }])[0]!;
  if (color !== null && (typeof color !== "string" || !replacement.color)) {
    throw new TagManagementError("Invalid tag color", 400);
  }
  return persistTagChange(app, existing.name, replacement);
}

export function deleteKnownTag(app: TagManagementApp, name: unknown): TagManagementResult {
  const { existing } = requireKnownTag(app, name);
  return persistTagChange(app, existing.name, null);
}
