export interface JsonCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  /** JPEG bytes, already resized. Omitted for text-only calls. */
  images?: Buffer[];
  /** JSON Schema the response must satisfy. */
  schema: object;
}

export interface AiProviderClient {
  completeJson<T>(request: JsonCompletionRequest): Promise<T>;
}
