import { ImagePlus, SlidersHorizontal, Upload, X } from "lucide-react";
import type { ReactNode } from "react";
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

import type { PrintsNotice } from "./prints-activity.js";

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
