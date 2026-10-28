import type {
  AppRoot,
  AppStatusActionHandler,
  AppStatusItem,
} from "@fungi.computer/agar";
import {
  AppStatusBar,
  AppStatusItem as StatusReadout,
} from "@fungi.computer/caps/blocks/app-status-bar";
import { Button } from "@fungi.computer/caps/components/button";
import { CountBadge } from "@fungi.computer/caps/components/count-badge";
import { Status } from "@fungi.computer/caps/components/status";
import { useState } from "react";

/**
 * A stand-in for the shell's window status bar in standalone stories: it
 * draws the App's declared text and button items and returns their clicks.
 */
export function useWorkbenchStatusBar() {
  const [items, setItems] = useState<readonly AppStatusItem[]>([]);
  const [channel] = useState(() => {
    let handler: AppStatusActionHandler | undefined;
    const status: Pick<AppRoot["ui"], "reportStatus" | "onStatusAction"> = {
      reportStatus: (next) => {
        setItems(next);
        return Promise.resolve();
      },
      onStatusAction: (next) => {
        handler = next;
        return () => {
          if (handler === next) handler = undefined;
        };
      },
    };
    return { status, act: (itemId: string) => handler?.({ itemId }) };
  });
  const bar = (
    <AppStatusBar aria-label="Workbench window status">
      {items.map((item) =>
        item.kind === "button" ? (
          <Button
            key={item.id}
            size="xs"
            variant="ghost"
            title={item.title}
            data-status-item={item.id}
            {...(item.expanded === undefined
              ? {}
              : { "aria-expanded": item.expanded })}
            onClick={() => {
              void channel.act(item.id);
            }}
          >
            {item.tone !== undefined || item.busy === true ? (
              <Status
                size="compact"
                aria-hidden="true"
                tone={item.tone ?? "accent"}
                motion={item.busy === true ? "pulse" : "none"}
              />
            ) : null}
            {item.text}
            {item.count !== undefined && item.count > 0 ? (
              <CountBadge count={item.count} />
            ) : null}
          </Button>
        ) : (
          <StatusReadout key={item.id}>{item.text}</StatusReadout>
        ),
      )}
    </AppStatusBar>
  );
  return { status: channel.status, bar };
}
