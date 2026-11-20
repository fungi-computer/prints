import {
  statusText,
  type AppStatusItem,
  type AppStatusTone,
} from "@fungi.computer/agar";

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
