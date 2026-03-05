import { z } from "zod";

const inputSchema = z.object({
  code: z.string().min(1)
}).strict();

const outputSchema = z.object({
  refactoredCode: z.string(),
  changes: z.array(z.string())
});

export const refactorJavaScriptCodeTool = {
  name: "refactor_javascript_code",
  description: "Refactor JavaScript code using modern syntax while preserving readability.",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { code } = inputSchema.parse(args);
    const changes = [];
    let updated = code;

    const varRefactor = replaceVarDeclarations(updated);
    updated = varRefactor.code;
    if (varRefactor.count > 0) {
      changes.push(`Replaced ${varRefactor.count} var declaration(s) with let/const.`);
    }

    const thenRefactorCount = countMatches(updated, /\.then\s*\(\s*function\s*\([^)]*\)\s*{/g);
    const catchRefactorCount = countMatches(updated, /\.catch\s*\(\s*function\s*\([^)]*\)\s*{/g);
    updated = updated.replace(/\.then\s*\(\s*function\s*\(([^)]*)\)\s*{/g, ".then(($1) => {");
    updated = updated.replace(/\.catch\s*\(\s*function\s*\(([^)]*)\)\s*{/g, ".catch(($1) => {");
    if (thenRefactorCount > 0 || catchRefactorCount > 0) {
      changes.push("Converted callback-style Promise handlers to arrow function syntax.");
    }

    const callbackNestingDetected = /function\s*\([^)]*callback[^)]*\)\s*{[\s\S]*callback\s*\(/m.test(updated);
    if (callbackNestingDetected) {
      changes.push("Detected callback nesting; consider extracting async helper functions.");
    }

    const trailingWhitespaceCount = countMatches(updated, /[ \t]+$/gm);
    updated = updated.replace(/[ \t]+$/gm, "");
    if (trailingWhitespaceCount > 0) {
      changes.push(`Removed trailing whitespace from ${trailingWhitespaceCount} line(s).`);
    }

    return outputSchema.parse({
      refactoredCode: updated,
      changes
    });
  }
};

function replaceVarDeclarations(code) {
  let count = 0;
  const lines = code.split("\n");
  const updated = lines.map((line, index) => {
    const match = line.match(/^(\s*)var\s+([A-Za-z_$][\w$]*)\s*=/);
    if (!match) {
      return line;
    }

    const variable = match[2];
    const remainder = lines.slice(index + 1).join("\n");
    const isReassigned = new RegExp(`\\b${variable}\\s*=`, "m").test(remainder);
    const replacement = isReassigned ? "let" : "const";
    count += 1;
    return line.replace(/^(\s*)var\b/, `$1${replacement}`);
  });

  return {
    code: updated.join("\n"),
    count
  };
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}
