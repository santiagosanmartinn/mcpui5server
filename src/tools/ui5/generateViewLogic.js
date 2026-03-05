import { z } from "zod";

const inputSchema = z.object({
  viewName: z.string().min(1),
  events: z.array(z.string().min(1)).default([])
}).strict();

const outputSchema = z.object({
  viewName: z.string(),
  code: z.string()
});

export const generateUi5ViewLogicTool = {
  name: "generate_ui5_view_logic",
  description: "Generate UI5 view-controller event logic methods for XML views.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { viewName, events } = inputSchema.parse(args);
    // Event names are normalized to conventional on<Event> handler names.
    const methods = events.map((event) => sanitizeMethod(event)).filter(Boolean);
    const code = [
      `// Suggested view logic for ${viewName}`,
      ...methods.flatMap((method, index) => {
        const block = [
          "/**",
          ` * Handles ${method}.`,
          " * @param {sap.ui.base.Event} oEvent UI5 event object",
          " */",
          `${method}: function (oEvent) {`,
          "  const oSource = oEvent.getSource();",
          "  const sId = oSource.getId();",
          "  void sId;",
          "}"
        ];
        if (index < methods.length - 1) {
          block.push("");
        }
        return block;
      })
    ].join("\n");

    return outputSchema.parse({
      viewName,
      code
    });
  }
};

function sanitizeMethod(eventName) {
  const cleaned = eventName.trim().replace(/[^A-Za-z0-9_$]/g, "");
  if (!cleaned) {
    return "";
  }
  const first = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return `on${first}`;
}
