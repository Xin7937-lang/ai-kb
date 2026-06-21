// Typed errors thrown by the AI provider layer. Callers (API routes, S8
// summarize handler) catch by name to map to HTTP status / surface messages.

export class NoSuchModelError extends Error {
  readonly modelConfigId: string;

  constructor(modelConfigId: string) {
    super(`No model configuration found with id: ${modelConfigId}`);
    this.name = 'NoSuchModelError';
    this.modelConfigId = modelConfigId;
  }
}

export class NoDefaultModelError extends Error {
  constructor() {
    super('No default model configuration is set');
    this.name = 'NoDefaultModelError';
  }
}

export class NoDefaultEmbeddingModelError extends Error {
  constructor() {
    super('No default embedding model configuration is set');
    this.name = 'NoDefaultEmbeddingModelError';
  }
}
