import { correlationKey } from "@fungi.computer/cairn";
import type { StoryDefault } from "@ladle/react";
import { createQueryClient } from "@fungi.computer/agar/query";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MediaPane } from "../src/MediaPane.js";
import { createPrintsFixture, type CaptureOptions } from "./fixtures.js";
import { fixtureNotices } from "./notice-store.js";
import { useWorkbenchStatusBar } from "./status-bar.fixture.js";
import "./workbench.css";
export default { title: "Prints" } satisfies StoryDefault;
function Workbench({
  scenario,
  generationDelayMs,
  beforeRead,
  finishGeneration,
}: {
  scenario: Parameters<typeof createPrintsFixture>[0] | "disconnected";
  generationDelayMs?: number;
  beforeRead?: CaptureOptions["beforeRead"];
  finishGeneration?: CaptureOptions["finishGeneration"];
}) {
  const [navigation, setNavigation] = useState("");
  const [imageReads, setImageReads] = useState(0);
  const [download, setDownload] = useState("");
  const statusBar = useWorkbenchStatusBar();
  const [client] = useState(createQueryClient);
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  const [connection] = useState(() => {
    if (scenario === "disconnected") return null;
    const options: NonNullable<Parameters<typeof createPrintsFixture>[3]> = {
      noticeStore: fixtureNotices,
      status: statusBar.status,
      onRead: () => {
        setImageReads((count) => count + 1);
      },
    };
    if (generationDelayMs !== undefined)
      options.generationDelayMs = generationDelayMs;
    if (beforeRead !== undefined) options.beforeRead = beforeRead;
    if (finishGeneration !== undefined)
      options.finishGeneration = finishGeneration;
    if (scenario === "viewer-images") {
      options.requestBrowserAction = (action) => {
        if (action.kind !== "saveFile")
          throw new Error("Viewer fixture expects a file save");
        setDownload(
          `${action.name} (${action.mime}; ${String(action.bytes.byteLength)} bytes)`,
        );
        return Promise.resolve({ kind: "saved" as const });
      };
    }
    return {
      app: createPrintsFixture(
        scenario,
        setNavigation,
        "prints-workbench",
        options,
      ),
    };
  });
  return (
    <div className="prints-study" data-image-reads={imageReads}>
      <div className="prints-study-note">
        Real Prints UI · local fixture ·{" "}
        <a href="https://unsplash.com" target="_blank" rel="noreferrer">
          Unsplash
        </a>{" "}
        samples, not AI output · no generation charges.
        {navigation ? (
          <output> Open in editor requested: {navigation}</output>
        ) : null}
        {download ? (
          <output data-viewer-download> Download requested: {download}</output>
        ) : null}
      </div>
      <div className="prints-study-surface">
        <QueryClientProvider client={client}>
          <MediaPane connection={connection} />
        </QueryClientProvider>
        {statusBar.bar}
      </div>
    </div>
  );
}
export const Studio = () => <Workbench scenario="studio" />;
/** Forty deterministic pictures for viewer geometry and virtualised return focus. */
export const ViewerImages = () => <Workbench scenario="viewer-images" />;
/** A two-second local MP4 between ready pictures; no external media requests. */
export const ViewerVideo = () => <Workbench scenario="viewer-video" />;
/** A decoded 2048×1536 PNG and native video for actual-size/fit transitions. */
export const ViewerActualSize = () => (
  <Workbench scenario="viewer-actual-size" />
);
/** Actual generation reservation/clock/completion, using the local MP4 fixture. */
export const ViewerLifecycle = () => (
  <Workbench scenario="viewer-video" generationDelayMs={15_000} />
);
/** A real stored video record with a restorable attempt, auto-resumed by Prints. */
export function ViewerResumed() {
  const [completion] = useState(() => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { finish, wait: () => pending };
  });
  return (
    <>
      <div className="prints-study-note">
        Fixture producer control:
        <button
          type="button"
          data-fixture-generation="complete"
          onClick={completion.finish}
        >
          Complete fixture generation
        </button>
      </div>
      <Workbench
        scenario="viewer-resumed"
        generationDelayMs={0}
        finishGeneration={completion.wait}
      />
    </>
  );
}
/** Real Computer read rejection and a held response; only the producer is controlled. */
export function ViewerReads() {
  const [producer] = useState(() => {
    let failed = true;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      beforeRead: async (path: string) => {
        if (path === "/media/print-01.png" && failed)
          throw new Error("Fixture Computer read is unavailable");
        if (path === "/media/print-02.png") await pending;
      },
      restore: () => {
        failed = false;
      },
      release,
    };
  });
  return (
    <>
      <div className="prints-study-note">
        Fixture Computer controls:
        <button
          type="button"
          data-fixture-read="restore"
          onClick={producer.restore}
        >
          Restore failed read
        </button>
        <button
          type="button"
          data-fixture-read="release"
          onClick={producer.release}
        >
          Finish held read
        </button>
      </div>
      <Workbench scenario="viewer-images" beforeRead={producer.beforeRead} />
    </>
  );
}
export const Empty = () => <Workbench scenario="empty" />;
export const Retry = () => <Workbench scenario="retry" />;
export const Unavailable = () => <Workbench scenario="unavailable" />;
export const Disconnected = () => <Workbench scenario="disconnected" />;

export const CheckingFolder = () => <Workbench scenario="folder-loading" />;
export const MissingFolder = () => <Workbench scenario="folder-missing" />;
export const ChooseFolder = () => <Workbench scenario="folder-unselected" />;
export const FolderNotWritable = () => <Workbench scenario="folder-readonly" />;
export const GalleryLoading = () => <Workbench scenario="gallery-loading" />;

export const ImagesLoading = () => <Workbench scenario="images-loading" />;

export const FirstRun = () => <Workbench scenario="folder-unselected" />;

export const ImagesProgressive = () => (
  <Workbench scenario="images-progressive" />
);

/** A host navigate request selects an output beyond the first directory page. */
export function GillNavigate() {
  const [client] = useState(createQueryClient);
  const [fixture] = useState(() => {
    const app = createPrintsFixture("gill-navigate", () => undefined);
    let context = app.context.get();
    const listeners = new Set<(value: typeof context) => void>();
    return {
      connection: {
        app: {
          ...app,
          context: {
            get: () => context,
            subscribe: (listener: (value: typeof context) => void) => {
              listeners.add(listener);
              return () => {
                listeners.delete(listener);
              };
            },
          },
        },
      },
      open: () => {
        context = {
          ...context,
          openRequest: {
            kind: "navigate",
            requestId: correlationKey(),
            params: [{ key: "print", value: "fixture-last-output" }],
          },
        };
        for (const listener of listeners) listener(context);
      },
    };
  });
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  return (
    <div className="prints-study">
      <div className="prints-study-note">
        <button type="button" onClick={fixture.open}>
          Open fixture Gill output
        </button>{" "}
        · Local fixture, no generation charges.
      </div>
      <div className="prints-study-surface">
        <QueryClientProvider client={client}>
          <MediaPane connection={fixture.connection} />
        </QueryClientProvider>
      </div>
    </div>
  );
}
