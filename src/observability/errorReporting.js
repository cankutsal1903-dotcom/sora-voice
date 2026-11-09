import Constants from "expo-constants";
import { Platform } from "react-native";

const MAX_TEXT_LENGTH = 1200;
const REPORT_COOLDOWN_MS = 15_000;
let installed = false;
let lastReport = { fingerprint: "", createdAt: 0 };

const redactText = (value) => String(value || "")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
  .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g, "[REDACTED_JWT]")
  .replace(/\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+|sk_[A-Za-z0-9_-]+)\b/g, "[REDACTED_KEY]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
  .slice(0, MAX_TEXT_LENGTH);

const toErrorPayload = (error, context = {}) => {
  const message = redactText(error instanceof Error ? error.message : error);
  const stack = redactText(error instanceof Error ? error.stack : "");
  const expoConfig = Constants.expoConfig || {};

  return {
    message: message || "Unknown client error",
    stack: stack || undefined,
    context: Object.fromEntries(
      Object.entries(context)
        .slice(0, 8)
        .map(([key, value]) => [String(key).slice(0, 60), redactText(value)])
    ),
    platform: Platform.OS,
    appVersion: expoConfig.version || "unknown",
    buildNumber: Platform.select({ ios: expoConfig.ios?.buildNumber, android: expoConfig.android?.versionCode }) || "unknown",
    occurredAt: new Date().toISOString(),
  };
};

const isReportingEnabled = () => process.env.EXPO_PUBLIC_ERROR_REPORTING_ENABLED === "true";

export const reportError = (error, context) => {
  const tokenServerUrl = String(process.env.EXPO_PUBLIC_TOKEN_SERVER_URL || "").replace(/\/$/, "");
  if (!isReportingEnabled() || !tokenServerUrl || typeof fetch !== "function") return;

  const payload = toErrorPayload(error, context);
  const fingerprint = `${payload.message}:${payload.platform}`;
  const now = Date.now();
  if (lastReport.fingerprint === fingerprint && now - lastReport.createdAt < REPORT_COOLDOWN_MS) return;

  lastReport = { fingerprint, createdAt: now };
  fetch(`${tokenServerUrl}/errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
};

export const installGlobalErrorReporting = () => {
  if (installed) return;
  installed = true;

  const errorUtils = globalThis.ErrorUtils;
  if (!errorUtils?.getGlobalHandler || !errorUtils?.setGlobalHandler) return;

  const previousHandler = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error, { fatal: Boolean(isFatal), source: "global" });
    if (typeof previousHandler === "function") previousHandler(error, isFatal);
  });
};
