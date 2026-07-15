// A candidate page returned by a provider's search step. `title` is the
// provider-specific page identifier passed back into fetchDetails().
export interface ActressSearchMatch {
  title: string;
  url: string;
}

export interface ActressLookupDetails {
  name: string;
  otherNames: string[];
  imageUrl: string | null;
  sourceUrl: string;
}

// A third-party actress data source (Boobpedia, etc.). New sources are
// registered in registry.ts.
export interface ActressLookupProvider {
  id: string;
  label: string;
  search(query: string): Promise<ActressSearchMatch[]>;
  fetchDetails(title: string): Promise<ActressLookupDetails | null>;
}
