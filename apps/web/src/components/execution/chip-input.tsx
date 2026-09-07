import type { LucideIcon } from "lucide-react";
import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";

export interface ChipInputProps {
  readonly label: string;
  readonly values: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly icon: LucideIcon;
  readonly placeholder: string;
}

/**
 * Uma lista curta de nomes, editada como chips.
 *
 * Habilidades, Itens e Relíquias são arrays de texto livre no contrato, e o
 * canvas os desenha como chips com um "Adicionar" tracejado no fim. A entrada
 * abre no lugar do botão para a linha não crescer antes de precisar.
 *
 * Repetido não entra: o array vira a lista que o harness recebe, e um nome
 * duplicado ali é ruído, não intenção.
 */
export function ChipInput({ label, values, onChange, icon: Icon, placeholder }: ChipInputProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed !== "" && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap"
          >
            <Icon aria-hidden className="text-muted-foreground size-3.5" strokeWidth={1.5} />
            <span>{value}</span>
            <button
              aria-label={`Remover ${value}`}
              className="text-muted-foreground hover:text-foreground -mr-1 flex size-4 items-center justify-center rounded"
              onClick={() => {
                onChange(values.filter((item) => item !== value));
              }}
              type="button"
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        ))}

        {adding ? (
          <form onSubmit={submit}>
            <Input
              aria-label={placeholder}
              autoFocus
              className="h-[22px] w-44 px-2 py-0 text-xs"
              maxLength={120}
              onBlur={() => {
                setAdding(false);
                setDraft("");
              }}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              placeholder={placeholder}
              value={draft}
            />
          </form>
        ) : (
          <button
            className="border-input text-muted-foreground hover:text-foreground inline-flex h-[22px] items-center gap-1 rounded-lg border border-dashed px-2 text-xs"
            onClick={() => {
              setAdding(true);
            }}
            type="button"
          >
            <Plus aria-hidden className="size-3" />
            <span>{placeholder}</span>
          </button>
        )}
      </div>
    </div>
  );
}
