import * as Redacted from "effect/Redacted";
import { MediaGenerationError } from "@fungi.computer/agar/media";

/** Print typed safe Media facts; retain the original cause only as redacted. */
export function reportCatchFailure(
  operation: string,
  cause: unknown,
  // The run's request id, whose tail is the "Ref" a person sees, so the Ref
  // finds this line.
  context: Readonly<{ requestId?: string }> = {},
): void {
  console.error(
    "Prints operation failed",
    JSON.stringify({
      operation,
      ...(context.requestId !== undefined && { requestId: context.requestId }),
      errorKind: cause instanceof Error ? "error" : "non-error",
      // The error's class names the cause (SecurityError, QuotaExceededError,
      // TypeError) without its message, which may carry private text.
      errorName: cause instanceof Error ? cause.name : null,
      stage: cause instanceof MediaGenerationError ? cause.stage : null,
      provider:
        cause instanceof MediaGenerationError ? cause.provider : undefined,
    }),
    Redacted.make(cause),
  );
}
