export class ToolError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ToolError";
    this.code = options.code ?? "TOOL_ERROR";
    this.details = options.details ?? null;
  }
}

export function normalizeError(error) {
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

