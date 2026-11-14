import { useState } from "react";
import type { AppRoot } from "@fungi.computer/agar";
import {
  mediaShare,
  type MediaShareHandle,
  type MediaShareStatus,
} from "@fungi.computer/agar/media";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
import { DataRow } from "@fungi.computer/caps/components/data-list";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { Switch } from "@fungi.computer/caps/components/switch";
import { Sigil } from "@fungi.computer/sigils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link } from "lucide-react";

const shareKey = (app: AppRoot | null, printId: string) =>
  queryKeys.of(app, "prints", "share", printId);

type Change =
  | Readonly<{ kind: "share"; showPrompt: boolean }>
  /** A live page keeps what it showed: a new choice is a new link. */
  | Readonly<{ kind: "reshare"; showPrompt: boolean }>
  | Readonly<{ kind: "stop" }>;

async function change(
  handle: MediaShareHandle,
  printId: string,
  next: Change,
): Promise<MediaShareStatus> {
  if (next.kind === "stop") return handle.stop(printId);
  if (next.kind === "reshare") await handle.stop(printId);
  return handle.share({ requestId: printId, showPrompt: next.showPrompt });
}

/**
 * The public link of one generated Print: off until its owner turns it on,
 * the prompt shown only when they choose, and off again at any time. Two
 * fact rows in the details panel, so it reads like the facts above it.
 */
export function PrintShareRows({
  app,
  printId,
}: {
  app: AppRoot;
  printId: string;
}) {
  const client = useQueryClient();
  const key = shareKey(app, printId);
  const [showPrompt, setShowPrompt] = useState(true);
  const [copied, setCopied] = useState(false);
  const status = useQuery({
    ...capabilityQuery(app, mediaShare, key, (handle) =>
      handle.status(printId),
    ),
    enabled: app.capabilities.has(mediaShare),
  });
  const update = useMutation({
    mutationFn: (next: Change) =>
      change(app.capabilities.require(mediaShare), printId, next),
    onSuccess: (next) => {
      client.setQueryData(key, next);
      setCopied(false);
    },
  });
  const shared = status.data?.shared === true ? status.data : null;
  const prompted = shared === null ? showPrompt : shared.showPrompt;
  const busy = status.isPending || update.isPending;
  return (
    <>
      <DataRow>
        <span className="prints-info-label">
          <Sigil name="connected" size={16} />
          Share
        </span>
        <span className="prints-info-value prints-share-value">
          <Switch
            aria-label="Public link"
            checked={shared !== null}
            disabled={busy || status.isError}
            onCheckedChange={(on) => {
              update.mutate(
                on ? { kind: "share", showPrompt } : { kind: "stop" },
              );
            }}
          />
          {shared === null ? (
            <span className="prints-share-note">Only your Team can see it</span>
          ) : (
            <KeycapButton
              density="compact"
              label={copied ? "Copied" : "Copy link"}
              icon={copied ? <Check /> : <Link />}
              onClick={() => {
                void navigator.clipboard.writeText(shared.url).then(
                  () => {
                    setCopied(true);
                  },
                  () => {
                    setCopied(false);
                  },
                );
              }}
            />
          )}
        </span>
      </DataRow>
      <DataRow>
        <span className="prints-info-label">
          <Sigil name="sendPrompts" size={16} />
          On page
        </span>
        <span className="prints-info-value prints-share-value">
          <Switch
            aria-label="Show the prompt on the public page"
            checked={prompted}
            disabled={busy || status.isError}
            onCheckedChange={(on) => {
              setShowPrompt(on);
              if (shared !== null)
                update.mutate({ kind: "reshare", showPrompt: on });
            }}
          />
          <span className="prints-share-note">
            {prompted ? "Print and prompt" : "Print only"}
          </span>
        </span>
      </DataRow>
      {update.isError || status.isError ? (
        <DataRow>
          <span role="alert" className="text-sm">
            Sharing is unavailable right now. Try again.
          </span>
        </DataRow>
      ) : null}
    </>
  );
}
