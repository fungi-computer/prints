import { AppError, describeAppError } from "@fungi.computer/agar/errors";
import type { PendingGeneration } from "./media-recovery-contract.js";
import type { GallerySlot } from "./gallery-slots.js";
import type { useComputerUploads } from "./use-computer-uploads.js";
import type { PrintsNotice } from "./prints-activity.js";
import { modelFor, type MediaModel } from "./generation-model.js";

export type NoticeState = {
  connected: boolean;
  mediaCapability: boolean;
  modelsError: string | null;
  retryModels: () => void;
  modelsLoading: boolean;
  models: readonly MediaModel[];
  canGenerate: boolean;
  canWrite: boolean;
  generationError: {
    key: string;
    message: string;
    retry?: () => void;
    billing?: () => void;
  } | null;
  recoveryError: string | null;
  pendingGenerations: readonly PendingGeneration[];
  activeGenerations: ReadonlySet<string>;
  gallerySlots: readonly GallerySlot[];
  computerId: string | null;
  failed: readonly string[];
  uploadError: string | null;
  uploads: ReturnType<typeof useComputerUploads>["items"];
  permissions: () => void;
  resume: (record: PendingGeneration) => void;
  discard: (record: PendingGeneration) => void;
  retryUpload: (id: string) => void;
};

/** One owner for the cause, wording and actions of each activity notice. */
export function noticesFor({
  connected,
  mediaCapability,
  modelsError,
  retryModels,
  modelsLoading,
  models,
  canGenerate,
  canWrite,
  generationError,
  recoveryError,
  pendingGenerations,
  activeGenerations,
  gallerySlots,
  computerId,
  failed,
  uploadError,
  uploads,
  permissions,
  resume,
  discard,
  retryUpload,
}: NoticeState): PrintsNotice[] {
  const notices: PrintsNotice[] = [];
  if (!connected) {
    const description = describeAppError(
      new AppError("Prints disconnected", {
        code: "DISCONNECTED",
        retryable: true,
      }),
    );
    notices.push({
      key: "disconnected",
      group: "Setup",
      tone: "warning",
      blocking: true,
      short: description.title,
      title: description.title,
      detail: description.message,
    });
  } else if (computerId === null)
    notices.push({
      key: "no-computer",
      group: "Setup",
      tone: "info",
      blocking: true,
      short: "Choose a Computer",
      title: "No Computer selected",
      detail: "Choose a Computer for this window, or create one in Grove.",
    });
  else if (!mediaCapability)
    notices.push({
      key: "no-media",
      group: "Setup",
      tone: "info",
      blocking: true,
      short: "Image creation off",
      title: "Image creation is off for this Computer",
      detail: "You can still browse and upload images.",
    });
  else if (modelsError !== null)
    notices.push({
      key: `models:${modelsError}`,
      group: "Setup",
      tone: "warning",
      blocking: true,
      short: "Models unavailable",
      title: "Couldn’t load image models",
      detail: modelsError,
      actions: [{ label: "Retry", run: retryModels }],
    });
  else if (!modelsLoading && !canGenerate)
    notices.push({
      key: "approval",
      group: "Setup",
      tone: "warning",
      blocking: true,
      short: "Generation not enabled",
      title: "Media generation isn’t enabled",
      detail:
        "Turn it on in this App’s Team permissions. Images already generated can still be saved.",
      actions: [
        {
          label: "Permissions",
          run: () => {
            permissions();
          },
        },
      ],
    });
  if (connected && computerId !== null && !canWrite)
    notices.push({
      key: "read-only",
      group: "Setup",
      tone: "info",
      blocking: true,
      short: "Read-only",
      title: "Read-only Computer",
      detail: "Uploads and new prints are off.",
    });
  if (generationError !== null)
    notices.push({
      key: generationError.key,
      group: "Images",
      tone: "error",
      short: "Image failed",
      title: "Couldn’t create image",
      detail: generationError.message,
      actions: generationError.billing
        ? [{ label: "Open Billing", run: generationError.billing }]
        : generationError.retry
          ? [{ label: "Retry", run: generationError.retry }]
          : [],
    });
  if (recoveryError !== null)
    notices.push({
      key: `recovery:${recoveryError}`,
      group: "Images",
      tone: "error",
      short: "Retry blocked",
      title: recoveryError,
    });
  for (const record of pendingGenerations) {
    if (
      activeGenerations.has(record.reference.requestId) ||
      gallerySlots.some(
        (slot) =>
          slot.computerId === record.reference.computerId &&
          slot.path === record.input.destination.path,
      )
    )
      continue;
    const kind = modelFor(models, record.input.settings.model)?.kind ?? "media";
    const title = `Unfinished ${kind}`;
    notices.push({
      key: `unfinished:${record.reference.requestId}`,
      group: "Images",
      tone: "info",
      short: title,
      title,
      detail:
        record.reference.computerId !== computerId
          ? `${record.input.settings.prompt} · on Computer ${record.reference.computerId}`
          : record.input.settings.prompt,
      actions: [
        ...(record.reference.computerId === computerId
          ? [
              {
                label: "Resume",
                run: () => {
                  resume(record);
                },
              },
            ]
          : []),
        {
          label: "Discard",
          run: () => {
            discard(record);
          },
        },
      ],
    });
  }
  if (failed.length > 0)
    notices.push({
      key: `files:${failed.join("|")}`,
      group: "Images",
      tone: "error",
      short: "Couldn’t open images",
      title: "Couldn’t open some images",
      detail: failed.join(", "),
    });
  if (uploadError !== null)
    notices.push({
      key: `uploads:${uploadError}`,
      group: "Uploads",
      tone: "error",
      short: "Upload failed",
      title: "Couldn’t add images",
      detail: uploadError,
    });
  for (const item of uploads)
    if (item.status === "error" || item.status === "cancelled")
      notices.push({
        key: `upload:${item.id}:${item.status}`,
        group: "Uploads",
        tone: item.status === "error" ? "error" : "info",
        short: "Upload failed",
        title: `${item.file.name} wasn’t saved`,
        detail: item.message,
        actions: [
          {
            label: "Retry",
            run: () => {
              retryUpload(item.id);
            },
          },
        ],
      });
  return notices;
}
