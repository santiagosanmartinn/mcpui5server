import { z } from "zod";

const SAP_OFFICIAL_ALLOWED_DOMAINS = [
  "cap.cloud.sap",
  "ui5.sap.com",
  "sapui5.hana.ondemand.com",
  "help.sap.com",
  "learning.sap.com"
];

const SAP_OFFICIAL_REFERENCES = [
  {
    id: "sap-cap-cds",
    product: "cap",
    topic: "cds-modeling",
    title: "Core Data Services (CDS)",
    url: "https://cap.cloud.sap/docs/cds/",
    officialDomain: "cap.cloud.sap",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "CAP_PROJECT_MISSING_CDS_DEPENDENCY",
      "CAP_ENTITY_KEY_MISSING"
    ]
  },
  {
    id: "sap-cap-common-aspects",
    product: "cap",
    topic: "cds-modeling",
    title: "Common Types and Aspects",
    url: "https://cap.cloud.sap/docs/cds/common",
    officialDomain: "cap.cloud.sap",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "CAP_ENTITY_KEY_MISSING"
    ]
  },
  {
    id: "sap-cap-authorization",
    product: "cap",
    topic: "security",
    title: "CAP-level Authorization",
    url: "https://cap.cloud.sap/docs/guides/security/authorization",
    officialDomain: "cap.cloud.sap",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "CAP_SERVICE_AUTH_MISSING",
      "CAP_SECRET_FILE_CONTAINS_CREDENTIAL"
    ]
  },
  {
    id: "sap-cap-cds-test",
    product: "cap",
    topic: "testing",
    title: "Testing with cds.test",
    url: "https://cap.cloud.sap/docs/node.js/cds-test",
    officialDomain: "cap.cloud.sap",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "CAP_TEST_SCRIPT_MISSING"
    ]
  },
  {
    id: "sap-cap-cds-facade",
    product: "cap",
    topic: "nodejs-runtime",
    title: "The cds Facade Object",
    url: "https://cap.cloud.sap/docs/node.js/cds-facade",
    officialDomain: "cap.cloud.sap",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "CAP_HANDLER_DYNAMIC_SQL",
      "CAP_HANDLER_UNBOUNDED_READ",
      "CAP_HANDLER_MUTATES_REQ_DATA"
    ]
  },
  {
    id: "sap-cap-cds-cli",
    product: "cap",
    topic: "tooling",
    title: "CDS Command Line Interface (CLI)",
    url: "https://cap.cloud.sap/docs/tools/cds-cli",
    officialDomain: "cap.cloud.sap",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "CAP_PROJECT_MISSING_CDS_DEPENDENCY"
    ]
  },
  {
    id: "sap-cap-hybrid-testing",
    product: "cap",
    topic: "deployment",
    title: "Hybrid Testing",
    url: "https://cap.cloud.sap/docs/tools/cds-bind",
    officialDomain: "cap.cloud.sap",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "CAP_HANA_DEPLOYMENT_DESCRIPTOR_MISSING"
    ]
  },
  {
    id: "sapui5-security",
    product: "ui5",
    topic: "security",
    title: "Securing Apps",
    url: "https://ui5.sap.com/#/topic/91f3d8706f4d1014b6dd926db0e91070",
    officialDomain: "ui5.sap.com",
    lastReviewed: "2026-05-13",
    usedByRules: [
      "UI5_SECURITY"
    ]
  }
];

const productSchema = z.enum(["all", "cap", "ui5"]);

const inputSchema = z.object({
  product: productSchema.optional(),
  topic: z.string().min(1).optional(),
  rule: z.string().min(1).optional(),
  includeValidation: z.boolean().optional()
}).strict();

const referenceSchema = z.object({
  id: z.string(),
  product: z.enum(["cap", "ui5"]),
  topic: z.string(),
  title: z.string(),
  url: z.string().url(),
  officialDomain: z.string(),
  lastReviewed: z.string(),
  usedByRules: z.array(z.string())
});

