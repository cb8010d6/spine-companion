const fs = require("node:fs");
const path = require("node:path");

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function timestamp(date = new Date()) {
  return date.toISOString();
}

function serialize(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  return value;
}

function createFileLogger(configDir) {
  const logsDir = path.join(configDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  function write(level, event, details = {}) {
    const file = path.join(logsDir, `companion-${dayStamp()}.log`);
    const payload = {
      ts: timestamp(),
      level,
      event,
      details: serialize(details)
    };
    try {
      fs.appendFileSync(file, `${JSON.stringify(payload)}\n`);
    } catch (error) {
      console.warn("[spine-companion] Unable to write log", error);
    }
  }

  function exportLogs() {
    fs.mkdirSync(logsDir, { recursive: true });
    const output = path.join(logsDir, `spine-companion-logs-${timestamp().replace(/[:.]/g, "-")}.txt`);
    const files = fs.readdirSync(logsDir)
      .filter((file) => file.endsWith(".log"))
      .sort()
      .slice(-7);
    const body = files.map((file) => {
      const full = path.join(logsDir, file);
      return `===== ${file} =====\n${fs.readFileSync(full, "utf8")}`;
    }).join("\n");
    fs.writeFileSync(output, body || "No log entries yet.\n");
    return output;
  }

  return {
    logsDir,
    debug: (event, details) => write("debug", event, details),
    info: (event, details) => write("info", event, details),
    warn: (event, details) => write("warn", event, details),
    error: (event, details) => write("error", event, details),
    exportLogs
  };
}

module.exports = {
  createFileLogger
};
