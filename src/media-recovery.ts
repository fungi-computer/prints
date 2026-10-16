import {
  completeGenerationRequestSchema,
  type CompleteGenerationRequest,
} from "./media-completion-contract.js";
import { appBackend } from "@fungi.computer/agar/backend";
import { AppError, type CapabilityDirectory } from "@fungi.computer/agar";
import type { MediaGenerationReference } from "@fungi.computer/agar/media";
import * as Schema from "effect/Schema";
import {
  normalizePendingGeneration,
  pendingGenerationSchema,
  type PendingGeneration,
} from "./media-recovery-contract.js";

export async function rememberGeneration(
  capabilities: CapabilityDirectory,
  record: PendingGeneration,
) {
  const expectedWire = Schema.decodeUnknownSync(pendingGenerationSchema, {
    onExcessProperty: "error",
  })(record);
  const expected = normalizePendingGeneration(expectedWire);
  const confirmedWire = Schema.decodeUnknownSync(pendingGenerationSchema, {
    onExcessProperty: "error",
  })(
    await capabilities.require(appBackend).request(
      JSON.stringify({
        operation: "remember-generation",
        record: expected,
      }),
    ),
  );
  const confirmed = normalizePendingGeneration(confirmedWire);
  if (JSON.stringify(confirmed) !== JSON.stringify(expected))
    throw new AppError(
      "Prints did not confirm the original generation command",
      { code: "PROTOCOL", retryable: false },
    );
  return confirmed;
}

export async function forgetGeneration(
  capabilities: CapabilityDirectory,
  reference: MediaGenerationReference,
) {
  Schema.decodeUnknownSync(Schema.Struct({ removed: Schema.Boolean }))(
    await capabilities
      .require(appBackend)
      .request(JSON.stringify({ operation: "forget-generation", reference })),
  );
}

export async function listGenerations(
  capabilities: CapabilityDirectory,
  after: string | null = null,
) {
  const page = Schema.decodeUnknownSync(
    Schema.Struct({
      records: Schema.Array(pendingGenerationSchema),
      next: Schema.NullOr(Schema.String),
    }),
    { onExcessProperty: "error" },
  )(
    await capabilities
      .require(appBackend)
      .request(JSON.stringify({ operation: "list-generations", after })),
  );
  return {
    records: page.records.map(normalizePendingGeneration),
    next: page.next,
  };
}

export async function completeGeneration(
  capabilities: CapabilityDirectory,
  reference: MediaGenerationReference,
  result: CompleteGenerationRequest["result"],
) {
  const request = Schema.decodeUnknownSync(completeGenerationRequestSchema, {
    onExcessProperty: "error",
  })({ operation: "complete-generation", reference, result });
  // The backend returns a PrintRecord; completion only consumes its identity.
  const confirmed = Schema.decodeUnknownSync(
    Schema.Struct({
      printId: Schema.String,
      computerId: Schema.String,
    }),
  )(await capabilities.require(appBackend).request(JSON.stringify(request)));
  if (
    confirmed.printId !== reference.requestId ||
    confirmed.computerId !== reference.computerId
  )
    throw new AppError("Prints did not confirm the saved generation", {
      code: "PROTOCOL",
      retryable: false,
    });
}
