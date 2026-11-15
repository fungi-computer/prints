import { useState, useSyncExternalStore } from "react";
import type {
  AppBackHandler,
  AppForwardHandler,
  AppNavigationActivationHandler,
  AppNavigationState,
  HostNavigation,
} from "@fungi.computer/agar";
import {
  WindowActions,
  WindowHeader,
} from "@fungi.computer/caps/components/window";

/**
 * A stand-in for the shell's window header in standalone stories: the Caps
 * WindowHeader fed by what Prints publishes, relaying crumb and command
 * activations back, so the workbench shows the chrome a real window has.
 */
export function useWorkbenchWindowHeader() {
  const [host] = useState(() => {
    let state: AppNavigationState = { canGoBack: false, canGoForward: false };
    let back: AppBackHandler | undefined;
    let forward: AppForwardHandler | undefined;
    let activate: AppNavigationActivationHandler | undefined;
    const listeners = new Set<() => void>();
    const navigation: HostNavigation = {
      publish: (next) => {
        state = next;
        for (const listener of listeners) listener();
        return Promise.resolve();
      },
      onBack: (handler) => {
        back = handler;
        return () => {
          back = undefined;
        };
      },
      onForward: (handler) => {
        forward = handler;
        return () => {
          forward = undefined;
        };
      },
      onActivate: (handler) => {
        activate = handler;
        return () => {
          activate = undefined;
        };
      },
    };
    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    function Header() {
      const current = useSyncExternalStore(subscribe, () => state);
      return (
        <WindowHeader
          title="Prints"
          popover={document.body}
          actions={
            <WindowActions
              title="Prints"
              floating
              onToggleFloating={() => undefined}
              onClose={() => undefined}
            />
          }
          {...(current.crumbs === undefined ? {} : { crumbs: current.crumbs })}
          {...(current.primary === undefined
            ? {}
            : { primary: current.primary })}
          {...(current.menu === undefined ? {} : { menu: current.menu })}
          {...(current.status === undefined ? {} : { status: current.status })}
          {...(current.canGoBack || current.canGoForward
            ? {
                back: {
                  label: "Back in Prints",
                  disabled: !current.canGoBack,
                  onBack: () => {
                    void back?.();
                  },
                },
                forward: {
                  label: "Forward in Prints",
                  disabled: !current.canGoForward,
                  onForward: () => {
                    void forward?.();
                  },
                },
              }
            : {})}
          onCrumb={(crumbId, siblingId) => {
            void activate?.(
              siblingId === undefined
                ? { kind: "crumb", crumbId }
                : { kind: "crumb", crumbId, siblingId },
            );
          }}
          onAction={(actionId) => {
            void activate?.({ kind: "action", actionId });
          }}
        />
      );
    }
    return { navigation, Header };
  });
  return host;
}
