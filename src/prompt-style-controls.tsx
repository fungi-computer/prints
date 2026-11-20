import { Select } from "@fungi.computer/caps/components/select";
import type { PromptStyle } from "./prompt-styles.js";

/** The style that leads the prompt: a plain choice among the saved styles. */
export function PromptStyleSelect({
  id,
  styles,
  selected,
  disabled,
  onSelect,
}: {
  /** Set by a surrounding Caps Field so its label names this control. */
  id?: string | undefined;
  styles: readonly PromptStyle[];
  selected: string | undefined;
  disabled: boolean;
  onSelect: (name: string | undefined) => void;
}): React.JSX.Element {
  const known =
    selected === undefined || styles.some((s) => s.name === selected);
  return (
    <Select
      id={id}
      aria-label="Prompt style"
      data-generation-style
      className="select-sm"
      disabled={disabled}
      onChange={(event) => {
        onSelect(event.currentTarget.value || undefined);
      }}
      value={selected ?? ""}
    >
      <option value="">No style</option>
      {known ? null : <option value={selected}>{selected}</option>}
      {styles.map((style) => (
        <option key={style.id} value={style.name}>
          {style.name}
        </option>
      ))}
    </Select>
  );
}
