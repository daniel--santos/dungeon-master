import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGlossary } from "@/lib/glossary";

export interface NumberFieldProps {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** O texto digitado, e não o número: o aviso aparece antes de virar número. */
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly min: number;
  readonly max: number;
  readonly invalid: boolean;
  readonly suffix: string;
  /** O bloco a que o campo pertence: vira o `data-<bloco>-field` que os testes leem. */
  readonly prefix: "knowledge" | "context";
  readonly testId: string;
}

/**
 * Um inteiro com intervalo, para os blocos de Settings.
 *
 * O valor é texto até o envio: gravar a cada tecla mandaria "1" antes de
 * "15", e um intervalo violado precisa aparecer na tela antes do `PUT`, que
 * é onde o schema da chave o recusaria de qualquer jeito.
 */
export function NumberField({
  id,
  label,
  description,
  value,
  onChange,
  min,
  max,
  invalid,
  suffix,
  prefix,
  testId,
}: NumberFieldProps) {
  const { format } = useGlossary();
  const fieldAttr = `data-${prefix}-field`;
  const errorAttr = `data-${prefix}-field-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium" htmlFor={id}>
        {label}
      </Label>
      <span className="text-muted-foreground text-[13px] leading-5">{description}</span>
      <div className="flex items-center gap-2">
        <Input
          aria-invalid={invalid}
          className="w-28 font-mono"
          id={id}
          inputMode="numeric"
          max={max}
          min={min}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          type="number"
          value={value}
          {...{ [fieldAttr]: testId }}
        />
        <span className="text-muted-foreground text-[12.5px]">{suffix}</span>
      </div>
      {invalid && (
        <span className="text-destructive text-[12px]" {...{ [errorAttr]: testId }}>
          {format("Um inteiro entre {min} e {max}.", { min, max })}
        </span>
      )}
    </div>
  );
}
