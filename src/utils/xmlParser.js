import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ToolError } from "./errors.js";

const EVENT_ATTRIBUTES = new Set([
  "press",
  "change",
  "liveChange",
  "select",
  "selectionChange",
  "itemPress",
  "search",
  "submit",
  "confirm",
  "cancel",
  "close",
  "open",
  "navButtonPress",
  "detailPress",
  "delete",
  "updateFinished",
  "suggest",
  "suggestionItemSelected",
  "rowSelectionChange",
  "cellClick",
  "beforeOpen",
  "afterOpen",
  "beforeClose",
  "afterClose",
  "routeMatched",
  "patternMatched"
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  trimValues: false,
  parseTagValue: false
});

export function analyzeUi5Xml(code) {
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new ToolError("XML content must be a non-empty string.", {
      code: "INVALID_XML_INPUT"
    });
  }

  const validation = XMLValidator.validate(code);
  if (validation !== true) {
    const detail = validation?.err ?? {};
    throw new ToolError(`Invalid UI5 XML: ${detail.msg ?? "Unknown parse error."}`, {
      code: "UI5_XML_PARSE_ERROR",
      details: {
        line: detail.line ?? null,
        col: detail.col ?? null
      }
    });
  }

  let parsed;
  try {
    parsed = parser.parse(code);
  } catch (error) {
    throw new ToolError(`Unable to parse UI5 XML: ${error.message}`, {
      code: "UI5_XML_PARSE_ERROR"
    });
  }

  const rootEntry = findRootEntry(parsed);
  if (!rootEntry) {
    throw new ToolError("Unable to detect XML root element.", {
      code: "UI5_XML_ROOT_NOT_FOUND"
    });
  }

  const [rootTag, rootNode] = rootEntry;
  const namespaces = {};
  const controls = [];
  const bindings = [];
  const events = [];
  const models = new Set();

  walkElement(rootTag, rootNode, rootTag);

  return {
    documentType: detectDocumentType(rootTag),
    rootTag,
    namespaces,
    controls,
    bindings,
    events,
    models: Array.from(models)
  };

  function walkElement(tagName, node, currentPath) {
    if (!node || typeof node !== "object") {
      return;
    }

    const attributes = extractAttributes(node);
    registerNamespaces(attributes, namespaces);
    const { prefix, localName } = splitTag(tagName);
    controls.push({
      tag: tagName,
      localName,
      namespacePrefix: prefix,
      path: currentPath
    });

    for (const [attrName, rawValue] of Object.entries(attributes)) {
      if (typeof rawValue !== "string") {
        continue;
      }

      const bindingExpressions = extractBindingExpressions(rawValue);
      for (const expression of bindingExpressions) {
        const parsedBinding = parseBindingExpression(expression);
        bindings.push({
          path: currentPath,
          tag: tagName,
          attribute: attrName,
          expression,
          type: parsedBinding.type,
          model: parsedBinding.model,
          bindingPath: parsedBinding.bindingPath
        });
        if (parsedBinding.model) {
          models.add(parsedBinding.model);
        }
      }

      if (isEventAttribute(attrName, rawValue, bindingExpressions.length > 0)) {
        events.push({
          path: currentPath,
          tag: tagName,
          event: attrName,
          handler: rawValue.trim()
        });
      }
    }

    for (const [childTag, childValue] of Object.entries(node)) {
      if (isAttributeKey(childTag) || childTag === "#text" || childTag === "#cdata-section") {
        continue;
      }
      for (const childNode of normalizeNodeCollection(childValue)) {
        walkElement(childTag, childNode, `${currentPath}/${childTag}`);
      }
    }
  }
}

function findRootEntry(parsedXml) {
  if (!parsedXml || typeof parsedXml !== "object") {
    return null;
  }

  for (const [key, value] of Object.entries(parsedXml)) {
    if (key === "?xml" || isAttributeKey(key)) {
      continue;
    }
    return [key, value];
  }

  return null;
}

function extractAttributes(node) {
  const attributes = {};
  for (const [key, value] of Object.entries(node)) {
    if (isAttributeKey(key)) {
      attributes[key.slice(2)] = value;
    }
  }
  return attributes;
}

function registerNamespaces(attributes, namespaceMap) {
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== "string") {
      continue;
    }
    if (name === "xmlns") {
      namespaceMap.default = value;
      continue;
    }
    if (name.startsWith("xmlns:")) {
      const prefix = name.slice("xmlns:".length);
      if (prefix) {
        namespaceMap[prefix] = value;
      }
    }
  }
}

function splitTag(tagName) {
  const separatorIndex = tagName.indexOf(":");
  if (separatorIndex < 0) {
    return { prefix: "default", localName: tagName };
  }

  return {
    prefix: tagName.slice(0, separatorIndex),
    localName: tagName.slice(separatorIndex + 1)
  };
}

function extractBindingExpressions(value) {
  const expressions = [];
  let startIndex = -1;
  let depth = 0;

  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];
    if (character === "{") {
      if (depth === 0) {
        startIndex = i;
      }
      depth += 1;
      continue;
    }

    if (character === "}") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        expressions.push(value.slice(startIndex, i + 1));
        startIndex = -1;
      }
    }
  }

  return expressions;
}

function parseBindingExpression(expression) {
  const content = expression.slice(1, -1).trim();
  if (content.startsWith("=") || content.startsWith(":=")) {
    return {
      type: "expression",
      model: null,
      bindingPath: null
    };
  }

  const objectPathMatch = content.match(/path\s*:\s*["']([^"']+)["']/);
  if (objectPathMatch) {
    return parseSimpleBindingReference(objectPathMatch[1], "complex");
  }

  return parseSimpleBindingReference(content, "simple");
}

function parseSimpleBindingReference(rawReference, type) {
  const reference = rawReference.trim();
  const modelMatch = reference.match(/^([A-Za-z_$][\w$.-]*)>(.+)$/);
  if (modelMatch) {
    return {
      type,
      model: modelMatch[1],
      bindingPath: modelMatch[2]
    };
  }

  return {
    type,
    model: null,
    bindingPath: reference
  };
}

function isEventAttribute(attributeName, attributeValue, hasBindingExpression) {
  if (hasBindingExpression) {
    return false;
  }

  if (EVENT_ATTRIBUTES.has(attributeName)) {
    return true;
  }

  const value = attributeValue.trim();
  return value.startsWith(".") || /^on[A-Z][A-Za-z0-9_]*$/.test(value);
}

function normalizeNodeCollection(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return [value];
}

function isAttributeKey(key) {
  return key.startsWith("@_");
}

function detectDocumentType(rootTag) {
  const { localName } = splitTag(rootTag);
  if (localName === "View" || localName === "XMLView") {
    return "XMLView";
  }
  if (localName === "FragmentDefinition" || localName === "Fragment") {
    return "Fragment";
  }
  return "Unknown";
}
