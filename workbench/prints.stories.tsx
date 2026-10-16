import { correlationKey } from "@fungi.computer/cairn";
import type { StoryDefault } from "@ladle/react";
import { createQueryClient } from "@fungi.computer/agar/query";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MediaPane } from "../src/MediaPane.js";
import { createPrintsFixture } from "./fixtures.js";
import { fixtureNotices } from "./notice-store.js";
import { useWorkbenchStatusBar } from "./status-bar.fixture.js";
import "./workbench.css";
export default { title: "Prints" } satisfies StoryDefault;
function Workbench({
  scenario,
}: {
  scenario: Parameters<typeof createPrintsFixture>[0] | "disconnected";
}) {
  const [navigation, setNavigation] = useState("");
  const [imageReads, setImageReads] = useState(0);
  const statusBar = useWorkbenchStatusBar();
  const [client] = useState(createQueryClient);
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  const [connection] = useState(() =>
    scenario === "disconnected"
      ? null
      : {
          app: createPrintsFixture(
            scenario,
            setNavigation,
            "prints-workbench",
            {
              noticeStore: fixtureNotices,
              status: statusBar.status,
              onRead: () => {
                setImageReads((count) => count + 1);
              },
            },
          ),
        },
  );
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
