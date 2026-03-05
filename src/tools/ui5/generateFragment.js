import { z } from "zod";

const inputSchema = z.object({
  fragmentName: z.string().min(1),
  controls: z.array(z.string().min(1)).default([])
}).strict();

const outputSchema = z.object({
  fragmentName: z.string(),
  code: z.string()
});

export const generateUi5FragmentTool = {
  name: "generate_ui5_fragment",
  description: "Generate an XML SAPUI5 fragment skeleton with proper namespaces.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { fragmentName, controls } = inputSchema.parse(args);
    // Provide sensible defaults when no controls are requested.
    const bodyControls = controls.length > 0
      ? controls.map((control, index) => `    ${toControlLine(control, index)}`)
      : ["    <Text text=\"Sample fragment content\" />"];

    const code = [
      `<core:FragmentDefinition xmlns=\"sap.m\" xmlns:core=\"sap.ui.core\" core:require="{ formatter: '${toFormatterNamespace(fragmentName)}' }">`,
      "  <VBox>",
      ...bodyControls,
      "  </VBox>",
      "</core:FragmentDefinition>",
      ""
    ].join("\n");

    return outputSchema.parse({
      fragmentName,
      code
    });
  }
};

function toControlLine(controlName, index) {
  const cleaned = controlName.trim();
  switch (cleaned) {
    case "Button":
      return `<Button text="Action ${index + 1}" press=".onAction${index + 1}" />`;
    case "Input":
      return `<Input placeholder="Enter value" />`;
    case "Text":
      return `<Text text="Text ${index + 1}" />`;
    default:
      return `<${cleaned} />`;
  }
}

function toFormatterNamespace(fragmentName) {
  const base = fragmentName.includes(".") ? fragmentName.split(".").slice(0, -1).join(".") : fragmentName;
  return `${base}.model.formatter`;
}
