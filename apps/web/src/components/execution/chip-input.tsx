import type { LucideIcon } from "lucide-react";
import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ChipInputProps {
  readonly label: string;
  readonly values: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly icon: LucideIcon;
  readonly placeholder: string;
  /** Uma dica sob a lista; vira a mensagem de recusa quando `validate` falha. */
  readonly hint?: string;
  /** Recusa o texto digitado, sem gravar. */
  readonly validate?: (value: string) => boolean;
  /** Normaliza antes de validar e gravar: maiúsculas numa variável de ambiente. */
  readonly normalize?: (value: string) => string;
  /** Monoespaçada nos chips: nomes de variáveis e comandos. */
  readonly mono?: boolean;
  readonly [attribute: `data-${string}`]: string | undefined;
}

/**
 * Uma lista curta de nomes, editada como chips.
 *
 * Nasceu na Fase 2 para Habilidades, Itens e Relíquias, que eram arrays de
 * texto livre; desde a Fase 8C esses três vêm do Arsenal por referência, e o
 * chip serve às listas que continuam sendo nomes: os comandos do perfil, os
 * nomes de variáveis de ambiente de uma Relíquia ou de um Patronato. A entrada
 * abre no lugar do botão para a linha não crescer antes de precisar.
 *
 * Repetido não entra: o array vira a lista que o harness recebe, e um nome
 * duplicado ali é ruído, não intenção. Um valor que `validate` recusa fica
 * no campo, marcado, até ser corrigido ou abandonado.
 */
export function ChipInput({
  label,
  values,
  onChange,
  icon: Icon,
  placeholder,
  hint,
  validate,
  normalize,
  mono = false,
  ...rest
}: ChipInputProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [rejected, setRejected] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = (normalize ?? ((value: string) => value))(draft.trim());
    if (trimmed !== "" && validate !== undefined && !validate(trimmed)) {
      setRejected(true);
      return;
    }
    if (trimmed !== "" && !values.includes(trimmed)) onChange([...values, trimmed]);
    setDraft("");
    setRejected(false);
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-1.5" {...rest}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className={cn(
              "border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap",
              mono && "font-mono text-[11px]",
            )}
            data-chip={value}
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
              aria-invalid={rejected}
              aria-label={placeholder}
              autoFocus
              className={cn("h-[22px] w-44 px-2 py-0 text-xs", mono && "font-mono")}
              maxLength={160}
              onBlur={() => {
                setAdding(false);
                setDraft("");
                setRejected(false);
              }}
              onChange={(event) => {
                setDraft(event.target.value);
                setRejected(false);
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
      {hint !== undefined && (
        <span
          className={cn(
            "text-[11px] leading-4",
            rejected ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
