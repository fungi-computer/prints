import { defaultMediaLibraryPath } from "../library-folder.js";
import { completeGenerationRequestSchema } from "../src/media-completion-contract.js";
import { DEFAULT_MODEL_ID } from "../src/generation-model.js";
import type {
  MediaGenerationAttemptHandle,
  MediaGenerationOutcome,
} from "@fungi.computer/agar/media";
import { appBackend, appMethods } from "@fungi.computer/agar/backend";
import * as Schema from "effect/Schema";
import * as z from "zod";
import {
  mediaRecoveryRequestSchema,
  normalizePendingGeneration,
  type PendingGeneration,
} from "../src/media-recovery-contract.js";
import {
  mediaNoticeRequestSchema,
  mediaSettingsRequestSchema,
} from "../src/media-settings.js";
import {
  BUILT_IN_STYLES,
  promptStyleRequestSchema,
  type PromptStyle,
} from "../src/prompt-styles.js";
import {
  promptCharacterRequestSchema,
  type PromptCharacter,
} from "../src/prompt-characters.js";
import {
  mediaGeneration,
  type AppRoot,
  createCapabilityRegistry,
  inertHostNavigation,
} from "@fungi.computer/agar";
import {
  computerList,
  computerReadFile,
  computerWriteFile,
} from "@fungi.computer/agar/computer";
import { listMediaModels } from "@fungi.computer/darkroom";
import { RpcStub, RpcTarget } from "@fungi.computer/capnweb";

// Unsplash sample photography. Workbench-only; never a product gallery or generated output claim.
const samples = [
  {
    name: "alpine-lake",
    photo: "photo-1464822759023-fed622ff2c3b",
    width: 960,
    height: 640,
  },
  {
    name: "forest-light",
    photo: "photo-1441974231531-c6227db76b6e",
    width: 640,
    height: 900,
  },
  {
    name: "coast",
    photo: "photo-1476514525535-07fb3b4ae5f1",
    width: 960,
    height: 640,
  },
  {
    name: "desert",
    photo: "photo-1509316785289-025f5b846b35",
    width: 720,
    height: 900,
  },
  {
    name: "night-sky",
    photo: "photo-1462331940025-496dfbfc7564",
    width: 960,
    height: 640,
  },
  {
    name: "mountain-air",
    photo: "photo-1454496522488-7a8e488e8606",
    width: 720,
    height: 900,
  },
];
export type Scenario =
  | "studio"
  | "empty"
  | "retry"
  | "unavailable"
  | "folder-loading"
  | "folder-missing"
  | "folder-unselected"
  | "folder-readonly"
  | "gallery-loading"
  | "images-loading"
  | "images-progressive"
  | "gill-navigate";
