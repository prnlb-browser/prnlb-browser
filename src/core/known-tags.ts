import type { Tag } from "./tags.js";
import { mergeTagLists } from "./tags.js";

interface TagSource {
  getAllTags(): Tag[];
}

interface KnownTagsApp {
  getDownloadedStore?: () => TagSource;
  getTopicStore?: () => TagSource;
}

// The Downloaded and Results tabs share one tag vocabulary: whichever tags
// exist on downloaded items or on results/topics show up as suggestions and
// filter options in both tabs. Each getter is optional and defensively
// guarded so callers (including route tests that construct a minimal app
// stub with only one store) don't need to provide both.
export function getKnownTags(app: KnownTagsApp): Tag[] {
  const lists: Tag[][] = [];
  if (typeof app.getDownloadedStore === "function") lists.push(app.getDownloadedStore().getAllTags());
  if (typeof app.getTopicStore === "function") lists.push(app.getTopicStore().getAllTags());
  return mergeTagLists(...lists);
}
