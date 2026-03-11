const LEGACY_1_16_CONTROLS = [
  "sap.m.App",
  "sap.m.Bar",
  "sap.m.BusyDialog",
  "sap.m.Button",
  "sap.m.CheckBox",
  "sap.m.Column",
  "sap.m.ColumnListItem",
  "sap.m.ComboBox",
  "sap.m.CustomListItem",
  "sap.m.Dialog",
  "sap.m.FeedListItem",
  "sap.m.FlexBox",
  "sap.m.HBox",
  "sap.m.IconTabBar",
  "sap.m.IconTabFilter",
  "sap.m.Image",
  "sap.m.Input",
  "sap.m.InputBase",
  "sap.m.Label",
  "sap.m.Link",
  "sap.m.List",
  "sap.m.ListItemBase",
  "sap.m.NavContainer",
  "sap.m.ObjectAttribute",
  "sap.m.ObjectHeader",
  "sap.m.ObjectIdentifier",
  "sap.m.ObjectListItem",
  "sap.m.ObjectNumber",
  "sap.m.ObjectStatus",
  "sap.m.Page",
  "sap.m.Panel",
  "sap.m.Popover",
  "sap.m.ProgressIndicator",
  "sap.m.RadioButton",
  "sap.m.RadioButtonGroup",
  "sap.m.ScrollContainer",
  "sap.m.SearchField",
  "sap.m.SegmentedButton",
  "sap.m.Select",
  "sap.m.Shell",
  "sap.m.SplitApp",
  "sap.m.SplitContainer",
  "sap.m.StandardListItem",
  "sap.m.StepInput",
  "sap.m.Switch",
  "sap.m.Table",
  "sap.m.Text",
  "sap.m.TextArea",
  "sap.m.Title",
  "sap.m.Toolbar",
  "sap.m.VBox"
];

const LEGACY_1_16_MODULES = [
  "sap.m.MessageBox",
  "sap.m.MessageToast",
  "sap.ui.core.BusyIndicator",
  "sap.ui.core.CustomData",
  "sap.ui.core.Fragment",
  "sap.ui.core.FragmentDefinition",
  "sap.ui.core.HTML",
  "sap.ui.core.Icon",
  "sap.ui.core.Item",
  "sap.ui.core.UIComponent",
  "sap.ui.core.ValueState",
  "sap.ui.core.format.DateFormat",
  "sap.ui.core.mvc.Controller",
  "sap.ui.core.mvc.View",
  "sap.ui.core.routing.History",
  "sap.ui.core.routing.Router",
  "sap.ui.layout.Grid",
  "sap.ui.layout.HorizontalLayout",
  "sap.ui.layout.VerticalLayout",
  "sap.ui.layout.form.Form",
  "sap.ui.layout.form.FormContainer",
  "sap.ui.layout.form.FormElement",
  "sap.ui.layout.form.SimpleForm",
  "sap.ui.model.BindingMode",
  "sap.ui.model.Filter",
  "sap.ui.model.FilterOperator",
  "sap.ui.model.Sorter",
  "sap.ui.model.json.JSONModel",
  "sap.ui.model.odata.v2.ODataModel",
  "sap.ui.model.type.Boolean",
  "sap.ui.model.type.Date",
  "sap.ui.model.type.DateTime",
  "sap.ui.model.type.Float",
  "sap.ui.model.type.Integer",
  "sap.ui.model.type.String",
  "sap.ui.model.type.Time",
  "sap.ui.table.AnalyticalTable",
  "sap.ui.table.Column",
  "sap.ui.table.Table",
  "sap.ui.table.TreeTable"
];

const VERSIONED_SYMBOLS = [
  { symbol: "sap.m.DatePicker", introducedIn: "1.22.0", kind: "control" },
  { symbol: "sap.m.MultiComboBox", introducedIn: "1.22.0", kind: "control" },
  { symbol: "sap.m.MultiInput", introducedIn: "1.22.0", kind: "control" },
  { symbol: "sap.m.Tokenizer", introducedIn: "1.22.0", kind: "control" },
  { symbol: "sap.m.UploadCollection", introducedIn: "1.26.0", kind: "control" },
  { symbol: "sap.m.OverflowToolbar", introducedIn: "1.28.0", kind: "control" },
  { symbol: "sap.ui.comp.smarttable.SmartTable", introducedIn: "1.26.0", kind: "control" },
  { symbol: "sap.ui.comp.smartfilterbar.SmartFilterBar", introducedIn: "1.28.0", kind: "control" },
  { symbol: "sap.m.PlanningCalendar", introducedIn: "1.34.0", kind: "control" },
  { symbol: "sap.m.TimePicker", introducedIn: "1.32.0", kind: "control" },
  { symbol: "sap.m.DateTimePicker", introducedIn: "1.34.0", kind: "control" },
  { symbol: "sap.m.MaskInput", introducedIn: "1.34.0", kind: "control" },
  { symbol: "sap.m.FormattedText", introducedIn: "1.38.0", kind: "control" },
  { symbol: "sap.m.Wizard", introducedIn: "1.30.0", kind: "control" },
  { symbol: "sap.f.DynamicPage", introducedIn: "1.46.0", kind: "control" },
  { symbol: "sap.f.FlexibleColumnLayout", introducedIn: "1.46.0", kind: "control" },
  { symbol: "sap.ui.codeeditor.CodeEditor", introducedIn: "1.56.0", kind: "control" },
  { symbol: "sap.base.Log", introducedIn: "1.58.0", kind: "module" },
  { symbol: "sap.ui.mdc.Field", introducedIn: "1.76.0", kind: "control" },
  { symbol: "sap.ui.mdc.Table", introducedIn: "1.76.0", kind: "control" },
  { symbol: "sap.m.UploadSet", introducedIn: "1.88.0", kind: "control" },
  { symbol: "sap.ui.mdc.FilterBar", introducedIn: "1.93.0", kind: "control" }
];

export const UI5_SYMBOL_CATALOG = buildUi5SymbolCatalog();

function buildUi5SymbolCatalog() {
  const catalog = {};
  for (const symbol of LEGACY_1_16_CONTROLS) {
    catalog[symbol] = {
      introducedIn: "1.16.0",
      kind: "control"
    };
  }
  for (const symbol of LEGACY_1_16_MODULES) {
    catalog[symbol] = {
      introducedIn: "1.16.0",
      kind: "module"
    };
  }
  for (const item of VERSIONED_SYMBOLS) {
    catalog[item.symbol] = {
      introducedIn: item.introducedIn,
      kind: item.kind
    };
  }
  return catalog;
}
