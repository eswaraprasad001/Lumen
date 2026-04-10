import { requireApiAuth } from "@/lib/auth";
import { runSync } from "@/lib/data";

export async function POST() {
  const { unauthorized } = await requireApiAuth();
  if (unauthorized) return unauthorized;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(progress: number, message: string) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ progress, message })}\n\n`),
        );
      }

      try {
        const result = await runSync((progress, message) => send(progress, message));
        if (!result.ok) {
          send(-1, result.error ?? "Sync failed.");
        }
      } catch {
        send(-1, "Unexpected error during sync.");
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
