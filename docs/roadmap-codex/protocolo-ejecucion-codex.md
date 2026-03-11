# Protocolo de ejecucion para Codex

Este protocolo define como ejecutar cada tarea del backlog para minimizar riesgos y mantener trazabilidad.

## Flujo obligatorio por tarea

1. Seleccionar una tarea lista:
- Debe existir en `backlog-priorizado.yaml`.
- No debe tener dependencias pendientes.

2. Preparar contexto:
- Leer archivos afectados.
- Verificar estado actual del repositorio.
- Identificar contratos de entrada/salida a preservar.

3. Disenar cambio minimo viable:
- Definir alcance exacto.
- Evitar cambios no relacionados.
- Si cambia arquitectura, abrir ADR.

4. Implementar:
- Aplicar cambios incrementales por modulo.
- Mantener nombres, estilo y convenciones existentes.
- Evitar introducir deuda tecnica nueva.

5. Validar:
- Ejecutar checks de sintaxis, lint y tests.
- Verificar que no rompe tools existentes.
- Confirmar compatibilidad de output en tools publicas.

6. Documentar:
- Actualizar docs afectadas en el mismo cambio.
- Incluir ejemplos de uso y limites.
- Registrar decisiones clave.

7. Cerrar tarea:
- Completar checklist de `definition-of-done.md`.
- Dejar resumen tecnico listo para PR.

## Politicas de cambio

- No modificar comportamiento publico sin documentar impacto.
- No agregar dependencias fuera de `herramientas-oficiales-open-source.md`.
- No mezclar refactor masivo con funcionalidad nueva en una sola tarea.
- Todo cambio debe poder explicarse en menos de 10 puntos concretos.

## Estrategia de lotes

- Lote A: Infraestructura de calidad y parser (P0-001 a P0-003).
- Lote B: Escritura segura y validacion avanzada (P0-004 a P0-006).
- Lote C: Capas funcionales UI5 (P1-001 a P1-005).
- Lote D: Operacion y hardening (P2-001 a P2-004).

## Plantilla de ejecucion rapida

Usar `plantillas/task-template.md` antes de empezar cada tarea y completar:
- alcance,
- archivos previstos,
- pruebas previstas,
- criterio de salida.
