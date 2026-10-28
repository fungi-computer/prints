import { Folder, ImagePlus, SlidersHorizontal, Upload, X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import * as Schema from "effect/Schema";
import {
  statusText,
  type AppStatusItem,
  type AppStatusTone,
} from "@fungi.computer/agar";
import { mediaLibraryPathSchema } from "@fungi.computer/agar/media";
import { SchemaForm, field, useSchemaForm } from "@fungi.computer/caps/form";
import { FormFooter } from "@fungi.computer/caps/components/field";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { DataListHeading } from "@fungi.computer/caps/components/data-list";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@fungi.computer/caps/components/dialog";
import {
  StatusTray,
  StatusTrayList,
  StatusTrayNote,
  StatusTrayRow,
  type StatusTrayItem,
} from "@fungi.computer/caps/blocks/status-tray";
import {
  UploadQueue,
  type UploadQueueProps,
} from "@fungi.computer/caps/blocks/upload-queue";
import type { useMediaFolder } from "./media-folder.js";

export type NoticeTone = "error" | "warning" | "info";
export type PrintsNotice = Readonly<{
  key: string;
  group: "Setup" | "Images" | "Uploads";
  tone: NoticeTone;
  title: string;
  detail?: string;
  /** Short label for the footer chip. */
  short: string;
  actions?: readonly { label: string; run: () => void }[];
  /** Blocking notices explain a disabled composer and cannot be dismissed. */
  blocking?: boolean;
}>;

export type ActivitySummary = Readonly<{
  generating: number;
  uploading: number;
}>;

const rank = { error: 0, warning: 1, info: 2 } satisfies Record<
  NoticeTone,
  number
>;

export function activityFor(
  notices: readonly PrintsNotice[],
  activity: ActivitySummary,
): {
  label: string;
  /** The status light's colour; absent while only working or informing. */
  tone: AppStatusTone | undefined;
  busy: boolean;
} | null {
  const busy = activity.generating + activity.uploading > 0;
  if (busy)
    return {
      busy,
      tone: undefined,
      label: [
        activity.generating ? `Creating ${String(activity.generating)}` : "",
        activity.uploading ? `Uploading ${String(activity.uploading)}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  const top = [...notices]
    .sort(
      (a, b) =>
        Number(b.blocking ?? false) - Number(a.blocking ?? false) ||
        rank[a.tone] - rank[b.tone],
    )
    .at(0);
  if (!top) return null;
  return {
    busy,
    tone: top.tone === "info" ? "neutral" : top.tone,
    label:
      top.short + (notices.length > 1 ? ` +${String(notices.length - 1)}` : ""),
  };
}

/** The window status bar's Activity key: a count and a light for the state. */
export function activityStatusItem(
  notices: readonly PrintsNotice[],
  activity: ActivitySummary,
  open: boolean,
): AppStatusItem | null {
  const summary = activityFor(notices, activity);
  if (!summary) return null;
  const item: AppStatusItem = {
    kind: "button",
    id: "activity",
    text: "Activity",
    count: notices.length + activity.generating + activity.uploading,
    busy: summary.busy,
    title: statusText(`Activity: ${summary.label}`, 1_024),
    opens: "dialog",
    expanded: open,
  };
  return summary.tone === undefined ? item : { ...item, tone: summary.tone };
}

const noticeIcons = {
  Setup: (
    <SlidersHorizontal
      aria-hidden="true"
      className="size-[var(--stipe-icon-size-sm)]"
    />
  ),
  Images: (
    <ImagePlus
      aria-hidden="true"
      className="size-[var(--stipe-icon-size-sm)]"
    />
  ),
  Uploads: (
    <Upload aria-hidden="true" className="size-[var(--stipe-icon-size-sm)]" />
  ),
} satisfies Record<PrintsNotice["group"], ReactNode>;

/** The composer's settings tray: a readout of the current choices and the panel that changes them. */
export type PrintsSettingsTray = Readonly<{
  label: ReactNode;
  content: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>;

/** The composer's settings, seated in its Caps footer. */
export function PrintsFooter({
  controls,
  send,
  settings,
}: {
  send: ReactNode;
  controls: ReactNode;
  /** The composer's tucked-away choices, one tray in the footer. */
  settings?: PrintsSettingsTray | undefined;
}) {
  const items: StatusTrayItem[] = [];
  if (settings)
    items.push({
      id: "settings",
      label: settings.label,
      accessibleLabel: "Generation settings",
      title: "Settings",
      content: settings.content,
    });
  return (
    <StatusTray
      className="prints-footer"
      items={items}
      align={settings?.open ? "start" : "end"}
      openId={settings?.open ? "settings" : null}
      onOpenChange={(id) => {
        settings?.onOpenChange(id === "settings");
      }}
      leading={controls}
      trailing={send}
    />
  );
}

/**
 * The Activity panel. The window's status bar draws the Activity key; this
 * answers its click with the tray that opens above it.
 */
export function PrintsActivityTray({
  notices,
  uploads,
  open,
  inset,
  onOpenChange,
  onDismiss,
  onDismissAll,
  onLoadMore,
}: {
  notices: readonly PrintsNotice[];
  uploads?: UploadQueueProps | undefined;
  open: boolean;
  /** Where the status bar's key starts, from this tray's inline start. */
  inset?: number | undefined;
  onOpenChange: (open: boolean) => void;
  onDismiss: (key: string) => void;
  onDismissAll: () => void;
  onLoadMore?: (() => void) | undefined;
}) {
  return (
    <StatusTray
      className="prints-activity-tray"
      placement="host"
      align="start"
      {...(inset === undefined ? {} : { hostInset: inset })}
      items={[
        {
          id: "activity",
          label: "Activity",
          title: "Activity",
          content: (
            <ActivityContent
              notices={notices}
              uploads={uploads}
              onDismiss={onDismiss}
              onDismissAll={onDismissAll}
              onLoadMore={onLoadMore}
            />
          ),
        },
      ]}
      openId={open ? "activity" : null}
      onOpenChange={(id) => {
        onOpenChange(id === "activity");
      }}
    />
  );
}

function ActivityContent({
  notices,
  uploads,
  onDismiss,
  onDismissAll,
  onLoadMore,
}: {
  notices: readonly PrintsNotice[];
  uploads?: UploadQueueProps | undefined;
  onDismiss: (key: string) => void;
  onDismissAll: () => void;
  onLoadMore?: (() => void) | undefined;
}) {
  const groups = (["Setup", "Images", "Uploads"] as const)
    .map((group) => ({
      group,
      items: notices.filter((notice) => notice.group === group),
    }))
    .filter((entry) => entry.items.length);
  return (
    <div className="prints-instrument">
      {groups.map(({ group, items }) => (
        <section key={group} aria-label={group} className="prints-notice-group">
          <DataListHeading level={3}>{group}</DataListHeading>
          <StatusTrayList>
            {items.map((notice) => (
              <StatusTrayRow
                key={notice.key}
                icon={noticeIcons[notice.group]}
                primary={notice.title}
                secondary={notice.detail}
                actions={
                  <div
                    className="prints-notice-actions"
                    aria-label={`Actions for ${notice.title}`}
                  >
                    {notice.actions?.map((action) => (
                      <Button
                        key={action.label}
                        variant="ghost"
                        size="xs"
                        onClick={action.run}
                      >
                        {action.label}
                      </Button>
                    ))}
                    {!notice.blocking ? (
                      <IconButton
                        aria-label={`Dismiss ${notice.title}`}
                        icon={<X aria-hidden="true" />}
                        onClick={() => {
                          onDismiss(notice.key);
                        }}
                      />
                    ) : null}
                  </div>
                }
              />
            ))}
          </StatusTrayList>
        </section>
      ))}
      {!notices.length ? <StatusTrayNote>All caught up.</StatusTrayNote> : null}
      {uploads && uploads.items.length > 0 ? (
        <section aria-label="Upload queue" className="prints-upload-bank">
          <DataListHeading level={3}>Uploading</DataListHeading>
          <UploadQueue {...uploads} />
        </section>
      ) : null}
      <div className="prints-panel-footer">
        <span className="prints-footer-note">Clear keeps setup notices</span>
        <Button
          variant="ghost"
          size="xs"
          disabled={!notices.some((notice) => !notice.blocking)}
          onClick={onDismissAll}
        >
          Clear
        </Button>
        {onLoadMore ? (
          <Button variant="ghost" size="xs" onClick={onLoadMore}>
            Load more activity
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Where generated images are saved. The window's status bar opens it: the
 * shell draws the folder item, and Prints answers its click here.
 */
export function PrintsFolderDialog({
  folder,
}: {
  folder: ReturnType<typeof useMediaFolder>;
}) {
  return (
    <Dialog open={folder.editing} onOpenChange={folder.setEditing}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save prints to</DialogTitle>
        </DialogHeader>
        <FolderForm key={folder.computerId} folder={folder} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const folderFields = Schema.Struct({
  path: Schema.Trim.check(
    Schema.makeFilter(Schema.is(mediaLibraryPathSchema), {
      message: "Enter an absolute Computer folder, such as /media.",
    }),
  ).annotate(field({ label: "Folder", placeholder: "/media" })),
});

function FolderForm({ folder }: { folder: ReturnType<typeof useMediaFolder> }) {
  const create = useRef(false);
  const model = useSchemaForm({
    schema: folderFields,
    defaultValues: { path: folder.path ?? "/media" },
    onSubmit: async ({ path }) => {
      const error = await folder.choose(path, create.current);
      return error
        ? { kind: "refused", fields: { path: error } }
        : { kind: "saved" };
    },
  });
  const selectAction = (createFolder: boolean) => {
    create.current = createFolder;
    // A refused Use does not prevent Create or retrying the same folder.
    model.form.setFieldMeta("path", (meta) => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: undefined },
    }));
  };
  const disabled = folder.busy || !folder.writable;
  return (
    <>
      <SchemaForm
        model={model}
        disabled={disabled}
        footer={
          <FormFooter divider={false}>
            <KeycapButton
              className="[--caps-keycap-width:auto]"
              label="Use"
              type="submit"
              disabled={disabled}
              onClick={() => {
                selectAction(false);
              }}
            />
            <KeycapButton
              className="[--caps-keycap-width:auto]"
              label="Create"
              type="submit"
              disabled={disabled}
              onClick={() => {
                selectAction(true);
              }}
            />
          </FormFooter>
        }
      />
      {folder.error ? (
        <StatusTrayRow
          role="alert"
          icon={
            <Folder
              aria-hidden="true"
              className="size-[var(--stipe-icon-size-sm)]"
            />
          }
          primary={folder.error}
        />
      ) : (
        <StatusTrayNote>
          {folder.writable
            ? "Prints saves new images and uploads here and shows this folder as your gallery."
            : "This Computer is read-only for Prints, so the folder can’t change."}
        </StatusTrayNote>
      )}
    </>
  );
}
