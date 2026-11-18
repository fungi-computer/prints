import { mediaLibraryPathSchema } from "@fungi.computer/agar/media";
import type { CapabilityDirectory } from "@fungi.computer/agar";
import * as Schema from "effect/Schema";
import { callMemberMethod, memberMethods } from "./member-methods.js";

const computerId = Schema.NonEmptyString;
const noticeKey = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(1024)),
);
const noticeKeys = Schema.Array(noticeKey).pipe(
  Schema.check(Schema.isMaxLength(200)),
);
/** Every settings method names the Computer it acts on; the host must agree. */
export const computerInputSchema = Schema.Struct({ computerId });
export const dismissNoticesInputSchema = Schema.Struct({
  computerId,
  keys: noticeKeys,
});
export const mediaNoticesSchema = Schema.Struct({ keys: noticeKeys });
const decodeNotices = Schema.decodeUnknownSync(mediaNoticesSchema);

export async function readNotices(
  capabilities: CapabilityDirectory,
  id: string,
) {
  return decodeNotices(
    await callMemberMethod(
      capabilities,
      memberMethods.readNotices,
      JSON.stringify({
        computerId: id,
      }),
    ),
  );
}
export async function dismissNotices(
  capabilities: CapabilityDirectory,
  id: string,
  keys: readonly string[],
) {
  return decodeNotices(
    await callMemberMethod(
      capabilities,
      memberMethods.dismissNotices,
      JSON.stringify({
        computerId: id,
        keys,
      }),
    ),
  );
}

/** Prints settings are App state; a Computer ID only identifies the file owner. */
export const selectFolderInputSchema = Schema.Struct({
  computerId,
  path: mediaLibraryPathSchema,
});
export const mediaFolderSchema = Schema.Struct({
  path: mediaLibraryPathSchema,
  configured: Schema.Boolean,
});
const decodeFolder = Schema.decodeUnknownSync(mediaFolderSchema);

export async function readFolder(
  capabilities: CapabilityDirectory,
  id: string,
) {
  return decodeFolder(
    await callMemberMethod(
      capabilities,
      memberMethods.readFolder,
      JSON.stringify({
        computerId: id,
      }),
    ),
  );
}
export async function selectFolder(
  capabilities: CapabilityDirectory,
  id: string,
  path: string,
) {
  return decodeFolder(
    await callMemberMethod(
      capabilities,
      memberMethods.selectFolder,
      JSON.stringify({
        computerId: id,
        path,
      }),
    ),
  );
}
