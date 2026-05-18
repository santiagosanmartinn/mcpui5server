import path from "node:path";
import { promises as fs } from "node:fs";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { z } from "zod";
import { ToolError } from "../../utils/errors.js";
import { fileExists, isIgnoredWorkspaceDirectory, readTextFile, resolveWorkspacePath } from "../../utils/fileSystem.js";

export const SDD_SUPPORTED_DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf", ".docx"]);
export const SDD_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
export const SDD_IGNORED_DIRS = new Set(["node_modules", ".git", ".mcp-backups", ".mcp-cache", "dist", "coverage", "gen"]);
export const DEFAULT_SPEC_ROOT = ".";
export const DEFAULT_MAX_CHARS = 120000;

export const traceSchema = z.object({
  id: z.string(),
  sourcePath: z.string(),
  line: z.number().int().positive().nullable(),
  text: z.string()
});

export const requirementSchema = traceSchema.extend({
  type: z.enum(["functional", "non_functional"]),
  title: z.string(),
  confidence: z.number().min(0).max(1)
});

export const screenSchema = traceSchema.extend({
  name: z.string(),
  flow: z.string().nullable(),
  dataHints: z.array(z.string()),
  visualEvidence: z.array(z.string())
});

export const entitySchema = traceSchema.extend({
  name: z.string(),
  attributes: z.array(z.string()),
  operations: z.array(z.string())
});

export const riskSchema = traceSchema.extend({
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().nullable()
});

export const ambiguitySchema = traceSchema.extend({
  reason: z.string()
});

export const sddAnalysisSchema = z.object({
  generatedAt: z.string(),
  source: z.object({
    specRoot: z.string(),
    sourcePaths: z.array(z.string()),
    includeImages: z.boolean(),
    maxChars: z.number().int().positive()
  }),
  documents: z.array(z.object({
    path: z.string(),
    type: z.enum(["markdown", "text", "pdf", "docx"]),
    title: z.string().nullable(),
    chars: z.number().int().nonnegative(),
    truncated: z.boolean(),
    extractionStatus: z.enum(["ok", "partial", "failed"]),
    error: z.string().nullable()
  })),
  visualEvidence: z.array(z.object({
    path: z.string(),
    type: z.enum(["png", "jpg", "jpeg", "gif", "webp", "svg"]),
    relatedScreen: z.string().nullable()
  })),
  requirements: z.array(requirementSchema),
  actors: z.array(traceSchema.extend({ name: z.string() })),
  businessRules: z.array(traceSchema),
  screens: z.array(screenSchema),
  entityCandidates: z.array(entitySchema),
  risks: z.array(riskSchema),
  ambiguities: z.array(ambiguitySchema),
  traceability: z.object({
    traceIds: z.array(z.string()),
    sourceCoverage: z.array(z.object({
      sourcePath: z.string(),
      traceIds: z.array(z.string())
    }))
  })
});

export const uiRecommendationSchema = z.enum(["fiori_elements", "ui5_freestyle"]);

export const backlogTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["cap_model", "cap_service", "cap_handler", "ui5_screen", "test", "documentation", "quality"]),
  priority: z.enum(["high", "medium", "low"]),
  traceIds: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  recommendedChecks: z.array(z.string()),
  contextHints: z.array(z.string())
});

export const backlogSchema = z.object({
  generatedAt: z.string(),
  mode: z.literal("mixed"),
  summary: z.object({
    epics: z.number().int().nonnegative(),
    stories: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    entities: z.number().int().nonnegative(),
    services: z.number().int().nonnegative(),
    uiScreens: z.number().int().nonnegative()
  }),
  epics: z.array(z.object({
    id: z.string(),
    title: z.string(),
    traceIds: z.array(z.string())
  })),
  stories: z.array(z.object({
    id: z.string(),
    title: z.string(),
    traceIds: z.array(z.string()),
    acceptanceCriteria: z.array(z.string())
  })),
  tasks: z.array(backlogTaskSchema),
  cap: z.object({
    entities: z.array(z.object({
      name: z.string(),
      attributes: z.array(z.string()),
      operations: z.array(z.string()),
      traceIds: z.array(z.string())
    })),
    services: z.array(z.object({
      name: z.string(),
      entity: z.string(),
      actions: z.array(z.string()),
      traceIds: z.array(z.string())
    }))
  }),
  ui: z.object({
    screens: z.array(z.object({
      name: z.string(),
      recommendation: uiRecommendationSchema,
      rationale: z.string(),
      flow: z.string().nullable(),
      dataHints: z.array(z.string()),
      visualEvidence: z.array(z.string()),
      traceIds: z.array(z.string())
    }))
  }),
  dependencies: z.array(z.object({
    from: z.string(),
    to: z.string(),
    reason: z.string()
  })),
  traceMatrix: z.array(z.object({
    traceId: z.string(),
    stories: z.array(z.string()),
    tasks: z.array(z.string()),
    entities: z.array(z.string()),
    screens: z.array(z.string())
  }))
});

