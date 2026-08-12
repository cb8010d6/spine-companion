export function readableManagerError(error, fallback = "") {
  if (typeof error === "string") return error.trim() || fallback;
  const message = error?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  const text = String(error ?? "").trim();
  return text && text !== "[object Object]" ? text : fallback;
}

export function actionableManagerErrorBody(error, nextStep, fallback = "") {
  return [nextStep, readableManagerError(error, fallback)].filter(Boolean).join("\n\n");
}
