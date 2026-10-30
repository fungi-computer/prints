import { ComposerModelKey } from "@fungi.computer/parakeet";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { modelName, type MediaModel } from "./generation-model.js";

/** The generation model's native row key and single-choice menu. */
export function GenerationModelKey({
  disabled,
  emptyLabel,
  models,
  onChange,
  value,
}: {
  disabled: boolean;
  emptyLabel: string;
  models: readonly MediaModel[];
  onChange: (id: string) => void;
  value: string;
}) {
  const selected = models.find((model) => model.id === value);
  const [menuContainer, setMenuContainer] = useState<HTMLSpanElement | null>(
    null,
  );
  return (
    <span className="contents" ref={setMenuContainer}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Generation model"
          data-generation-model={value}
          disabled={disabled || models.length === 0}
          render={(props, state) => (
            <ComposerModelKey
              {...props}
              expanded={state.open}
              label={selected === undefined ? emptyLabel : modelName(selected)}
            />
          )}
        />
        <DropdownMenuContent
          data-generation-model-menu
          // Keep the native menu in this key's tray scope: model selection must
          // not light-dismiss an already open Settings tray.
          container={menuContainer}
          side="top"
          align="start"
          aria-label="Generation models"
        >
          {models.map((model) => (
            <DropdownMenuCheckboxItem
              key={model.id}
              data-generation-model-option={model.id}
              checked={model.id === value}
              closeOnClick
              onSelect={() => {
                onChange(model.id);
              }}
            >
              {modelName(model)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
