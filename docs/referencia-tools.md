# Referencia de tools MCP

Listado de tools actualmente registradas en `src/tools/index.js`.

## Dominio project

### `analyze_ui5_project`

- Objetivo: analizar configuracion UI5 del workspace.
- Lee: `ui5.yaml`, `manifest.json` (o `webapp/manifest.json`), `package.json`.
- Salida principal:
  - archivos detectados
  - `ui5Version`
  - `models`
  - `routing` (routes/targets)
  - `namespace`
  - `controllerPattern`

### `read_project_file`

- Objetivo: leer archivo del workspace de forma segura.
- Entrada:
  - `path` (string)
  - `maxChars` (opcional)
- Salida:
  - `path`
  - `content`
  - `truncated`

### `search_project_files`

- Objetivo: buscar texto en archivos del proyecto.
- Entrada:
  - `query`
  - `maxResults` (opcional)
  - `extensions` (opcional)
- Salida:
  - `query`
  - `matches` (rutas relativas)

### `analyze_current_file`

- Objetivo: extraer metadata estructurada de un archivo.
- Entrada:
  - `path`
- Salida:
  - imports ESM
  - dependencias `sap.ui.define`
  - nombres de clase
  - patron de controller
  - metodos controller

## Dominio ui5

### `generate_ui5_controller`

- Genera skeleton UI5 con:
  - `sap.ui.define`
  - `Controller.extend`
  - metodos lifecycle (`onInit`, `onBeforeRendering`, `onAfterRendering`, `onExit`)
  - JSDoc

### `generate_ui5_fragment`

- Genera fragmento XML con namespace de `sap.m` y `sap.ui.core`.
- Soporta lista de controles base para poblar el contenido.

### `generate_ui5_formatter`

- Genera modulo `formatter` en estructura UI5.
- Incluye funciones basicas con JSDoc.

### `generate_ui5_view_logic`

- Genera metodos sugeridos de eventos para controllers de vistas XML.

### `validate_ui5_code`

- Valida:
  - uso de `sap.ui.define`
  - consistencia deps vs parametros factory
  - convencion de nombre
  - posibles mezclas MVC
- Devuelve:
  - `isValid`
  - `issues` (`error`/`warn`)
  - metodos detectados
  - lifecycle faltante (segun implementacion actual)

## Dominio javascript

### `generate_javascript_function`

- Genera funcion ES2022 para `browser` o `node`.
- Puede generar JS o TypeScript (`typescript: true`).
- Incluye JSDoc y validacion basica de input.

### `refactor_javascript_code`

- Refactors actuales:
  - `var` -> `let`/`const` segun reasignacion
  - callbacks de `then/catch` a arrow function
  - elimina trailing whitespace
- Devuelve codigo refactorizado y lista de cambios aplicados.

### `lint_javascript_code`

- Reglas implementadas:
  - `no-var`
  - `no-console`
  - `eqeqeq`
  - checks basicos adicionales desde `utils/validator.js`
- Devuelve warnings y sugerencias.

### `security_check_javascript`

- Detecciones:
  - `eval`
  - `new Function`
  - `child_process.exec/execSync`
  - import dinamico no literal
  - patrones de prototype pollution
- Salida:
  - `safe`
  - `findings` con severidad

## Dominio documentation

### `search_ui5_sdk`

- Consulta indice oficial del SDK UI5:
  - `https://ui5.sap.com/test-resources/sap/ui/documentation/sdk/inverted-index.json`
- Devuelve resumen y ejemplo por resultado.

### `search_mdn`

- Consulta API de busqueda MDN:
  - `https://developer.mozilla.org/api/v1/search`
- Devuelve titulo, URL y resumen.

