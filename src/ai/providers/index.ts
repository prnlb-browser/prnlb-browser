import type { Config } from "../../core/types.js";
import type { AiProviderClient } from "./types.js";
import { OllamaClient } from "./ollama.js";
import { OpenRouterClient } from "./openrouter.js";

export function getTextClient(config: Config): AiProviderClient {
  return config.ai.provider === "ollama"
    ? new OllamaClient(config.ai.ollama.baseUrl, config.ai.ollama.textModel)
    : new OpenRouterClient(config.ai.openrouter.apiKey, config.ai.openrouter.textModel);
}

export function getVisionClient(config: Config): AiProviderClient {
  return config.ai.provider === "ollama"
    ? new OllamaClient(config.ai.ollama.baseUrl, config.ai.ollama.visionModel)
    : new OpenRouterClient(config.ai.openrouter.apiKey, config.ai.openrouter.visionModel);
}
