import type { ActressLookupProvider } from "./types.js";
import { boobpediaProvider } from "./boobpedia.js";
import { iafdProvider } from "./iafd.js";

// Registry of external actress-data sources. Add new providers here to
// extend support beyond Boobpedia.
const providers: ActressLookupProvider[] = [boobpediaProvider, iafdProvider];

export function getActressLookupProviders(): ActressLookupProvider[] {
  return providers;
}

export function getActressLookupProvider(id: string): ActressLookupProvider | undefined {
  return providers.find((p) => p.id === id);
}
