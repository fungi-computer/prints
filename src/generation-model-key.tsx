import { ComposerModelKey } from "@fungi.computer/parakeet";
import { KeycapButton } from "@fungi.computer/caps/components/keycap";
import { ChevronDown, Cpu } from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@fungi.computer/caps/components/dropdown-menu";
import { menuContainerFor } from "./menu-container.js";
import { modelName, type MediaModel } from "./generation-model.js";

/** The generation model's native row key and single-choice menu. */
export function GenerationModelKey({
  compact = false,
  disabled,
  emptyLabel,
  models,
  onChange,
  value,
}: {
  /** An icon-only key for phones; the name stays in its tooltip and the menu. */
  compact?: boolean;
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
          render={(props, state) => {
            const name =
              selected === undefined ? emptyLabel : modelName(selected);
            return compact ? (
              <KeycapButton
                {...props}
                className="parakeet-composer-model-key"
                expanded={state.open}
                icon={<Cpu />}
                label={null}
                readout={
                  <ChevronDown
                    aria-hidden="true"
                    className="size-[var(--stipe-icon-size-sm)] shrink-0"
                  />
                }
                title={name}
              />
            ) : (
              <ComposerModelKey {...props} expanded={state.open} label={name} />
            );
          }}
        />
        <DropdownMenuContent
          data-generation-model-menu
          // Keep the native menu in this key's tray scope: model selection must
          // not light-dismiss an already open Settings tray.
          container={menuContainerFor(menuContainer)}
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
