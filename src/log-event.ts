import * as Redacted from "effect/Redacted";
import { MediaGenerationError } from "@fungi.computer/agar/media";

/** Print typed safe Media facts; retain the original cause only as redacted. */
export function reportCatchFailure(operation: string, cause: unknown): void {
  console.error(
    "Prints operation failed",
    JSON.stringify({
      operation,
      errorKind: cause instanceof Error ? "error" : "non-error",
      stage: cause instanceof MediaGenerationError ? cause.stage : null,
      provider:
        cause instanceof MediaGenerationError ? cause.provider : undefined,
    }),
    Redacted.make(cause),
  );
}
