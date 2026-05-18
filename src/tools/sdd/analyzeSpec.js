import { z } from "zod";
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_SPEC_ROOT,
  analyzeTextCorpus,
  buildSourceCoverage,
  loadSddDocuments,
  normalizePath,
  sddAnalysisSchema
} from "./common.js";

const inputSchema = z.object({
  sourcePaths: z.array(z.string().min(1)).max(100).optional(),
  specRoot: z.string().min(1).optional(),
  includeImages: z.boolean().optional(),
  maxChars: z.number().int().min(1000).max(1000000).optional(),
  language: z.enum(["es", "en"]).optional()
}).strict();

export const analyzeSddSpecTool = {
  name: "analyze_sdd_spec",
  description: "Analyze SDD functional/technical specs from Markdown, text, PDF, DOCX, and visual references into traceable requirements.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema: sddAnalysisSchema,
  async handler(args, { context }) {
    const { sourcePaths, specRoot, includeImages, maxChars } = inputSchema.parse(args);
    const loaded = await loadSddDocuments({
      root: context.rootDir,
      specRoot: normalizePath(specRoot ?? DEFAULT_SPEC_ROOT),
      sourcePaths,
      includeImages: includeImages ?? true,
      maxChars: maxChars ?? DEFAULT_MAX_CHARS
    });
    const analysis = analyzeTextCorpus({
      documents: loaded.documents,
      visualEvidence: loaded.visualEvidence
    });
    const traceItems = [
      ...analysis.requirements,
      ...analysis.actors,
      ...analysis.businessRules,
      ...analysis.screens,
      ...analysis.entityCandidates,
      ...analysis.risks,
      ...analysis.ambiguities
    ];

    return sddAnalysisSchema.parse({
      generatedAt: new Date().toISOString(),
      source: {
        specRoot: loaded.specRoot,
        sourcePaths: loaded.sourcePaths,
        includeImages: includeImages ?? true,
        maxChars: maxChars ?? DEFAULT_MAX_CHARS
      },
      documents: loaded.documents.map((document) => ({
        path: document.path,
        type: document.type,
        title: document.title,
        chars: document.chars,
        truncated: document.truncated,
        extractionStatus: document.extractionStatus,
        error: document.error
      })),
      visualEvidence: loaded.visualEvidence,
      ...analysis,
      traceability: {
        traceIds: traceItems.map((item) => item.id).sort(),
        sourceCoverage: buildSourceCoverage(traceItems)
      }
    });
  }
};
