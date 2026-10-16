import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppContext } from "@fungi.computer/agar/react";
import { capabilityQuery, queryKeys } from "@fungi.computer/agar/query";
import { appMethods } from "@fungi.computer/agar/backend";
import * as z from "zod";
import { printRecordSchema } from "./print-record-schema.js";
import type { MediaConnection } from "./media-gallery.js";

// The receiver needs only the identity and location from openOutput's byte reply.
const outputLocation = z.object({
  printId: printRecordSchema.shape.printId,
  path: z.string().startsWith("/").min(2).max(4096),
});

/** Resolve a Gill's output identity in this window's admitted Computer. */
export function usePrintNavigation(
  connection: MediaConnection | null,
  load: (
    path: string,
    action: "add",
    connection: MediaConnection,
    computerId: string,
  ) => Promise<void>,
) {
  const app = connection?.app ?? null;
  const context = useAppContext(app);
  const request = context?.openRequest;
  const computerId = context?.computerId;
  const param =
    request?.kind === "navigate"
      ? request.params.find((entry) => entry.key === "print")
      : undefined;
  const decoded = printRecordSchema.shape.printId.safeParse(param?.value);
  const printId = decoded.success ? decoded.data : null;
  const requestId = request?.kind === "navigate" ? request.requestId : null;
  const requestScope = useRef({ app, requestId, computerId });
  if (
    requestScope.current.app !== app ||
    requestScope.current.requestId !== requestId
  ) {
    requestScope.current = { app, requestId, computerId };
  }
  const sameComputer = requestScope.current.computerId === computerId;
  const lookup = useQuery({
    ...capabilityQuery(
      app,
      appMethods,
      queryKeys.of(app, "prints", "navigate", computerId, requestId, printId),
      async (methods, signal) => {
        if (!app || !computerId || !printId || !requestId)
          throw new Error("No print selected");
        // Ask for one byte instead of paging through the gallery or transferring
        // the whole image twice. The host admits the current Computer scope.
        const reply = await methods.call(
          "openOutput",
          JSON.stringify({ printId, byteLength: 1 }),
        );
        signal.throwIfAborted();
        if (app.context.get().computerId !== computerId)
          throw new Error("Computer selection changed");
        const location = outputLocation.parse(reply);
        if (location.printId !== printId)
          throw new Error("Print selection changed");
        return { path: location.path, requestId, computerId };
      },
    ),
    enabled: Boolean(
      app &&
      sameComputer &&
      computerId &&
      requestId &&
      printId &&
      app.capabilities.has(appMethods),
    ),
    retry: false,
    staleTime: Infinity,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const loaded = useRef<typeof lookup.data>(undefined);
  useEffect(() => {
    const target = lookup.data;
    if (
      !connection ||
      !target ||
      loaded.current === target ||
      connection.app.context.get().computerId !== target.computerId
    )
      return;
    loaded.current = target;
    void loadRef.current(target.path, "add", connection, target.computerId);
  }, [connection, lookup.data]);
  return { target: lookup.data ?? null, error: lookup.error };
}
