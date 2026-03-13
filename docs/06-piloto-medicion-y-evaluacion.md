# 06 - Piloto: Medicion y Evaluacion

Objetivo: validar con datos si el servidor MCP + IA mejora productividad sin bajar calidad.

## 1) Preguntas que debe responder el piloto

1. Cuanto tiempo real ahorramos por tarea.
2. Si la calidad sube, se mantiene o baja.
3. En que tipo de tareas aporta mas valor.
4. Que partes del flujo necesitan ajuste.

## 2) Diseno recomendado (A/B simple)

- Grupo A (control): flujo habitual sin MCP-first estricto.
- Grupo B (piloto): flujo MCP-first completo.
- Muestra minima recomendada:
  - 10 tareas A
  - 10 tareas B
- Regla importante: tareas comparables en alcance y complejidad.

## 3) KPI minimos (core)

- `tiempo_total_min`: inicio tarea -> `npm run check` en verde.
- `first_pass_quality`: pasa `run_project_quality_gate` a la primera (`si/no`).
- `iteraciones_patch`: numero de ciclos preview/apply por tarea.
- `defectos_post`: bugs detectados tras cerrar tarea.
- `esfuerzo_manual_pct`: parte del trabajo hecho manualmente (estimado).
- `bloqueos`: incidencias de contexto faltante, policy o tooling.

## 4) Plantilla por tarea (copiar/pegar)

```md
### Tarea: <id o titulo>
- Fecha:
- Proyecto:
- Tipo: bugfix | feature | refactor | odata | onboarding
- Complejidad estimada: baja | media | alta
- Grupo: A(control) | B(MCP-first)

- Inicio:
- Fin:
- tiempo_total_min:

- Tools usadas:
  - ...

- run_project_quality_gate:
  - resultado: pass | fail
  - first_pass_quality: si | no

- npm run check:
  - resultado: pass | fail

- iteraciones_patch:
- defectos_post (24/48h):
- esfuerzo_manual_pct:
- bloqueos/enlaces:

- Observaciones de calidad:
  - legibilidad:
  - mantenibilidad:
  - seguridad:
```

## 5) Criterios de exito MVP (propuestos)

- Ahorro medio de tiempo >= 20% en grupo B.
- `first_pass_quality` >= 70% en grupo B.
- No aumentar `defectos_post` frente al grupo A.
- Menos `iteraciones_patch` en tareas repetitivas.

## 6) Flujo operativo del piloto

1. Elegir lote de tareas equivalentes (A y B).
2. Ejecutar cada tarea con su flujo definido.
3. Registrar resultados en la plantilla.
4. Hacer revision semanal:
   - `mcp_health_report`
   - `record_skill_execution_feedback`
   - `record_agent_execution_feedback`
5. Cerrar semana con resumen comparativo.

## 7) Resumen semanal (formato corto)

```md
## Semana <n>
- total_tareas_A:
- total_tareas_B:
- ahorro_tiempo_B_vs_A:
- first_pass_quality_A:
- first_pass_quality_B:
- defectos_post_A:
- defectos_post_B:

- conclusiones:
  - que funciono:
  - que no funciono:
  - decision: mantener | ajustar | escalar
```

## 8) Reglas para no degradar calidad

- No cerrar tareas sin `run_project_quality_gate`.
- No cerrar tareas sin `npm run check`.
- Mantener `dryRun: true` antes de aplicar cambios de impacto.
- Si hay regresion, aplicar rollback y registrar causa.
