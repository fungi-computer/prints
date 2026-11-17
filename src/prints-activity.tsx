import { ImagePlus, SlidersHorizontal, Upload, X } from "lucide-react";
import type { ReactNode } from "react";
import {
  statusText,
  type AppStatusItem,
  type AppStatusTone,
} from "@fungi.computer/agar";
import { Button } from "@fungi.computer/caps/components/button";
import { IconButton } from "@fungi.computer/caps/components/icon-button";
import { DataListHeading } from "@fungi.computer/caps/components/data-list";
import {
  StatusTray,
  StatusTrayList,
  StatusTrayNote,
  StatusTrayRow,
} from "@fungi.computer/caps/blocks/status-tray";
import {
  UploadQueue,
  type UploadQueueProps,
} from "@fungi.computer/caps/blocks/upload-queue";

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
                primary={
                  <span className="prints-notice-copy">
                    <span>{notice.title}</span>
                    {notice.detail ? (
                      <span className="prints-notice-detail">
                        {notice.detail}
                      </span>
                    ) : null}
                  </span>
                }
                actions={
                  <div
                    className="prints-notice-actions"
                    aria-label={`Actions for ${notice.title}`}
                  >
                    {notice.actions?.map((action, index) => (
                      <Button
                        key={action.label}
                        variant={index === 0 ? "outline" : "ghost"}
                        size={index === 0 ? "sm" : "xs"}
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
        <span className="prints-footer-note">
          Clear dismisses finished items
        </span>
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
