const INPUT_TAG_REGEX = /<(?:(\w+):)?Input\b([^>]*)>/g;
const INPUT_NEW_REGEX = /new\s+(?:Input|sap\.m\.Input)\s*\(([\s\S]{0,420}?)\)/gm;
const TEXT_TAG_REGEX = /<(?:(\w+):)?Text\b([^>]*)>/g;
const STANDARD_LIST_ITEM_TAG_REGEX = /<(?:(\w+):)?StandardListItem\b([^>]*)>/g;
const LABEL_TAG_REGEX = /<(?:(\w+):)?Label\b/g;
const SIMPLE_FORM_TAG_REGEX = /<(?:(\w+):)?SimpleForm\b/;
const ATTR_REGEX = /\b([A-Za-z_]\w*)\s*=\s*["']([^"']*)["']/g;

const DATE_HINT_REGEX = /\b(date|fecha|birth|dob|calendar|timestamp)\b/i;
const DATETIME_HINT_REGEX = /\b(datetime|fechahora|timestamp)\b/i;
const TIME_HINT_REGEX = /\b(time|hora|clock|schedule)\b/i;
const BOOLEAN_HINT_REGEX = /\b(is[A-Z]\w*|has[A-Z]\w*|active|enabled|disabled|flag|boolean|yesno|activo|habilitado|bloqueado)\b/i;
const LONG_TEXT_HINT_REGEX = /\b(description|descripcion|comment|comentario|notes|nota|remarks|observaciones|details|detalle|justification|motivo|message|mensaje)\b/i;
const ENUM_HINT_REGEX = /\b(status|state|type|category|priority|role|mode|kind|estado|tipo|categoria|prioridad|perfil)\b/i;
const STATUS_HINT_REGEX = /\b(status|state|estado|health|severity|criticality)\b/i;
const ID_HINT_REGEX = /(id|code|codigo|key|uuid)/i;
const TITLE_HINT_REGEX = /(name|title|nombre|descripcion|description|text|summary)/i;

const GUIDELINES = {
  semanticControls: "Use semantic controls aligned with data type to reduce custom validation and improve UX consistency.",
  booleans: "Boolean values should use dedicated toggles/selectors instead of free-text fields.",
  longText: "Long or narrative user input should use a multiline control.",
  finiteValues: "Finite sets should use selection controls instead of free text input.",
  semanticStatus: "Status information should use semantic controls with state and icon support.",
  structuredForms: "Business forms should use dedicated form layout controls for consistency and accessibility.",
  businessLists: "Business entity lists should use semantic item templates designed for enterprise readability."
};

export function recommendComponentFitFromXml(filePath, content) {
  const recommendations = [];
  let match = INPUT_TAG_REGEX.exec(content);
  while (match) {
    const attributes = match[2] ?? "";
    const attributesMap = parseXmlAttributes(attributes);
    const rule = selectInputRule({
      type: attributesMap.type ?? "",
      signalText: buildSignalText([
        attributesMap.id,
        attributesMap.name,
        attributesMap.placeholder,
        attributesMap.value
      ])
    });
    if (rule) {
      recommendations.push(toRecommendation(rule, filePath, findLineByIndex(content, match.index), "sap.m.Input"));
    }
    match = INPUT_TAG_REGEX.exec(content);
  }

  recommendations.push(...recommendStatusControlsFromXml(filePath, content));
  recommendations.push(...recommendStructuredFormFromXml(filePath, content));
  recommendations.push(...recommendListPatternsFromXml(filePath, content));
  recommendations.push(...recommendTablePatternsFromXml(filePath, content));
  return dedupeRecommendations(recommendations);
}

export function recommendComponentFitFromJavaScript(filePath, code) {
  const recommendations = [];
  let match = INPUT_NEW_REGEX.exec(code);
  while (match) {
    const snippet = match[1] ?? "";
    const rule = selectInputRule({
      type: extractJsType(snippet),
      signalText: buildSignalText([snippet])
    });
    if (rule) {
      recommendations.push(toRecommendation(rule, filePath, findLineByIndex(code, match.index), "sap.m.Input"));
    }
    match = INPUT_NEW_REGEX.exec(code);
  }
  return dedupeRecommendations(recommendations);
}