export async function loadSddDocuments(options) {
  const {
    root,
    specRoot = DEFAULT_SPEC_ROOT,
    sourcePaths,
    includeImages = true,
    maxChars = DEFAULT_MAX_CHARS
  } = options;
  const normalizedSpecRoot = normalizePath(specRoot);
  const paths = sourcePaths?.length
    ? sourcePaths.map(normalizePath)
    : await discoverSddFiles({
        root,
        specRoot: normalizedSpecRoot,
        includeImages
      });
  const docPaths = paths.filter((item) => SDD_SUPPORTED_DOC_EXTENSIONS.has(path.extname(item).toLowerCase()));
  const imagePaths = includeImages
    ? paths.filter((item) => SDD_IMAGE_EXTENSIONS.has(path.extname(item).toLowerCase()))
    : [];

  const documents = [];
  let remainingChars = maxChars;
  for (const sourcePath of docPaths) {
    const extraction = await extractDocumentText(sourcePath, root);
    const text = extraction.text.slice(0, Math.max(0, remainingChars));
    const truncated = extraction.text.length > text.length || remainingChars <= 0;
    remainingChars = Math.max(0, remainingChars - text.length);
    documents.push({
      path: sourcePath,
      type: resolveDocumentType(sourcePath),
      title: inferTitle(text, sourcePath),
      text,
      chars: text.length,
      truncated,
      extractionStatus: extraction.status,
      error: extraction.error
    });
  }

  return {
    specRoot: normalizedSpecRoot,
    sourcePaths: paths,
    documents,
    visualEvidence: imagePaths.map((imagePath) => ({
      path: imagePath,
      type: path.extname(imagePath).slice(1).toLowerCase(),
      relatedScreen: inferScreenFromPath(imagePath)
    }))
  };
}

export async function discoverSddFiles(options) {
  const { root, specRoot, includeImages } = options;
  const absoluteRoot = resolveWorkspacePath(specRoot, root);
  const resolvedRoot = path.resolve(root);
  const files = [];
  await walk(absoluteRoot);
  return files.sort();

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(resolvedRoot, absolutePath).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (isIgnoredWorkspaceDirectory(entry.name, relativePath, SDD_IGNORED_DIRS)) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (SDD_SUPPORTED_DOC_EXTENSIONS.has(extension) || (includeImages && SDD_IMAGE_EXTENSIONS.has(extension))) {
        files.push(relativePath);
      }
    }
  }
}

export async function extractDocumentText(sourcePath, root) {
  if (!await fileExists(sourcePath, root)) {
    throw new ToolError(`Spec source not found: ${sourcePath}`, {
      code: "SDD_SPEC_SOURCE_NOT_FOUND",
      details: { sourcePath }
    });
  }
  const extension = path.extname(sourcePath).toLowerCase();
  try {
    if (extension === ".md" || extension === ".markdown" || extension === ".txt") {
      return {
        text: await readTextFile(sourcePath, root),
        status: "ok",
        error: null
      };
    }
    const absolutePath = resolveWorkspacePath(sourcePath, root);
    const buffer = await fs.readFile(absolutePath);
    if (extension === ".docx") {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        status: result.messages.length > 0 ? "partial" : "ok",
        error: result.messages.map((message) => message.message).join("; ") || null
      };
    }
    if (extension === ".pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return {
          text: result.text,
          status: "ok",
          error: null
        };
      } finally {
        await parser.destroy();
      }
    }
  } catch (error) {
    return {
      text: "",
      status: "failed",
      error: error.message
    };
  }
  return {
    text: "",
    status: "failed",
    error: `Unsupported spec extension: ${extension}`
  };
}