const outputSchema = z.object({
  generatedAt: z.string(),
  filters: z.object({
    product: productSchema,
    topic: z.string().nullable(),
    rule: z.string().nullable()
  }),
  policy: z.object({
    officialOnly: z.boolean(),
    allowedDomains: z.array(z.string()),
    freshness: z.object({
      reviewedAfter: z.string(),
      staleAfterDays: z.number().int().positive()
    })
  }),
  summary: z.object({
    references: z.number().int().nonnegative(),
    products: z.array(z.string()),
    topics: z.array(z.string()),
    validationExecuted: z.boolean(),
    invalidReferences: z.number().int().nonnegative(),
    staleReferences: z.number().int().nonnegative()
  }),
  references: z.array(referenceSchema),
  validation: z.object({
    executed: z.boolean(),
    valid: z.boolean(),
    issues: z.array(z.object({
      id: z.string(),
      severity: z.enum(["error", "warn"]),
      message: z.string()
    }))
  })
});

export const sapOfficialDocumentationCatalogTool = {
  name: "sap_official_documentation_catalog",
  description: "Return the curated official SAP documentation catalog used to ground MCP validations and agent guidance.",
  contractVersion: "1.0.0",
  inputSchema,
  outputSchema,
  async handler(args) {
    const { product, topic, rule, includeValidation } = inputSchema.parse(args);
    const selectedProduct = product ?? "all";
    const references = SAP_OFFICIAL_REFERENCES
      .filter((reference) => selectedProduct === "all" || reference.product === selectedProduct)
      .filter((reference) => !topic || reference.topic === topic)
      .filter((reference) => !rule || reference.usedByRules.includes(rule))
      .map(cloneReference);
    const validation = includeValidation === false
      ? {
          executed: false,
          valid: true,
          issues: []
        }
      : validateSapOfficialReferences(references);

    return outputSchema.parse({
      generatedAt: new Date().toISOString(),
      filters: {
        product: selectedProduct,
        topic: topic ?? null,
        rule: rule ?? null
      },
      policy: {
        officialOnly: true,
        allowedDomains: [...SAP_OFFICIAL_ALLOWED_DOMAINS],
        freshness: {
          reviewedAfter: "2026-01-01",
          staleAfterDays: 180
        }
      },
      summary: {
        references: references.length,
        products: uniqueSorted(references.map((reference) => reference.product)),
        topics: uniqueSorted(references.map((reference) => reference.topic)),
        validationExecuted: validation.executed,
        invalidReferences: validation.issues.filter((issue) => issue.severity === "error").length,
        staleReferences: validation.issues.filter((issue) => issue.id.startsWith("stale:")).length
      },
      references,
      validation
    });
  }
};

export function getSapOfficialRefsForRule(rule) {
  return SAP_OFFICIAL_REFERENCES
    .filter((reference) => reference.usedByRules.includes(rule))
    .map(cloneReference);
}

export function validateSapOfficialReferences(references = SAP_OFFICIAL_REFERENCES) {
  const issues = [];
  for (const reference of references) {
    const parsedUrl = safeUrl(reference.url);
    if (!parsedUrl || parsedUrl.protocol !== "https:") {
      issues.push({
        id: `url:${reference.id}`,
        severity: "error",
        message: `Reference ${reference.id} must use a valid HTTPS URL.`
      });
      continue;
    }
    if (!SAP_OFFICIAL_ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
      issues.push({
        id: `domain:${reference.id}`,
        severity: "error",
        message: `Reference ${reference.id} points to non-approved domain ${parsedUrl.hostname}.`
      });
    }
    if (isStale(reference.lastReviewed)) {
      issues.push({
        id: `stale:${reference.id}`,
        severity: "warn",
        message: `Reference ${reference.id} has not been reviewed in the last 180 days.`
      });
    }
  }

  return {
    executed: true,
    valid: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

function cloneReference(reference) {
  return {
    ...reference,
    usedByRules: [...reference.usedByRules]
  };
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isStale(lastReviewed) {
  const reviewedAt = Date.parse(lastReviewed);
  if (!Number.isFinite(reviewedAt)) {
    return true;
  }
  return Date.now() - reviewedAt > 180 * 24 * 60 * 60 * 1000;
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
