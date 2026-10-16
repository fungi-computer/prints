import type { StoryDefault } from "@ladle/react";
import { createQueryClient } from "@fungi.computer/agar/query";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MediaPane } from "../src/MediaPane.js";
import { createPrintsFixture, type CaptureOptions } from "./fixtures.js";
import { fixtureNotices } from "./notice-store.js";
import { useWorkbenchStatusBar } from "./status-bar.fixture.js";
import "./workbench.css";
export default { title: "Activity" } satisfies StoryDefault;
function ActivityWorkbench({
  scenario = "studio",
  opt = {},
}: {
  scenario?: "studio" | "empty" | "retry" | "unavailable";
  opt?: CaptureOptions;
}) {
  const [billingOpen, setBillingOpen] = useState(false);
  const statusBar = useWorkbenchStatusBar();
  const [client] = useState(createQueryClient);
  useEffect(
    () => () => {
      client.clear();
    },
    [client],
  );
  const [connection] = useState(() => ({
    app: createPrintsFixture(scenario, () => undefined, "prints-workbench", {
      ...opt,
      noticeStore: fixtureNotices,
      status: statusBar.status,
      openTeamBilling: () => {
        setBillingOpen(true);
        return Promise.resolve();
      },
    }),
  }));
  return (
    <div className="prints-study">
      {billingOpen ? (
        <output aria-label="Workbench host action">Billing opened</output>
      ) : null}
      <div className="prints-study-surface">
        <QueryClientProvider client={client}>
          <MediaPane connection={connection} />
        </QueryClientProvider>
        {statusBar.bar}
      </div>
    </div>
  );
}
export const NoComputer = () => (
  <ActivityWorkbench scenario="empty" opt={{ computerSelected: false }} />
);
export const NoCredit = () => (
  <ActivityWorkbench scenario="empty" opt={{ insufficientCredits: true }} />
);
export const Empty = () => <ActivityWorkbench scenario="empty" />;
export const Studio = () => <ActivityWorkbench />;
export const GalleryPages = () => (
  <ActivityWorkbench opt={{ imageCopies: 5 }} />
);
export const NoFolder = () => (
  <ActivityWorkbench scenario="empty" opt={{ folder: null }} />
);
export const FolderMissing = () => (
  <ActivityWorkbench opt={{ folder: "/media", folderExists: false }} />
);
export const NotApproved = () => (
  <ActivityWorkbench opt={{ canGenerate: false }} />
);
export const NoMediaAccess = () => (
  <ActivityWorkbench opt={{ mediaGen: false }} />
);
export const ReadOnly = () => <ActivityWorkbench opt={{ writable: false }} />;
export const ModelsError = () => (
  <ActivityWorkbench opt={{ modelsError: true }} />
);
export const GenerateError = () => (
  <ActivityWorkbench opt={{ fail: "error" }} />
);
export const Retry = () => <ActivityWorkbench scenario="retry" />;
export const Unfinished = () => <ActivityWorkbench opt={{ pending: true }} />;
export const UploadFails = () => (
  <ActivityWorkbench opt={{ writeFails: true }} />
);

/** The proof decides when the write finishes, independent of host load. */
export function ControlledUpload() {
  const [write] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  });
  return (
    <>
      <ActivityWorkbench opt={{ finishUpload: () => write.promise }} />
      <button
        type="button"
        style={{ position: "fixed", top: 8, right: 8 }}
        onClick={() => {
          write.resolve();
        }}
      >
        Finish fixture upload
      </button>
    </>
  );
}

export const Mixed = () => (
  <ActivityWorkbench opt={{ pending: true, modelsError: true }} />
);

export const LongLabel = () => (
  <ActivityWorkbench opt={{ pending: true, canGenerate: false }} />
);
