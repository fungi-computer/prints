import * as Redacted from "effect/Redacted";
import { MediaGenerationError } from "@fungi.computer/agar/media";

/** Retain the original failure without printing file paths or service data. */
export function reportCatchFailure(operation: string, cause: unknown): void {
  console.error(
    "Prints operation failed",
    JSON.stringify({
      operation,
      errorKind: cause instanceof Error ? "error" : "non-error",
      stage: cause instanceof MediaGenerationError ? cause.stage : null,
    }),
    Redacted.make(cause),
  );
}
