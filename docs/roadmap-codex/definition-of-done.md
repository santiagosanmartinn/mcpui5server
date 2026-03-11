# Definition of Done (DoD)

Una tarea del roadmap solo se considera terminada si cumple todos los puntos de esta lista.

## 1) Calidad tecnica

- El codigo compila y pasa chequeos sintacticos.
- No hay errores nuevos en lint/tests.
- La implementacion incluye manejo de errores con codigos estables cuando aplica.

## 2) Compatibilidad

- No rompe contratos existentes de tools MCP sin versionado o nota de migracion.
- El output estructurado sigue siendo deterministico.
- Se verifica comportamiento base de tools relacionadas.

## 3) Seguridad

- No existe acceso fuera de `context.rootDir`.
- No se agregan operaciones peligrosas sin guardas explicitas.
- Validaciones de entrada con schemas estrictos (`zod`) cuando aplique.

## 4) Pruebas

- Se agregan o actualizan pruebas para nuevas rutas de codigo.
- Hay al menos una prueba negativa por error esperado.
- Se documenta como reproducir validacion local.

## 5) Documentacion

- Documentacion de tool o modulo actualizada en el mismo cambio.
- Ejemplo de entrada/salida incluido para nuevas tools.
- Si hay decision de arquitectura, ADR creado o actualizado.

## 6) Operacion

- Logs siguen formato consistente.
- Mensajes de error son accionables.
- No se degrada de forma notable el tiempo de ejecucion.

## 7) Checklist final (copiable)

- [ ] Alcance implementado sin cambios colaterales.
- [ ] Validaciones locales ejecutadas.
- [ ] Contratos MCP revisados.
- [ ] Documentacion actualizada.
- [ ] Riesgos residuales anotados.
