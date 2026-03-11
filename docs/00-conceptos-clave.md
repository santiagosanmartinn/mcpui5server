# 00 - Conceptos Clave (Glosario rapido)

Este documento explica, en lenguaje sencillo, los terminos tecnicos mas usados en esta documentacion.

## 1) Terminos base (IA + MCP)

- `MCP`:
  - protocolo para que la IA use herramientas externas de forma estructurada.
- `tool`:
  - accion concreta que el servidor MCP puede ejecutar.
  - ejemplo: `analyze_ui5_project`.
- `handler`:
  - funcion interna que ejecuta la logica de una `tool`.
- `inputSchema` / `outputSchema`:
  - contrato de entrada y salida (validado con `zod`).
- `LLM`:
  - modelo de lenguaje que interpreta instrucciones y genera respuestas.
- `prompt`:
  - instruccion que le das a la IA para que haga una tarea.
- `contexto`:
  - informacion que la IA tiene disponible para decidir que hacer.
- `token`:
  - unidad de texto que consume el modelo (no equivale a palabra exacta).
- `ventana de contexto`:
  - cantidad maxima de texto que el modelo puede considerar en una respuesta.
- `hallucination`:
  - respuesta inventada o no apoyada por datos reales del proyecto.
  - se reduce usando herramientas y validaciones reales.

## 2) Terminos de trabajo diario

- `dryRun`:
  - simulacion sin escribir en disco.
  - sirve para revisar antes de aplicar cambios.
- `preview`:
  - vista previa de un cambio (normalmente diff y resumen).
- `diff`:
  - diferencia entre el estado actual y el estado propuesto.
- `apply`:
  - aplicar un cambio de verdad en el proyecto.
- `patch`:
  - conjunto de cambios en uno o varios ficheros.
- `rollback`:
  - deshacer un patch ya aplicado.
- `idempotente`:
  - ejecutar varias veces produce el mismo resultado final.
- `workspace`:
  - carpeta del proyecto donde la IA puede leer/escribir segun reglas.
- `rootDir`:
  - raiz del proyecto usada para limitar accesos y evitar salir fuera.
- `hash`:
  - huella digital de contenido para detectar cambios.

## 3) Calidad y seguridad

- `quality gate`:
  - validacion final que agrupa comprobaciones de calidad, seguridad y rendimiento.
- `strict mode`:
  - modo estricto: falla ante inconsistencias o configuraciones incompletas.
- `policy`:
  - reglas del proyecto en `.codex/mcp/policies/agent-policy.json`.
- `lint`:
  - analisis estatico de codigo para detectar problemas de estilo y calidad.
- `static analysis`:
  - revision de codigo sin ejecutarlo.
- `regresion`:
  - algo que antes funcionaba y deja de funcionar tras un cambio.
- `false positive`:
  - aviso que parece error pero realmente no lo es.
- `hardening`:
  - mejora de robustez y seguridad antes de pasar a produccion.

## 4) Agentes y evolucion

- `recommend`:
  - sugerir agentes segun el estado real del proyecto.
- `materialize`:
  - generar artefactos de agentes en el proyecto.
- `pack`:
  - paquete reutilizable de configuracion/artefactos de agentes.
- `rank`:
  - ordenar packs por resultados historicos.
- `promote` / `deprecate`:
  - subir o bajar el estado de un pack segun rendimiento.
- `agent blueprint`:
  - definicion estructurada de agentes, objetivos, tools y quality gates.
- `allowlist de tools`:
  - lista de herramientas que un agente puede usar.
- `feedback loop`:
  - ciclo de mejora continua con resultados reales de ejecucion.
- `lifecycle status`:
  - estado del pack (`experimental`, `candidate`, `recommended`, `deprecated`).

## 5) Proyectos heredados (legacy)

- `legacy project`:
  - proyecto existente, normalmente creado antes de este flujo con IA.
- `intake`:
  - captura de contexto del proyecto (restricciones, criticidad, objetivos).
- `baseline`:
  - fotografia tecnica del estado actual (inventario, riesgos, hotspots).
- `context index`:
  - indice de contexto para reducir tokens y evitar prompts repetidos.
- `readyForAutopilot`:
  - indicador de que el proyecto tiene contexto suficiente para flujo mas automatico.
- `hotspot`:
  - fichero o zona con mayor riesgo/impacto tecnico.
- `mustKeepStableAreas`:
  - partes que no se deben tocar salvo necesidad clara.

## 6) Terminos UI5 utiles para principiantes

- `manifest.json`:
  - fichero principal de configuracion de la app UI5 (routing, modelos, metadata).
- `routing`:
  - configuracion de navegacion entre vistas.
- `target`:
  - destino de navegacion en routing.
- `controller`:
  - logica JavaScript de una vista UI5.
- `view`:
  - estructura visual (normalmente XML) de la pantalla.
- `fragment`:
  - porcion reutilizable de UI.
- `formatter`:
  - funciones para formatear valores mostrados en UI.
- `i18n`:
  - internacionalizacion (textos traducibles).
- `namespace`:
  - identificador unico del proyecto/modulos UI5.

## 7) Terminos de operacion MCP en este repo

- `ensure_project_mcp_current`:
  - comprueba y actualiza la estructura MCP del proyecto.
- `prepare_legacy_project_for_ai`:
  - orquesta ensure + intake + baseline + context-index.
- `run_project_quality_gate`:
  - ejecuta validaciones agregadas antes del cierre de tarea.
- `record_agent_execution_feedback`:
  - guarda resultados para mejorar recomendaciones futuras.
- `auto-ensure`:
  - sincronizacion MCP automatica al arrancar o materializar.
- `auto-prepare`:
  - preparacion automatica del contexto legacy.

## 8) Vocabulario recomendado en este repo

- Se mantienen anglicismos tecnicos cuando son el termino habitual:
  - `dryRun`, `patch`, `rollback`, `quality gate`, `strict`, `baseline`, `prompt`, `diff`.
- Cuando sea util, se acompanan de una explicacion en castellano.

## 9) Regla practica para nuevos usuarios

Si no entiendes un termino:

1. busca en este glosario.
2. revisa un ejemplo en `docs/ejemplos-tools.md`.
3. ejecuta primero en `dryRun` para ver comportamiento real sin riesgo.
