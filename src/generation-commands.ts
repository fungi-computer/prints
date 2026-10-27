import type { AppCommand, AppRoot, Disposer } from "@fungi.computer/agar";
import * as Schema from "effect/Schema";
import { z } from "zod";
import type { GenerationDraft, MediaModel } from "./generation-model.js";

const draftPatchSchema = Schema.Struct({
  destination: Schema.optionalKey(Schema.NullOr(Schema.String)),
  height: Schema.optionalKey(Schema.Int),
  model: Schema.optionalKey(Schema.String),
  prompt: Schema.optionalKey(Schema.String),
  references: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        role: Schema.optionalKey(
          Schema.Literals(["first-frame", "last-frame", "reference"]),
        ),
      }),
    ),
  ),
  generateAudio: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  steps: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  style: Schema.optionalKey(Schema.NullOr(Schema.String)),
  width: Schema.optionalKey(Schema.Int),
});
const draftPatchInputSchema = z.record(z.string(), z.json()).parse(
  structuredClone(
    Schema.toJsonSchemaDocument(draftPatchSchema, {
      onExcessProperty: "error",
    }).schema,
  ),
);
type CommandInputSchema = NonNullable<
  NonNullable<AppCommand["action"]>["inputSchema"]
>;

const command = (
  id: string,
  title: string,
  description: string,
  inputSchema?: CommandInputSchema,
): AppCommand => {
  const action =
    inputSchema === undefined
      ? { presentation: { type: "action" as const } }
      : { inputSchema, presentation: { type: "action" as const } };
  return {
    id,
    title,
    category: "Image generation",
    description,
    projections: { agent: {} },
    action,
  };
};

const inspectCommand = command(
  "inspect-generation-draft",
  "Inspect image draft",
  "Read the current Prints image form and available models",
);
const setDraftCommand = command(
  "set-generation-draft",
  "Edit image draft",
  "Set selected Prints image form fields; this does not generate an image",
  draftPatchInputSchema,
);
const submitCommand = command(
  "submit-generation-draft",
  "Generate image",
  "Submit the current Prints image form using the same action as the Send button",
);

export type GenerationCommandBinding = Readonly<{
  readDraft: () => GenerationDraft;
  readModels: () => readonly MediaModel[];
  setDraft: (patch: Schema.Schema.Type<typeof draftPatchSchema>) => void;
  submit: () => Promise<boolean>;
}>;

/** One App mount contributes its live image form to Whistle's Agent projection. */
export function registerGenerationCommands(
  app: Pick<AppRoot, "commands">,
  binding: GenerationCommandBinding,
): Disposer {
  let disposed = false;
  const releases = new Set<Disposer>();
  const register = (
    definition: AppCommand,
    handler: Parameters<AppRoot["commands"]["register"]>[1],
  ) => {
    void app.commands.register(definition, handler).then(
      (release) => {
        if (disposed) release();
        else releases.add(release);
      },
      () => undefined,
    );
  };

  register(inspectCommand, () => {
    if (disposed) return undefined;
    const draft = binding.readDraft();
    return {
      draft: {
        destination: draft.destination ?? null,
        height: draft.height,
        model: draft.model,
        prompt: draft.prompt,
        generateAudio: draft.generateAudio ?? null,
        references: draft.references.map((reference) => ({
          path: reference.path,
          role: reference.role ?? null,
        })),
        steps: draft.steps ?? null,
        style: draft.style ?? null,
        width: draft.width,
      },
      models: binding.readModels().map((model) => ({
        id: model.id,
        label: model.label,
        defaultHeight: model.input.defaultHeight,
        defaultWidth: model.input.defaultWidth,
        maxReferences: model.input.maxReferences,
      })),
    };
  });
  register(setDraftCommand, ({ arguments: input }) => {
    if (disposed) return undefined;
    const patch = Schema.decodeUnknownSync(draftPatchSchema, {
      onExcessProperty: "error",
    })(input);
    binding.setDraft(patch);
    return undefined;
  });
  register(submitCommand, async () => {
    if (disposed) return undefined;
    return { accepted: await binding.submit() };
  });

  return () => {
    if (disposed) return;
    disposed = true;
    for (const release of releases) release();
    releases.clear();
  };
}
