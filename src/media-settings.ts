import { mediaLibraryPathSchema } from "@fungi.computer/agar/media";
import { appBackend } from "@fungi.computer/agar/backend";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import * as Schema from "effect/Schema";

const computerId = Schema.NonEmptyString;
const noticeKey = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(1024)),
);
const noticeKeys = Schema.Array(noticeKey).pipe(
  Schema.check(Schema.isMaxLength(200)),
);
export const mediaNoticeRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("read-notices"), computerId }),
  Schema.Struct({
    operation: Schema.Literal("dismiss-notices"),
    computerId,
    keys: noticeKeys,
  }),
]);
export const mediaNoticesSchema = Schema.Struct({ keys: noticeKeys });
export async function mediaNotices(
  capabilities: CapabilityDirectory,
  input: Schema.Schema.Type<typeof mediaNoticeRequestSchema>,
) {
  return Schema.decodeUnknownSync(mediaNoticesSchema)(
    await capabilities.require(appBackend).request(JSON.stringify(input)),
  );
}
/** Prints settings are App state; a Computer ID only identifies the file owner. */
export const mediaSettingsRequestSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("read-folder"), computerId }),
  Schema.Struct({
    operation: Schema.Literal("select-folder"),
    computerId,
    path: mediaLibraryPathSchema,
  }),
]);
export const mediaFolderSchema = Schema.Struct({
  path: mediaLibraryPathSchema,
  configured: Schema.Boolean,
});

export type MediaSettingsRequest = Schema.Schema.Type<
  typeof mediaSettingsRequestSchema
>;

export async function mediaSettings(
  capabilities: CapabilityDirectory,
  input: MediaSettingsRequest,
) {
  return Schema.decodeUnknownSync(mediaFolderSchema)(
    await capabilities.require(appBackend).request(JSON.stringify(input)),
  );
}