export type CaptureOptions = {
  onRead?: (path: string) => void;
  imageCopies?: number;
  noticeStore?: (
    computerId: string,
    keys?: readonly string[],
  ) => Promise<{ keys: readonly string[] }>;
  folder?: string | null;
  folderExists?: boolean;
  canGenerate?: boolean;
  writable?: boolean;
  mediaGen?: boolean;
  fail?: "error" | null;
  pending?: boolean;
  modelsError?: boolean;
  computerSelected?: boolean;
  insufficientCredits?: boolean;
  openTeamBilling?: AppRoot["ui"]["openTeamBilling"];
  /** The window's status bar; a story without a shell drops its items. */
  status?: Pick<AppRoot["ui"], "reportStatus" | "onStatusAction">;
  writeFails?: boolean;
  finishUpload?: () => Promise<void>;
};
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(
        new Error("Fixture generation was cancelled", { cause: signal.reason }),
      );
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(
        new Error("Fixture generation was cancelled", { cause: signal.reason }),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
async function photograph(
  photo: string,
  width: number,
  height: number,
): Promise<Blob> {
  const response = await fetch(
    `https://images.unsplash.com/${photo}?fit=crop&w=${String(width)}&h=${String(height)}&q=80&fm=jpg`,
  );
  if (!response.ok) throw new Error("Unsplash sample could not be loaded");
  return response.blob();
}

const outputPathRequest = z.object({ path: z.string() });

/** Typed local implementations of the same Agar capabilities supplied by the host. */
export function createPrintsFixture(
  scenario: Scenario,
  onNavigate: (path: string) => void,
  computerId = "prints-workbench",
  opt: CaptureOptions = {},
): AppRoot {
  const dismissed = new Map<string, readonly string[]>();
  const noticeStore =
    opt.noticeStore ??
    ((id: string, keys: readonly string[] = []) => {
      const merged = [
        ...new Set([...(dismissed.get(id) ?? []), ...keys]),
      ].slice(-200);
      dismissed.set(id, merged);
      return Promise.resolve({ keys: merged });
    });
  const files = new Map<string, () => Promise<Blob>>();
  // Release the initial sample set together so network timing is not layout data.
  let photographs: Promise<Blob[]> | undefined;
  const readPhotographs = () =>
    (photographs ??= Promise.all(
      samples.map((sample) =>
        photograph(sample.photo, sample.width, sample.height),
      ),
    ));
  if (
    scenario === "studio" ||
    scenario === "retry" ||
    scenario === "unavailable"
  )
    for (const [index, sample] of samples.entries()) {
      for (let copy = 0; copy < (opt.imageCopies ?? 1); copy += 1) {
        const name =
          copy === 0 ? sample.name : `${sample.name}-${String(copy)}`;
        files.set(
          `/media/${name}.jpg`,
          async () => (await readPhotographs())[index],
        );
      }
    }
  if (scenario === "images-loading" || scenario === "images-progressive") {
    for (let index = 0; index < 24; index += 1) {
      const extension =
        scenario === "images-progressive" && index === 0 ? "svg" : "png";
      const path = `/media/print-${String(index).padStart(2, "0")}.${extension}`;
      files.set(path, () => {
        opt.onRead?.(path);
        if (scenario === "images-progressive" && index === 0)
          return Promise.resolve(
            new Blob(
              [
                '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#7ab8a4"/><circle cx="200" cy="180" r="110" fill="#edd8ac"/><path d="M0 340L140 190L270 340L400 240V400H0Z" fill="#415e65"/></svg>',
              ],
              { type: "image/svg+xml" },
            ),
          );
        return new Promise<Blob>(() => undefined);
      });
    }
  }
  if (scenario === "gill-navigate") {
    for (let index = 0; index < 48; index += 1) {
      files.set(`/media/print-${String(index).padStart(2, "0")}.svg`, () =>
        Promise.resolve(
          new Blob(
            [
              `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${index === 47 ? "#edd8ac" : "#7ab8a4"}"/><circle cx="200" cy="140" r="100" fill="#415e65"/><text x="20" y="280" fill="white" font-size="28">Print ${String(index)}</text></svg>`,
            ],
            { type: "image/svg+xml" },
          ),
        ),
      );
    }
  }
  const capabilities = createCapabilityRegistry();
  const register = capabilities.provide;
  const folders = new Set(scenario === "folder-missing" ? [] : ["/media"]);
  let mediaFolder: string | null =
    opt.folder === undefined
      ? scenario === "folder-unselected" || scenario === "folder-readonly"
        ? null
        : "/media"
      : opt.folder;
  if (opt.folderExists === false) folders.clear();
  const pendingGenerations = new Map<string, PendingGeneration>();
  const savedStyles: PromptStyle[] = [
    {
      id: 1,
      name: "Storybook gouache",
      text: "Gouache storybook illustration with soft edges and a warm palette.",
      builtIn: false,
    },
  ];
  const styleList = () => ({ styles: [...BUILT_IN_STYLES, ...savedStyles] });
  const savedCharacters: PromptCharacter[] = [
    {
      id: 1,
      name: "Mira",
      description: "a tall girl with silver hair and a red scarf",
      references: [{ path: "/media/forest-light.jpg" }],
    },
    {
      id: 2,
      name: "Kenji",
      description: "a quiet boy in a blue raincoat",
      references: [
        { path: "/media/alpine-lake.jpg" },
        { path: "/media/coast.jpg" },
      ],
    },
  ];
  const characterList = () => ({ characters: [...savedCharacters] });
  if (opt.pending)
    pendingGenerations.set("fixture-old-1", {
      reference: { requestId: "fixture-old-1", computerId },
      input: {
        destination: { path: "/media/print-2026-10-06-mushroom-knight.png" },
        settings: {
          model: DEFAULT_MODEL_ID,
          prompt: "a mushroom knight",
          width: 1024,
          height: 768,
        },
      },
      typed: { prompt: "a mushroom knight", references: 0 },
    });
  register(appMethods, {
    call: (method, input) =>
      method === "getOutput" && scenario === "studio"
        ? Promise.resolve({
            print: {
              kind: "image",
              model: "openai/gpt-image-2",
              width: 1024,
              height: 1024,
              steps: null,
              createdAt: Date.UTC(2026, 9, 26, 14, 30),
            },
            typed: {
              prompt: "@Mira and @Kenji waiting at a bus stop in the rain",
              references: 1,
            },
            path: outputPathRequest.parse(JSON.parse(input)).path,
            references: [
              { path: "/media/coast.jpg", printId: null },
              { path: "/media/forest-light.jpg", printId: null },
              { path: "/media/alpine-lake.jpg", printId: null },
            ],
            characters: ["Mira", "Kenji"],
          })
        : method === "openOutput" && scenario === "gill-navigate"
          ? Promise.resolve({
              printId: "fixture-last-output",
              path: "/media/print-47.svg",
              byteOffset: 0,
              content: "PA==",
              encoding: "base64",
              truncated: true,
            })
          : Promise.reject(new Error("No matching fixture output")),
  });
  register(appBackend, {
    request: (input) => {
      const command = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Union([
            mediaNoticeRequestSchema,
            promptStyleRequestSchema,
            promptCharacterRequestSchema,
            mediaSettingsRequestSchema,
            mediaRecoveryRequestSchema,
            completeGenerationRequestSchema,
          ]),
        ),
        { onExcessProperty: "error" },
      )(input);
      switch (command.operation) {
        case "read-notices":
          return noticeStore(command.computerId);
        case "dismiss-notices":
          return noticeStore(command.computerId, command.keys);
        case "list-styles":
          return Promise.resolve(styleList());
        case "save-style": {
          const index = savedStyles.findIndex(
            (style) => style.id === command.id,
          );
          const style = {
            id:
              command.id ??
              Math.max(0, ...savedStyles.map((saved) => saved.id)) + 1,
            name: command.name,
            text: command.text,
            builtIn: false,
          };
          if (index === -1) savedStyles.push(style);
          else savedStyles[index] = style;
          return Promise.resolve(styleList());
        }
        case "delete-style": {
          const index = savedStyles.findIndex(
            (style) => style.id === command.id,
          );
          if (index !== -1) savedStyles.splice(index, 1);
          return Promise.resolve(styleList());
        }
        case "read-print-style":
          return Promise.resolve({
            style: scenario === "studio" ? "Storybook gouache" : null,
          });
        case "list-characters":
          return Promise.resolve(characterList());
        case "save-character": {
          const index = savedCharacters.findIndex(
            (character) => character.id === command.id,
          );
          const character = {
            id:
              command.id ??
              Math.max(0, ...savedCharacters.map((saved) => saved.id)) + 1,
            name: command.name,
            description: command.description,
            references: command.references,
          };
          if (index === -1) savedCharacters.push(character);
          else savedCharacters[index] = character;
          return Promise.resolve(characterList());
        }
        case "delete-character": {
          const index = savedCharacters.findIndex(
            (character) => character.id === command.id,
          );
          if (index !== -1) savedCharacters.splice(index, 1);
          return Promise.resolve(characterList());
        }
        case "remember-generation": {
          const record = normalizePendingGeneration(command.record);
          const previous = pendingGenerations.get(record.reference.requestId);
          if (previous && JSON.stringify(previous) !== JSON.stringify(record))
            return Promise.reject(
              new Error("Generation reference already has another input"),
            );
          pendingGenerations.set(record.reference.requestId, record);
          return Promise.resolve(record);
        }
        case "complete-generation": {
          pendingGenerations.delete(command.reference.requestId);
          return Promise.resolve({
            printId: command.reference.requestId,
            computerId: command.reference.computerId,
          });
        }
        case "forget-generation": {
          const previous = pendingGenerations.get(command.reference.requestId);
          if (previous?.reference.computerId === command.reference.computerId)
            pendingGenerations.delete(command.reference.requestId);
          return Promise.resolve({ removed: true });
        }
        case "list-generations": {
          const records = [...pendingGenerations.values()]
            .filter(
              (record) => record.reference.requestId > (command.after ?? ""),
            )
            .sort((a, b) =>
              a.reference.requestId.localeCompare(b.reference.requestId),
            );
          return Promise.resolve({ records, next: null });
        }
        case "select-folder":
          mediaFolder = command.path;
          break;
        case "read-folder":
          if (scenario === "folder-loading")
            return new Promise<{ path: string; configured: boolean }>(
              () => undefined,
            );
          break;
      }
      return Promise.resolve({
        path: mediaFolder ?? defaultMediaLibraryPath,
        configured: mediaFolder !== null,
      });
    },
  });
  if (opt.computerSelected !== false) {
    register(computerList, {
      list: ({ path, limit, offset }) => {
        if (scenario === "gallery-loading" && limit !== 1)
          return new Promise<{
            path: string;
            entries: readonly never[];
            nextOffset: null;
          }>(() => undefined);
        if (!folders.has(path))
          return Promise.reject(new Error("Folder missing"));
        const entries = [...files.keys()]
          .filter((name) => name.startsWith(`${path.replace(/\/$/, "")}/`))
          .map((name) => ({
            name: name.split("/").at(-1) ?? name,
            type: "file" as const,
            size: 0,
            modifiedAt: 0,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return Promise.resolve({
          path,
          entries: entries.slice(offset, offset + limit),
          nextOffset: offset + limit < entries.length ? offset + limit : null,
        });
      },
    });
    register(computerReadFile, {
      open: ({ path }) =>
        Promise.resolve(
          new RpcStub(
            new (class extends RpcTarget {
              async response() {
                const read = files.get(path);
                return Object.assign(
                  new Response(read ? await read() : null, {
                    status: read ? 200 : 404,
                  }),
                  {
                    [Symbol.dispose]() {
                      /* In-memory response has no remote resource. */
                    },
                  },
                );
              }
              close() {
                /* Local sample fetch owns no host operation. */
              }
            })(),
          ),
        ),
    });
  }
  if (
    opt.writable !== false &&
    opt.computerSelected !== false &&
    scenario !== "folder-readonly"
  )
    register(computerWriteFile, {
      mkdir: ({ path }) => {
        folders.add(path);
        return Promise.resolve();
      },
      replace: async ({ path, expectedContent, content }) => {
        if (opt.writeFails)
          throw new Error(
            "Fixture: the Computer refused the write (disk full).",
          );
        const read = files.get(path);
        if (read === undefined) return { kind: "conflict" };
        const current = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(await (await read()).arrayBuffer());
        if (current !== expectedContent || files.get(path) !== read)
          return { kind: "conflict" };
        const replacement = new Blob([content], {
          type: "text/plain;charset=utf-8",
        });
        files.set(path, () => Promise.resolve(replacement));
        return { kind: "replaced", path, bytes: replacement.size };
      },
      open: ({ path }) =>
        Promise.resolve(
          new RpcStub(
            new (class extends RpcTarget {
              async write(content: ReadableStream<Uint8Array>) {
                if (opt.writeFails) {
                  await new Promise((r) => setTimeout(r, 600));
                  throw new Error(
                    "Fixture: the Computer refused the write (disk full).",
                  );
                }
                const blob = await new Response(content).blob();
                if (opt.finishUpload) await opt.finishUpload();
                else await new Promise((resolve) => setTimeout(resolve, 1200));
                files.set(path, () => Promise.resolve(blob));
              }
              close() {
                /* The in-memory write has already settled. */
              }
            })(),
          ),
        ),
    });
  const attempts = new Map<string, MediaGenerationAttemptHandle>();
  const generations = new Map<string, AbortController>();
  if (
    scenario !== "unavailable" &&
    opt.mediaGen !== false &&
    opt.computerSelected !== false
  )
    register(mediaGeneration, {
      describe: () =>
        opt.modelsError
          ? Promise.reject(
              new Error(
                "Fixture: the Media model registry could not be reached.",
              ),
            )
          : Promise.resolve({
              computerId,
              canGenerate: opt.canGenerate ?? true,
              models: listMediaModels(),
            }),
      restoreAttempt: (reference) => {
        const attempt = attempts.get(reference.requestId);
        if (reference.computerId !== computerId || attempt === undefined)
          return Promise.reject(new Error("Fixture generation is unavailable"));
        return Promise.resolve(attempt);
      },
      cancelAttempt: (reference) => {
        if (reference.computerId !== computerId)
          return Promise.reject(new Error("Fixture Computer does not match"));
        generations.get(reference.requestId)?.abort();
        return Promise.resolve();
      },
      createAttempt: () => {
        const requestId = `fixture-generation-${String(attempts.size + 1)}`;
        const controller = new AbortController();
        generations.set(requestId, controller);
        let tries = 0;
        const attempt: MediaGenerationAttemptHandle = {
          reference: () => Promise.resolve({ requestId, computerId }),
          async generate(input) {
            await pause(1800, controller.signal);
            tries += 1;
            if (opt.insufficientCredits)
              return {
                kind: "failed",
                failure: {
                  code: "INSUFFICIENT_CREDIT",
                  message:
                    "Media generation needs Team credits. Add credits in Billing, then retry.",
                  retryable: false,
                },
              } satisfies MediaGenerationOutcome;
            if (opt.fail === "error")
              return {
                kind: "failed" as const,
                failure: {
                  code: "HOST_FAILURE" as const,
                  message: "Fixture: the model rejected this prompt.",
                  retryable: false,
                },
              };
            if (scenario === "retry" && tries === 1)
              return {
                kind: "failed" as const,
                failure: {
                  code: "HOST_FAILURE" as const,
                  message:
                    "Fixture: saving was interrupted. Retry this same generation.",
                  retryable: true,
                },
              };
            const blob = await photograph(
              samples[0].photo,
              input.settings.width,
              input.settings.height,
            );
            files.set(input.destination.path, () => Promise.resolve(blob));
            return {
              kind: "succeeded" as const,
              result: {
                destination: { computerId, path: input.destination.path },
                model: input.settings.model,
                width: input.settings.width,
                height: input.settings.height,
                bytes: blob.size,
                costMilliunits: 0,
                format: "jpeg" as const,
              },
            };
          },
        };
        attempts.set(requestId, attempt);
        return Promise.resolve(attempt);
      },
    });
  const context: ReturnType<AppRoot["context"]["get"]> = {
    computerId: opt.computerSelected === false ? null : computerId,
    focus: { editing: false, surface: null },
    openRequest: null,
    visibility: "visible",
  };
  return {
    capabilities,
    commands: { register: () => Promise.resolve(() => undefined) },
    context: {
      get: () => context,
      subscribe: () => () => undefined,
    },
    identity: { appId: "media", releaseId: "workbench", surfaceId: "prints" },
    lifecycle: { get: () => "connected", subscribe: () => () => undefined },
    theme: { get: () => "latte", subscribe: () => () => undefined },
    window: {
      onBeforeClose: () => () => undefined,
      navigation: inertHostNavigation,
    },
    ui: {
      openNavigation: ({ path }) => {
        onNavigate(path);
        return Promise.resolve();
      },
      reportStatus: opt.status?.reportStatus ?? (() => Promise.resolve()),
      onStatusAction: opt.status?.onStatusAction ?? (() => () => undefined),
      requestAppPermissions: () => Promise.resolve("declined" as const),
      openTeamBilling: opt.openTeamBilling ?? (() => Promise.resolve()),
      requestComputerChoice: () => Promise.reject(new Error("No picker")),
      requestBrowserAction: () => {
        throw new Error("Unexpected browser action");
      },
      openDesktopSettings: () => Promise.resolve(),
      reportAgentSessionSelection: () => Promise.resolve(),
      showToast: () => Promise.resolve(),
    },
    dispose() {
      /* Story-local data is released with this fixture. */
    },
  };
}
