# 08 - Observabilidad y Logs

Objetivo: recoger evidencia real de uso del servidor MCP para analizar rendimiento, errores y patrones de adopcion antes de endurecer mas el producto.

## Que se registra

Al arrancar el servidor y en cada invocacion de tool se generan eventos estructurados:

- Eventos de ciclo de vida del servidor.
- Ejecuciones de tools con:
  - nombre de la tool
  - identificador de invocacion
  - estado (`success` o `error`)
  - duracion en milisegundos
  - clasificacion de rendimiento (`normal` o `slow`)
  - resumen de argumentos
  - resumen del resultado o del error

## Donde se guardan

Por defecto, en:

- `.mcp-runtime/logs/telemetry-events-<sessionId>.jsonl`
- `.mcp-runtime/logs/telemetry-session-<sessionId>.json`
- `.mcp-runtime/logs/telemetry-session-latest.json`

`telemetry-events-<sessionId>.jsonl` contiene el historico de eventos de una sesion.

`telemetry-session-<sessionId>.json` mantiene agregados por herramienta y por sesion:

- numero de invocaciones
- exitos y errores
- duracion media, minima y maxima
- numero de llamadas lentas
- codigos de error observados

## Privacidad y volumen

- No se persisten objetos completos sin control: los valores se resumen y se truncan.
- Las claves sensibles como `token`, `secret`, `password`, `authorization`, `apiKey` o `cookie` se enmascaran.
- El directorio `.mcp-runtime/` esta ignorado por Git.

## Variables de entorno

- `MCP_TELEMETRY_ENABLED=false`
  - Desactiva la telemetria.
- `MCP_TELEMETRY_DIR=ruta/relativa/o/absoluta`
  - Cambia la carpeta de salida de logs.
- `MCP_TELEMETRY_SLOW_THRESHOLD_MS=2000`
  - Marca como lentas las invocaciones que igualen o superen ese umbral.

## Uso recomendado en esta fase

1. Ejecutar el servidor normalmente.
2. Dejar que varios desarrolladores lo usen durante unos dias.
3. Revisar `telemetry-session-latest.json` para una lectura rapida.
4. Analizar los `.jsonl` para:
   - tools mas usadas
   - tools con mas error
   - latencias altas
   - argumentos o flujos recurrentes que pidan nuevas automatizaciones