export function analyzeTextCorpus(input) {
  const { documents, visualEvidence } = input;
  const requirements = [];
  const actors = new Map();
  const businessRules = [];
  const screens = new Map();
  const entities = new Map();
  const risks = [];
  const ambiguities = [];
  let traceCounter = 1;

  for (const document of documents) {
    const lines = document.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const line = cleanupLine(rawLine);
      if (!line) {
        continue;
      }
      const lineNumber = index + 1;
      const lower = line.toLowerCase();

      if (isRequirementLine(line)) {
        const id = nextTraceId(traceCounter++);
        requirements.push({
          id,
          type: isNonFunctionalLine(lower) ? "non_functional" : "functional",
          title: summarizeTitle(line),
          text: line,
          sourcePath: document.path,
          line: lineNumber,
          confidence: isExplicitRequirement(line) ? 0.9 : 0.68
        });
      }
      for (const actor of extractNamedList(line, /(?:actor|usuario|rol|perfil|persona)\s*[:-]\s*(.+)$/i)) {
        actors.set(actor.toLowerCase(), {
          id: nextTraceId(traceCounter++),
          name: actor,
          text: line,
          sourcePath: document.path,
          line: lineNumber
        });
      }
      if (/(regla de negocio|business rule|debe cumplirse|no se permite|validar que|solo si)/i.test(line)) {
        businessRules.push({
          id: nextTraceId(traceCounter++),
          text: line,
          sourcePath: document.path,
          line: lineNumber
        });
      }
      for (const screenName of extractScreenNames(line)) {
        const key = screenName.toLowerCase();
        const current = screens.get(key) ?? {
          id: nextTraceId(traceCounter++),
          name: screenName,
          text: line,
          sourcePath: document.path,
          line: lineNumber,
          flow: inferFlow(line),
          dataHints: [],
          visualEvidence: []
        };
        current.flow = current.flow ?? inferFlow(line);
        current.dataHints = unique([...current.dataHints, ...extractDataHints(line)]);
        screens.set(key, current);
      }
      for (const entity of extractEntityCandidates(line)) {
        const key = entity.name.toLowerCase();
        const current = entities.get(key) ?? {
          id: nextTraceId(traceCounter++),
          name: entity.name,
          text: line,
          sourcePath: document.path,
          line: lineNumber,
          attributes: [],
          operations: []
        };
        current.attributes = unique([...current.attributes, ...entity.attributes]);
        current.operations = unique([...current.operations, ...entity.operations]);
        entities.set(key, current);
      }
      if (/(riesgo|risk|bloqueante|dependencia externa|incertidumbre|pendiente)/i.test(line)) {
        risks.push({
          id: nextTraceId(traceCounter++),
          severity: /(alto|high|bloqueante|critico|crítico)/i.test(line) ? "high" : /(medio|medium)/i.test(line) ? "medium" : "low",
          mitigation: /(mitig|resolver|plan|accion|acción)/i.test(line) ? line : null,
          text: line,
          sourcePath: document.path,
          line: lineNumber
        });
      }
      if (/(por definir|tbd|pendiente de definir|no queda claro|confirmar|depende de)/i.test(line)) {
        ambiguities.push({
          id: nextTraceId(traceCounter++),
          reason: "Ambiguous or unresolved statement detected.",
          text: line,
          sourcePath: document.path,
          line: lineNumber
        });
      }
    }
  }

  for (const visual of visualEvidence) {
    if (!visual.relatedScreen) {
      continue;
    }
    const key = visual.relatedScreen.toLowerCase();
    const current = screens.get(key) ?? {
      id: nextTraceId(traceCounter++),
      name: visual.relatedScreen,
      text: `Visual evidence: ${visual.path}`,
      sourcePath: visual.path,
      line: null,
      flow: null,
      dataHints: [],
      visualEvidence: []
    };
    current.visualEvidence = unique([...current.visualEvidence, visual.path]);
    screens.set(key, current);
  }

  return {
    requirements: ensureRequirementFallback(requirements, documents, () => nextTraceId(traceCounter++)),
    actors: Array.from(actors.values()),
    businessRules,
    screens: Array.from(screens.values()),
    entityCandidates: Array.from(entities.values()),
    risks,
    ambiguities
  };
}

export function buildSourceCoverage(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.sourcePath) {
      continue;
    }
    const current = map.get(item.sourcePath) ?? new Set();
    current.add(item.id);
    map.set(item.sourcePath, current);
  }
  return Array.from(map.entries())
    .map(([sourcePath, ids]) => ({
      sourcePath,
      traceIds: Array.from(ids).sort()
    }))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

export function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

export function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "item";
}

export function toPascalCase(value) {
  const normalized = slugify(value);
  return normalized
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "Item";
}

export function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? "").length / 4));
}

function resolveDocumentType(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === ".md" || extension === ".markdown") {
    return "markdown";
  }
  if (extension === ".pdf") {
    return "pdf";
  }
  if (extension === ".docx") {
    return "docx";
  }
  return "text";
}

function inferTitle(text, sourcePath) {
  const heading = text.split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  if (heading) {
    return heading.replace(/^#\s+/, "").trim();
  }
  return path.basename(sourcePath, path.extname(sourcePath));
}

function inferScreenFromPath(sourcePath) {
  const baseName = path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, " ").trim();
  return baseName ? toTitleCase(baseName) : null;
}

function cleanupLine(line) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function isRequirementLine(line) {
  return /^(REQ[-_\s]?\d+|RF[-_\s]?\d+|RNF[-_\s]?\d+)\b/i.test(line)
    || /\b(el sistema|la aplicacion|la aplicación|the system|the application)\s+(debe|shall|must|should|permitira|permitirá|allows?|will)\b/i.test(line)
    || /\b(como|as a)\s+.+\b(quiero|necesito|want|need)\b/i.test(line);
}

