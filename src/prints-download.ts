import type { AppBrowserActionRefusal } from "@fungi.computer/agar";
import {
  AppError,
  describeAppError,
  type ErrorDescription,
  type ErrorCopy,
} from "@fungi.computer/agar/errors";
import { readComputerFile } from "@fungi.computer/agar/computer";
import {
  type ProvenanceExportFailure,
  maximumPrintDownloadBytes,
  ProvenanceExportError,
  stripPrivateProvenance,
} from "@fungi.computer/darkroom/provenance";
import type { GallerySource } from "./media-gallery.js";
import { isVideoPath } from "./local-images.js";

const tooLargeCopy = {
  title: "Image too large",
  message: "Download supports images up to 32 MiB. Choose a smaller image.",
} satisfies ErrorCopy;

/** Reads through the same admitted browser capability as the gallery. */
export async function preparePrintDownload(
  source: GallerySource,
  signal: AbortSignal,
): Promise<File> {
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (
      source.kind === "computer" &&
      source.connection.app.context.get().computerId !== source.computerId
    )
      throw new AppError("Print Computer changed", {
        code: "SELECTION_CHANGED",
        retryable: false,
      });
  };
  assertCurrent();
  if (source.file.size > maximumPrintDownloadBytes)
    throw new ProvenanceExportError("too-large");
  const file =
    source.kind === "computer"
      ? await readComputerFile(
          source.connection.app.capabilities,
          { path: source.path },
          { signal },
        )
      : source.file;
  assertCurrent();
  if (file.size > maximumPrintDownloadBytes)
    throw new ProvenanceExportError("too-large");
  const printPath = source.kind === "computer" ? source.path : file.name;
  const basename = printPath.split("/").at(-1) ?? "print";
  const stem = basename.replace(/\.[^.]*$/, "") || "print";
  // Prints never embeds provenance into MP4 (embedProvenance refuses with
  // "unsupported-format"), so there is nothing to strip. Export the stored
  // bytes unchanged rather than running the still-image parser on video.
  if (isVideoPath(printPath)) {
    assertCurrent();
    return new File([file], `${stem}.mp4`, { type: "video/mp4" });
  }
  const exported = await stripPrivateProvenance(
    new Uint8Array(await file.arrayBuffer()),
  );
  assertCurrent();
  return new File(
    [Uint8Array.from(exported.bytes)],
    `${stem}.${exported.extension}`,
    { type: exported.type },
  );
}

/** Typed export refusals use the same trusted-copy shape as F5 SDK failures. */
export function describePrintDownloadError(cause: unknown): ErrorDescription {
  if (!(cause instanceof ProvenanceExportError))
    return describeAppError(cause, { FILE_TOO_LARGE: tooLargeCopy });
  const copies = {
    "too-large": tooLargeCopy,
    "signed-image": {
      title: "Download unavailable",
      message:
        "This image has signed metadata that Prints cannot safely remove.",
    },
    "invalid-image": {
      title: "Couldn't prepare the image",
      message:
        "Prints couldn't remove this image's private details. Choose another image.",
    },
    "unsupported-format": {
      title: "Download unavailable",
      message: "Prints cannot safely export this file format yet.",
    },
  } satisfies Record<ProvenanceExportFailure, ErrorCopy>;
  return { ...copies[cause.reason], retryable: false };
}

/** Host refusal stays distinct from a disconnected SDK session or export failure. */
export function describePrintDownloadRefusal(
  refusal: AppBrowserActionRefusal,
): ErrorDescription {
  const copies = {
    "no-user-gesture": {
      title: "Click to download",
      message: "Click Download in Prints to save this image.",
    },
    "too-large": tooLargeCopy,
    "invalid-request": {
      title: "Download unavailable",
      message:
        "The prepared image could not be saved. Reopen its information and try again.",
    },
    unavailable: {
      title: "Download unavailable",
      message:
        "The host cannot save files right now. Reopen Prints and try again.",
    },
    denied: {
      title: "Download denied",
      message:
        "Your browser did not allow this download. Check its download settings and try again.",
    },
    busy: {
      title: "Download busy",
      message: "Wait for the current browser action to finish, then try again.",
    },
  } satisfies Record<AppBrowserActionRefusal["reason"], ErrorCopy>;
  return { ...copies[refusal.reason], retryable: false };
}
