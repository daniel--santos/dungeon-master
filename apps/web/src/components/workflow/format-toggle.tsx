import { DEFINITION_FORMATS, type DefinitionFormat } from "@/lib/workflow-editor";
import { cn } from "@/lib/utils";

const FORMAT_LABEL: Record<DefinitionFormat, string> = { yaml: "YAML", json: "JSON" };

export interface FormatToggleProps {
  readonly value: DefinitionFormat;
  readonly onChange: (format: DefinitionFormat) => void;
  readonly disabled?: boolean;
}

/**
 * O interruptor JSON / YAML do editor e do visualizador.
 *
 * Um controle segmentado, e não um `Select`: são duas opções, sempre visíveis,
 * e a troca acontece com um clique. O nome do formato não é tematizado —
 * é o nome de um formato de arquivo, nos dois modos.
 */
export function FormatToggle({ value, onChange, disabled = false }: FormatToggleProps) {
  return (
    <div
      aria-label="Formato"
      className="border-border inline-flex h-7 items-center gap-0.5 rounded-lg border p-0.5"
      role="radiogroup"
    >
      {DEFINITION_FORMATS.map((format) => {
        const on = format === value;
        return (
          <button
            key={format}
            aria-checked={on}
            className={cn(
              "flex h-6 items-center rounded-md px-2 font-mono text-[11px] tracking-[0.04em] transition-colors",
              on
                ? "bg-white/[0.09] text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "cursor-not-allowed opacity-50",
            )}
            data-format-option={format}
            disabled={disabled}
            onClick={() => {
              onChange(format);
            }}
            role="radio"
            type="button"
          >
            {FORMAT_LABEL[format]}
          </button>
        );
      })}
    </div>
  );
}
