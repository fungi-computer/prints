import { backgroundProviderTimeoutMs } from "@fungi.computer/darkroom/browser";
import { AppError } from "@fungi.computer/agar/errors";
import * as Schema from "effect/Schema";

/**
 * Generations one person may have in flight at once. The composer and the
 * backend both read this, so a second browser tab cannot spend past it.
 */
export const MAX_GENERATIONS_IN_FLIGHT = 4;

/** Past the provider timeout no run can still be going; the slack before we say so. */
const staleMarginMs = 3 * 60_000;

/**
 * How long a run holds its place under the limit, from when it started.
 * Stopping a run only stops waiting for it: the provider call is not
 * cancelled, so a stopped run holds its place for the same time.
 */
export const generationHoldMs = backgroundProviderTimeoutMs + staleMarginMs;

/** Short reason shown on the disabled Generate key. */
export const generationLimitReason = `${String(MAX_GENERATIONS_IN_FLIGHT)} generations are running. Wait for one to finish.`;

/** The backend's typed refusal when a person is already at the limit. */
export const generationLimitRefusalSchema = Schema.Struct({
  error: Schema.Literal("generation_limit"),
  limit: Schema.Int,
  message: Schema.String,
});

export const generationLimitRefusal = {
  error: "generation_limit",
  limit: MAX_GENERATIONS_IN_FLIGHT,
  message: `You already have ${String(MAX_GENERATIONS_IN_FLIGHT)} generations running. Wait for one to finish, then try again.`,
} as const satisfies Schema.Schema.Type<typeof generationLimitRefusalSchema>;

/** What a person reads when the backend, not this tab, says they are at the limit. */
export class GenerationLimitError extends AppError {
  constructor(message: string) {
    super(message, { code: "CONFLICT", retryable: true });
  }
}