function isExplicitRequirement(line) {
  return /^(REQ[-_\s]?\d+|RF[-_\s]?\d+|RNF[-_\s]?\d+)\b/i.test(line);
}

function isNonFunctionalLine(lower) {
  return /(rendimiento|performance|seguridad|security|auditoria|audit|disponibilidad|availability|latencia|latency|cumplimiento|compliance|accesibilidad|accessibility)/i.test(lower);
}

function summarizeTitle(line) {
  return line
    .replace(/^(REQ[-_\s]?\d+|RF[-_\s]?\d+|RNF[-_\s]?\d+)\s*[:-]?\s*/i, "")
    .slice(0, 96)
    .trim();
}

function extractNamedList(line, regex) {
  const match = line.match(regex);
  if (!match) {
    return [];
  }
  return match[1]
    .split(/[,;|]/)
    .map((item) => toTitleCase(item.trim()))
    .filter(Boolean);
}

function extractScreenNames(line) {
  const names = [];
  const patterns = [
    /(?:pantalla|screen|vista|view)\s*[:-]\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _-]+)/gi,
    /(?:pantalla|screen|vista|view)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _-]+?)(?:\s+(?:permite|muestra|debe|shall|with|con)|[.;]|$)/gi
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(line);
    while (match) {
      names.push(toTitleCase(match[1].trim()));
      match = pattern.exec(line);
    }
  }
  return unique(names);
}

function extractEntityCandidates(line) {
  const candidates = [];
  const entityPatterns = [
    /(?:entidad|entity|objeto|object|tabla|table)\s*[:-]\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _-]+)/gi,
    /\b(?:gestionar|crear|editar|listar|consultar|aprobar|rechazar|exportar|manage|create|edit|list|approve|reject|export)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 _-]{3,40})/gi
  ];
  for (const pattern of entityPatterns) {
    let match = pattern.exec(line);
    while (match) {
      const raw = match[1].split(/\s+(?:con|with|desde|from|para|for)\s+/i)[0];
      candidates.push({
        name: singularize(toPascalCase(raw)),
        attributes: extractAttributes(line),
        operations: extractOperations(line)
      });
      match = pattern.exec(line);
    }
  }
  return candidates.filter((candidate) => candidate.name.length > 2);
}

function extractAttributes(line) {
  const match = line.match(/(?:campos|fields|atributos|attributes)\s*[:-]\s*(.+)$/i);
  if (!match) {
    return [];
  }
  return match[1]
    .split(/[,;|]/)
    .map((item) => slugify(item).replaceAll("-", "_"))
    .filter(Boolean)
    .slice(0, 12);
}

function extractOperations(line) {
  const operations = [];
  const map = [
    ["create", /(crear|alta|create|add)/i],
    ["read", /(listar|consultar|detalle|ver|read|list|search|detail)/i],
    ["update", /(editar|actualizar|update|modify)/i],
    ["delete", /(eliminar|borrar|delete|remove)/i],
    ["approve", /(aprobar|approve)/i],
    ["reject", /(rechazar|reject)/i],
    ["export", /(exportar|export)/i]
  ];
  for (const [operation, regex] of map) {
    if (regex.test(line)) {
      operations.push(operation);
    }
  }
  return operations.length ? operations : ["read"];
}

function extractDataHints(line) {
  return extractEntityCandidates(line).map((candidate) => candidate.name);
}

function inferFlow(line) {
  if (/(buscar|filtrar|search|filter)/i.test(line)) {
    return "search-filter";
  }
  if (/(crear|editar|detalle|create|edit|detail)/i.test(line)) {
    return "crud-detail";
  }
  if (/(aprobar|rechazar|workflow|approve|reject)/i.test(line)) {
    return "approval";
  }
  if (/(dashboard|grafico|gráfico|chart|kpi)/i.test(line)) {
    return "dashboard";
  }
  return null;
}

function ensureRequirementFallback(requirements, documents, nextId) {
  if (requirements.length > 0) {
    return requirements;
  }
  const fallback = [];
  for (const document of documents) {
    const firstLine = document.text.split(/\r?\n/).map(cleanupLine).find(Boolean);
    if (firstLine) {
      fallback.push({
        id: nextId(),
        type: "functional",
        title: summarizeTitle(firstLine),
        text: firstLine,
        sourcePath: document.path,
        line: 1,
        confidence: 0.45
      });
    }
  }
  return fallback;
}

function nextTraceId(counter) {
  return `REQ-${String(counter).padStart(4, "0")}`;
}

function singularize(value) {
  return value.endsWith("s") && value.length > 4 ? value.slice(0, -1) : value;
}

function toTitleCase(value) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