function selectInputRule(input) {
  const typeValue = String(input.type ?? "").trim().toLowerCase();
  const signal = input.signalText;

  if (typeValue === "datetime" || DATETIME_HINT_REGEX.test(signal)) {
    return {
      id: "UI5_COMP_PREFER_DATETIME_PICKER",
      suggestedComponent: "sap.m.DateTimePicker",
      reason: "Date-time fields should use DateTimePicker for correct parsing, localization and UX.",
      confidence: "high",
      guideline: GUIDELINES.semanticControls
    };
  }

  if (typeValue === "date" || DATE_HINT_REGEX.test(signal)) {
    return {
      id: "UI5_COMP_PREFER_DATE_PICKER",
      suggestedComponent: "sap.m.DatePicker",
      reason: "Date-oriented fields should use DatePicker instead of generic Input with custom validation.",
      confidence: typeValue === "date" ? "high" : "medium",
      guideline: GUIDELINES.semanticControls
    };
  }

  if (typeValue === "time" || TIME_HINT_REGEX.test(signal)) {
    return {
      id: "UI5_COMP_PREFER_TIME_PICKER",
      suggestedComponent: "sap.m.TimePicker",
      reason: "Time fields should use TimePicker for locale-aware input and validation.",
      confidence: typeValue === "time" ? "high" : "medium",
      guideline: GUIDELINES.semanticControls
    };
  }

  if (BOOLEAN_HINT_REGEX.test(signal)) {
    return {
      id: "UI5_COMP_PREFER_SWITCH_FOR_BOOLEAN",
      suggestedComponent: "sap.m.Switch",
      reason: "Boolean state should use Switch (or CheckBox) instead of free-text Input.",
      confidence: "medium",
      guideline: GUIDELINES.booleans
    };
  }

  if (LONG_TEXT_HINT_REGEX.test(signal)) {
    return {
      id: "UI5_COMP_PREFER_TEXTAREA_FOR_LONG_TEXT",
      suggestedComponent: "sap.m.TextArea",
      reason: "Long narrative input should use TextArea for readability and multiline UX.",
      confidence: "medium",
      guideline: GUIDELINES.longText
    };
  }

  if (ENUM_HINT_REGEX.test(signal)) {
    return {
      id: "UI5_COMP_PREFER_SELECT_FOR_ENUM",
      suggestedComponent: "sap.m.Select",
      reason: "Finite-value fields should use Select (or ComboBox) instead of unrestricted Input.",
      confidence: "medium",
      guideline: GUIDELINES.finiteValues
    };
  }

  return null;
}

function recommendStatusControlsFromXml(filePath, content) {
  const recommendations = [];
  let match = TEXT_TAG_REGEX.exec(content);
  while (match) {
    const attributes = match[2] ?? "";
    const attributesMap = parseXmlAttributes(attributes);
    const signalText = buildSignalText([attributesMap.id, attributesMap.text, attributesMap.tooltip]);
    if (!STATUS_HINT_REGEX.test(signalText)) {
      match = TEXT_TAG_REGEX.exec(content);
      continue;
    }

    recommendations.push(toRecommendation({
      id: "UI5_COMP_PREFER_OBJECT_STATUS",
      suggestedComponent: "sap.m.ObjectStatus",
      reason: "Status values should use ObjectStatus to expose semantic state, icon and improved readability.",
      confidence: "medium",
      guideline: GUIDELINES.semanticStatus
    }, filePath, findLineByIndex(content, match.index), "sap.m.Text"));

    match = TEXT_TAG_REGEX.exec(content);
  }
  return recommendations;
}

function recommendStructuredFormFromXml(filePath, content) {
  if (SIMPLE_FORM_TAG_REGEX.test(content)) {
    return [];
  }

  const labelCount = countMatches(content, LABEL_TAG_REGEX);
  const inputCount = countMatches(content, INPUT_TAG_REGEX);
  if (labelCount < 3 || inputCount < 3) {
    return [];
  }

  const line = findLine(content, "<Label") ?? findLine(content, "<Input");
  return [toRecommendation({
    id: "UI5_COMP_PREFER_SIMPLE_FORM_LAYOUT",
    suggestedComponent: "sap.ui.layout.form.SimpleForm",
    reason: "Multiple Label/Input pairs indicate a form scenario better handled by SimpleForm for consistent spacing and accessibility.",
    confidence: "medium",
    guideline: GUIDELINES.structuredForms
  }, filePath, line, "ad-hoc layout")];
}

