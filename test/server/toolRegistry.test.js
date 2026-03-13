import { ToolRegistry } from "../../src/server/toolRegistry.js";

describe("ToolRegistry", () => {
  it("rejects duplicate tool names", () => {
    const registry = new ToolRegistry();
    const definition = {
      name: "sample_tool",
      description: "Sample",
      handler: async () => ({ ok: true })
    };
    registry.registerTool(definition);

    expect(() => {
      registry.registerTool({
        ...definition
      });
    }).toThrow(/Duplicate tool name registration is not allowed/);
  });

  it("rejects invalid tool definitions", () => {
    const registry = new ToolRegistry();

    expect(() => registry.registerTool(null)).toThrow(/Tool definition must be an object/);
    expect(() => registry.registerTool({})).toThrow(/must include a non-empty name/);
    expect(() => registry.registerTool({ name: "without_handler" })).toThrow(/must include a handler function/);
  });

  it("registers tools and exposes handlers to server", async () => {
    const registry = new ToolRegistry();
    const calls = [];
    const telemetryCalls = [];
    const fakeServer = {
      registerTool(name, meta, handler) {
        calls.push({ name, meta, handler });
      }
    };

    registry.registerMany([
      {
        name: "tool_a",
        description: "A",
        handler: async () => ({ ok: true })
      },
      {
        name: "tool_b",
        description: "B",
        handler: async (args) => ({ echo: args.value ?? null })
      }
    ]);

    registry.applyToServer(fakeServer, {
      rootDir: ".",
      telemetry: {
        nextInvocationId(toolName) {
          return `${toolName}-0001`;
        },
        async recordToolExecution(payload) {
          telemetryCalls.push(payload);
        }
      }
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((item) => item.name)).toEqual(["tool_a", "tool_b"]);

    const response = await calls[1].handler(
      {
        value: "x"
      },
      {}
    );
    expect(response.content[0].text).toContain("\"echo\": \"x\"");
    expect(telemetryCalls[0]).toMatchObject({
      invocationId: "tool_b-0001",
      toolName: "tool_b",
      status: "success"
    });
  });

  it("records telemetry for tool failures", async () => {
    const registry = new ToolRegistry();
    const calls = [];
    const telemetryCalls = [];
    const fakeServer = {
      registerTool(name, meta, handler) {
        calls.push({ name, meta, handler });
      }
    };

    registry.registerTool({
      name: "tool_fail",
      description: "Fails",
      handler: async () => {
        throw new Error("boom");
      }
    });

    registry.applyToServer(fakeServer, {
      rootDir: ".",
      telemetry: {
        nextInvocationId(toolName) {
          return `${toolName}-0001`;
        },
        async recordToolExecution(payload) {
          telemetryCalls.push(payload);
        }
      }
    });

    const response = await calls[0].handler({}, {});

    expect(response.isError).toBe(true);
    expect(telemetryCalls[0]).toMatchObject({
      invocationId: "tool_fail-0001",
      toolName: "tool_fail",
      status: "error",
      error: {
        code: "UNEXPECTED_ERROR",
        message: "boom"
      }
    });
  });
});
