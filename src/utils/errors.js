export class ToolError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ToolError";
    // Stable code for clients to branch logic without parsing free text.
    this.code = options.code ?? "TOOL_ERROR";
    this.details = options.details ?? null;
  }
}

export function normalizeError(error) {
  // Keep ToolError untouched so domain-specific codes survive.
  if (error instanceof ToolError) {
    return error;
  }

  if (error instanceof Error) {
    return new ToolError(error.message, {
      code: "UNEXPECTED_ERROR"
    });
  }

  return new ToolError(String(error), {
    code: "UNEXPECTED_ERROR"
  });
}