function recommendListPatternsFromXml(filePath, content) {
  const recommendations = [];
  const pattern = new RegExp(STANDARD_LIST_ITEM_TAG_REGEX.source, STANDARD_LIST_ITEM_TAG_REGEX.flags);
  let match = pattern.exec(content);
  while (match) {
    const attributes = match[2] ?? "";
    const attributesMap = parseXmlAttributes(attributes);
    const hasDescription = hasValue(attributesMap.description);
    const hasInfo = hasValue(attributesMap.info) || hasValue(attributesMap.infoState);
    const signal = buildSignalText([
      attributesMap.title,
      attributesMap.description,
      attributesMap.info,
      attributesMap.infoState
    ]);
    const looksBusinessObject = hasDescription && (hasInfo || STATUS_HINT_REGEX.test(signal));
    if (looksBusinessObject) {
      recommendations.push(toRecommendation({
        id: "UI5_COMP_PREFER_OBJECT_LIST_ITEM",
        suggestedComponent: "sap.m.ObjectListItem",
        reason: "Business list entries with title+description+info are better represented with ObjectListItem semantics.",
        confidence: "medium",
        guideline: GUIDELINES.businessLists
      }, filePath, findLineByIndex(content, match.index), "sap.m.StandardListItem"));
    }
    match = pattern.exec(content);
  }
  return recommendations;
}

function recommendTablePatternsFromXml(filePath, content) {
  const recommendations = [];
  const columnItems = extractTagBlocks(content, "ColumnListItem");
  for (const block of columnItems) {
    if (/<(?:(\w+):)?ObjectIdentifier\b/.test(block.content)) {
      continue;
    }

    const textEntries = extractTextEntries(block.content);
    const hasIdLikeText = textEntries.some((entry) => ID_HINT_REGEX.test(entry));
    const hasTitleLikeText = textEntries.some((entry) => TITLE_HINT_REGEX.test(entry));
    if (!hasIdLikeText || !hasTitleLikeText) {
      continue;
    }

    recommendations.push(toRecommendation({
      id: "UI5_COMP_PREFER_OBJECT_IDENTIFIER",
      suggestedComponent: "sap.m.ObjectIdentifier",
      reason: "ID + title patterns in table rows should use ObjectIdentifier for better hierarchy and readability.",
      confidence: "medium",
      guideline: GUIDELINES.businessLists
    }, filePath, block.line, "sap.m.Text"));
  }
  return recommendations;
}

function parseXmlAttributes(attributes) {
  const map = {};
  const pattern = new RegExp(ATTR_REGEX.source, ATTR_REGEX.flags);
  let match = pattern.exec(attributes);
  while (match) {
    map[match[1]] = match[2];
    match = pattern.exec(attributes);
  }
  return map;
}

function extractTextEntries(content) {
  const entries = [];
  const pattern = new RegExp(TEXT_TAG_REGEX.source, TEXT_TAG_REGEX.flags);
  let match = pattern.exec(content);
  while (match) {
    const attrs = parseXmlAttributes(match[2] ?? "");
    entries.push(buildSignalText([attrs.id, attrs.text, attrs.tooltip]));
    match = pattern.exec(content);
  }
  return entries;
}

function buildSignalText(values) {
  return values
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function extractJsType(snippet) {
  const typeMatch = /type\s*:\s*["']([^"']+)["']/i.exec(snippet);
  return typeMatch ? typeMatch[1] : "";
}

function dedupeRecommendations(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.file}::${item.line ?? 0}::${item.rule}::${item.suggestedComponent}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function findLineByIndex(content, index) {
  if (index < 0) {
    return null;
  }
  return content.slice(0, index).split(/\r?\n/).length;
}

function countMatches(content, regex) {
  let count = 0;
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const pattern = new RegExp(regex.source, flags);
  let match = pattern.exec(content);
  while (match) {
    count += 1;
    match = pattern.exec(content);
  }
  return count;
}

function toRecommendation(rule, file, line, currentComponent) {
  return {
    rule: rule.id,
    file,
    line,
    currentComponent,
    suggestedComponent: rule.suggestedComponent,
    reason: rule.reason,
    confidence: rule.confidence,
    guideline: rule.guideline
  };
}

function findLine(content, fragment) {
  const index = content.indexOf(fragment);
  if (index < 0) {
    return null;
  }
  return findLineByIndex(content, index);
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function extractTagBlocks(content, localName) {
  const blocks = [];
  const startPattern = new RegExp(`<(?:(\\w+):)?${localName}\\b[^>]*>`, "g");
  let match = startPattern.exec(content);
  while (match) {
    const prefix = match[1];
    const closeTag = `</${prefix ? `${prefix}:` : ""}${localName}>`;
    const endIndex = content.indexOf(closeTag, match.index);
    if (endIndex > match.index) {
      blocks.push({
        content: content.slice(match.index, endIndex + closeTag.length),
        line: findLineByIndex(content, match.index)
      });
    }
    match = startPattern.exec(content);
  }
  return blocks;
}
