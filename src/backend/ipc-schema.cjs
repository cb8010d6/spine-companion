const path = require("node:path");
const { z } = require("zod");

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const jsonValue = z.lazy(() => z.union([primitive, z.array(jsonValue), z.record(z.string(), jsonValue)]));

const setStateSchema = z.object({
  state: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  message: z.string().max(2000).optional(),
  source: z.string().max(128).optional(),
  direction: z.enum(["left", "right"]).optional(),
  autoReturnMs: z.number().nonnegative().max(600000).optional(),
  returnTo: z.string().trim().min(1).optional(),
  reminderId: z.string().max(160).optional(),
  notify: z.boolean().optional(),
  preserveMessage: z.boolean().optional()
}).passthrough();

const spineSettingsSchema = z.object({
  assetDir: z.string().max(4096).optional(),
  skel: z.string().max(512).optional(),
  scale: z.number().min(0.1).max(3).optional(),
  offsetX: z.number().min(-1000).max(1000).optional(),
  offsetY: z.number().min(-1000).max(1000).optional(),
  mixDurationMs: z.number().min(0).max(10000).optional(),
  boundsSamples: z.number().int().min(1).max(120).optional(),
  framePadding: z.number().min(0.5).max(3).optional(),
  maxViewportFill: z.number().min(0.1).max(1).optional(),
  stageBottomInset: z.number().min(0).max(1000).optional(),
  fitStates: z.array(z.string().max(64)).max(32).optional()
}).passthrough();

const uiSettingsSchema = z.object({
  hudVisible: z.boolean().optional(),
  bubbleVisible: z.boolean().optional(),
  bubbleShadow: z.boolean().optional(),
  bubbleBackground: z.enum(["solid", "soft", "clear", "light"]).optional(),
  bubbleHoldMs: z.number().min(1500).max(60000).optional(),
  dragMode: z.enum(["compatible", "smooth"]).optional(),
  autoRevealOnMcp: z.boolean().optional(),
  systemNotifications: z.boolean().optional(),
  shortcutEnabled: z.boolean().optional(),
  shortcutAccelerator: z.string().trim().min(1).max(80).optional(),
  updateAutoCheck: z.boolean().optional(),
  updateChannel: z.enum(["auto", "stable", "prerelease"]).optional(),
  maxDevicePixelRatio: z.number().min(1).max(3).optional(),
  hitboxPadding: z.number().min(0).max(48).optional(),
  gpuMode: z.enum(["hardware", "software"]).optional(),
  debugHitbox: z.boolean().optional(),
  theme: z.enum(["system", "dark", "light"]).optional(),
  locale: z.enum(["auto", "en", "zh-CN"]).optional()
}).passthrough();

const saveSettingsSchema = z.object({
  window: z.record(z.string(), jsonValue).optional(),
  spine: spineSettingsSchema.optional(),
  ui: uiSettingsSchema.optional(),
  state: z.record(z.string(), jsonValue).optional(),
  models: z.record(z.string(), jsonValue).optional(),
  specialSegments: z.record(z.string(), jsonValue).optional()
}).strict();

const importModelSchema = z.object({
  id: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._#-]+$/)
});

const reminderSchema = z.object({
  id: z.string().max(160).optional(),
  text: z.string().max(2000).optional(),
  message: z.string().max(2000).optional(),
  inSeconds: z.number().nonnegative().max(31536000).optional(),
  delayMs: z.number().nonnegative().max(31536000000).optional(),
  dueAt: z.string().max(120).optional(),
  at: z.string().max(120).optional(),
  durationMs: z.number().nonnegative().max(600000).optional(),
  returnTo: z.string().trim().min(1).optional(),
  snoozeAfterMs: z.number().nonnegative().max(31536000000).optional()
}).passthrough();

function parse(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid ${label}: ${issue.path.join(".") || "value"} ${issue.message}`);
  }
  return result.data;
}

function validateSetState(value) {
  return parse(setStateSchema, value || {}, "state payload");
}

function validateSaveSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid settings patch: value must be an object");
  }
  const text = JSON.stringify(value);
  if (text.length > 256 * 1024) throw new Error("Invalid settings patch: value is too large");
  return parse(saveSettingsSchema, value, "settings patch");
}

function validateImportModel(value) {
  return parse(importModelSchema, value || {}, "model import payload");
}

function validateReminder(value) {
  return parse(reminderSchema, value || {}, "reminder payload");
}

function validateModelId(value) {
  return validateImportModel({ id: value }).id;
}

function validateOpenFolderPath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid folder path");
  const normalized = path.normalize(value);
  if (normalized.includes("\0")) throw new Error("Invalid folder path");
  return normalized;
}

module.exports = {
  validateImportModel,
  validateModelId,
  validateOpenFolderPath,
  validateReminder,
  validateSaveSettings,
  validateSetState
};
