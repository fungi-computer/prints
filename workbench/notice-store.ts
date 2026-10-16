import * as Schema from "effect/Schema";
import { mediaNoticesSchema } from "../src/media-settings.js";

/** Durable fake of the App backend for workbench reloads only. Production uses SQL. */
export async function fixtureNotices(
  computerId: string,
  dismissed: readonly string[] = [],
) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("prints-workbench-notices", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("computers");
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(
        new Error("Workbench notice storage failed", { cause: request.error }),
      );
    };
    request.onblocked = () => {
      reject(new Error("Workbench notice storage is blocked"));
    };
  });
  try {
    return await new Promise<{ keys: readonly string[] }>((resolve, reject) => {
      const transaction = database.transaction("computers", "readwrite");
      const store = transaction.objectStore("computers");
      const read = store.get(computerId);
      let keys: readonly string[] = [];
      read.onsuccess = () => {
        const stored: unknown = read.result;
        const previous =
          stored === undefined
            ? []
            : Schema.decodeUnknownSync(mediaNoticesSchema)(stored).keys;
        keys = [...new Set([...previous, ...dismissed])].slice(-200);
        store.put({ keys }, computerId);
      };
      transaction.oncomplete = () => {
        resolve({ keys });
      };
      transaction.onerror = () => {
        reject(
          new Error("Workbench notice transaction failed", {
            cause: transaction.error,
          }),
        );
      };
      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error("Workbench notice write aborted"),
        );
      };
    });
  } finally {
    database.close();
  }
}
