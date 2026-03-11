import { ToolError } from "./errors.js";

export function validateManifestStructure(manifest) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(manifest)) {
    errors.push("Manifest root must be an object.");
    return { valid: false, errors, warnings };
  }

  const ui5 = manifest["sap.ui5"];
  if (ui5 !== undefined && !isPlainObject(ui5)) {
    errors.push("sap.ui5 must be an object when present.");
    return { valid: false, errors, warnings };
  }

  const models = ui5?.models;
  if (models !== undefined && !isPlainObject(models)) {
    errors.push("sap.ui5.models must be an object.");
  }

  const routing = ui5?.routing;
  if (routing !== undefined && !isPlainObject(routing)) {
    errors.push("sap.ui5.routing must be an object.");
    return { valid: errors.length === 0, errors, warnings };
  }

  if (routing?.routes !== undefined && !Array.isArray(routing.routes)) {
    errors.push("sap.ui5.routing.routes must be an array.");
  }

  if (routing?.targets !== undefined && !isPlainObject(routing.targets)) {
    errors.push("sap.ui5.routing.targets must be an object.");
  }

  if (Array.isArray(routing?.routes)) {
    const routeNameSet = new Set();
    for (const route of routing.routes) {
      if (!isPlainObject(route)) {
        errors.push("Each route in sap.ui5.routing.routes must be an object.");
        continue;
      }

      if (typeof route.name !== "string" || route.name.trim().length === 0) {
        errors.push("Each route must include a non-empty string name.");
        continue;
      }

      if (routeNameSet.has(route.name)) {
        warnings.push(`Duplicate route name detected: ${route.name}`);
      }
      routeNameSet.add(route.name);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export function synchronizeManifest(manifest, changes = {}) {
  if (!isPlainObject(manifest)) {
    throw new ToolError("Manifest must be an object.", {
      code: "INVALID_MANIFEST_INPUT"
    });
  }

  const nextManifest = deepClone(manifest);
  ensureUi5Root(nextManifest);

  const summary = {
    modelsAdded: 0,
    modelsUpdated: 0,
    modelsRemoved: 0,
    routesAdded: 0,
    routesUpdated: 0,
    routesRemoved: 0,
    targetsAdded: 0,
    targetsUpdated: 0,
    targetsRemoved: 0
  };

  const ui5 = nextManifest["sap.ui5"];
  const modelChanges = changes.models ?? {};
  const routeChanges = changes.routes ?? {};
  const targetChanges = changes.targets ?? {};

  ensureModels(ui5);
  applyRecordUpsertAndRemove(
    ui5.models,
    modelChanges.upsert ?? {},
    modelChanges.remove ?? [],
    summary,
    "models"
  );

  ensureRouting(ui5);
  ensureRoutes(ui5.routing);
  applyRoutes(ui5.routing.routes, routeChanges.upsert ?? [], routeChanges.removeByName ?? [], summary);

  ensureTargets(ui5.routing);
  applyRecordUpsertAndRemove(
    ui5.routing.targets,
    targetChanges.upsert ?? {},
    targetChanges.remove ?? [],
    summary,
    "targets"
  );

  return {
    manifest: nextManifest,
    summary,
    changed: hasAnyChange(summary)
  };
}

function applyRecordUpsertAndRemove(targetRecord, upsertMap, removeKeys, summary, domain) {
  for (const [key, value] of Object.entries(upsertMap)) {
    if (!isPlainObject(targetRecord)) {
      throw new ToolError(`${domain} container must be an object.`, {
        code: "INVALID_MANIFEST_SECTION"
      });
    }

    if (!(key in targetRecord)) {
      targetRecord[key] = value;
      incrementSummary(summary, domain, "Added");
      continue;
    }

    if (!deepEqual(targetRecord[key], value)) {
      targetRecord[key] = value;
      incrementSummary(summary, domain, "Updated");
    }
  }

  for (const key of removeKeys) {
    if (key in targetRecord) {
      delete targetRecord[key];
      incrementSummary(summary, domain, "Removed");
    }
  }
}

function applyRoutes(routeList, upsertRoutes, removeByName, summary) {
  const validatedRoutes = upsertRoutes.map((route) => {
    if (!isPlainObject(route) || typeof route.name !== "string" || route.name.trim().length === 0) {
      throw new ToolError("Each upsert route must be an object with a non-empty name.", {
        code: "INVALID_ROUTE_INPUT"
      });
    }
    return route;
  });

  for (const route of validatedRoutes) {
    const existingIndex = routeList.findIndex((item) => item?.name === route.name);
    if (existingIndex < 0) {
      routeList.push(route);
      summary.routesAdded += 1;
      continue;
    }

    if (!deepEqual(routeList[existingIndex], route)) {
      routeList[existingIndex] = route;
      summary.routesUpdated += 1;
    }
  }

  for (const routeName of removeByName) {
    const existingIndex = routeList.findIndex((item) => item?.name === routeName);
    if (existingIndex >= 0) {
      routeList.splice(existingIndex, 1);
      summary.routesRemoved += 1;
    }
  }
}

function incrementSummary(summary, domain, suffix) {
  const key = `${domain}${suffix}`;
  summary[key] += 1;
}

function hasAnyChange(summary) {
  return Object.values(summary).some((count) => count > 0);
}

function ensureUi5Root(manifest) {
  if (!isPlainObject(manifest["sap.ui5"])) {
    manifest["sap.ui5"] = {};
  }
}

function ensureModels(ui5) {
  if (!isPlainObject(ui5.models)) {
    ui5.models = {};
  }
}

function ensureRouting(ui5) {
  if (!isPlainObject(ui5.routing)) {
    ui5.routing = {};
  }
}

function ensureRoutes(routing) {
  if (!Array.isArray(routing.routes)) {
    routing.routes = [];
  }
}

function ensureTargets(routing) {
  if (!isPlainObject(routing.targets)) {
    routing.targets = {};
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(left, right) {
  return stableSerialize(left) === stableSerialize(right);
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
