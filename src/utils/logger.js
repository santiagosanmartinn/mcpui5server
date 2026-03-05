export function createLogger(scope) {
  const prefix = `[${scope}]`;

  return {
    info(message, details) {
      log("info", message, details);
    },
    warn(message, details) {
      log("warn", message, details);
    },
    error(message, details) {
      log("error", message, details);
    }
  };

  function log(level, message, details) {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} ${level.toUpperCase()} ${prefix} ${message}`;
    if (details === undefined) {
      console.error(line);
      return;
    }
    console.error(`${line} ${safeSerialize(details)}`);
  }
}

function safeSerialize(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
