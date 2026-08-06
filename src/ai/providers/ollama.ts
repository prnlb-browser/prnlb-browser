import type { AiProviderClient, JsonCompletionRequest } from "./types.js";
import { completeJsonWithRetry } from "./json-completion.js";

export class OllamaClient implements AiProviderClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  completeJson<T>(request: JsonCompletionRequest): Promise<T> {
    return completeJsonWithRetry<T>(
      () => buildMessages(request),
      (messages) => this.chat(messages, request.schema),
    );
  }

  private async chat(messages: unknown[], schema: object): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // temperature: 0 — these calls are literal extraction/classification
      // (title/screenshot analysis), not creative generation. Small models
      // in particular drop or hallucinate list items at default temperature;
      // deterministic decoding measurably improved tag-extraction accuracy
      // in testing against qwen2.5:0.5b.
      body: JSON.stringify({ model: this.model, messages, format: schema, stream: false, options: { temperature: 0 } }),
    });
    if (!res.ok) throw new Error(`Ollama request failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }
}

function buildMessages(request: JsonCompletionRequest): unknown[] {
  const userMessage: Record<string, unknown> = { role: "user", content: request.userPrompt };
  if (request.images?.length) {
    userMessage.images = request.images.map((image) => image.toString("base64"));
  }
  return [{ role: "system", content: request.systemPrompt }, userMessage];
}
