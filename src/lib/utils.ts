import { clsx } from "clsx";

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values);
}

export function estimateReadMinutes(text: string | null | undefined) {
  if (!text) return null;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function normalizeDomain(emailOrDomain: string) {
  const cleaned = emailOrDomain.trim().toLowerCase();
  if (cleaned.includes("@")) {
    return cleaned.split("@").pop() || cleaned;
  }

  return cleaned.replace(/^www\./, "");
}

export function normalizeSenderEmail(email: string) {
  return email.trim().toLowerCase();
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
