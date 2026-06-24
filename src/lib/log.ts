/**
 * Minimal server-side error logging. No observability stack is wired up yet —
 * this just ensures failures at destructive/critical paths aren't silently
 * swallowed and show up in server logs (Vercel logs, `next start` stdout, etc.).
 */
export function logServerError(context: string, error: unknown, extra?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context}]`, message, extra ?? "");
}
