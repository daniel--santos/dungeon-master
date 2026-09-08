import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { useWorkflows } from "@/lib/workflows";

/** O Radix recusa `value=""`, então "nenhum" precisa de um valor próprio. */
const NONE = "__none__";

export interface WorkflowSelectProps {
  readonly id?: string;
  /** `null` é o Run simples, de um agente só. */
  readonly value: string | null;
  readonly onChange: (workflowId: string | null) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Nenhum ou um Ritual para a Task.
 *
 * A lista vem inteira: é cadastro pequeno, e um seletor paginado seria uma
 * cerimônia. "Nenhum" é a primeira opção porque é o padrão da Task, e o texto
 * dela diz o que isso significa em vez de deixar um vazio.
 */
export function WorkflowSelect({ id, value, onChange, disabled, className }: WorkflowSelectProps) {
  const { t } = useGlossary();
  const workflows = useWorkflows();
  const items = workflows.data?.items ?? [];

  return (
    <Select
      disabled={disabled}
      onValueChange={(next) => {
        onChange(next === NONE ? null : next);
      }}
      value={value ?? NONE}
    >
      <SelectTrigger
        aria-label={t("entity.workflow")}
        className={cn("w-full", className)}
        data-workflow-select
        id={id}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("workflow.none")}</SelectItem>
        {items.length > 0 && <SelectSeparator />}
        {items.map((workflow) => (
          <SelectItem key={workflow.id} value={workflow.id}>
            {workflow.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
