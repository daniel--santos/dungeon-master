import { Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormatToggle } from "@/components/workflow/format-toggle";
import type { WorkflowRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { useHydratedForm } from "@/lib/hydrated-form";
import {
  convertDefinitionText,
  describeIssueLocation,
  mapDefinitionIssues,
  parseDefinitionText,
  stringifyDefinition,
  toDefinitionBody,
  type DefinitionFormat,
  type DefinitionIssue,
} from "@/lib/workflow-editor";
import { exampleDefinition } from "@/lib/workflow-example";
import {
  DefinitionError,
  useCreateWorkflow,
  useUpdateWorkflow,
  useWorkflows,
} from "@/lib/workflows";

export interface WorkflowEditorDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Presente na edição: o texto abre com a definição vigente e o salvar é um PUT. */
  readonly workflow?: WorkflowRecord;
  readonly onSaved?: (workflow: WorkflowRecord) => void;
}

/**
 * Criar e editar um Ritual por texto (Fase 4C).
 *
 * Sem editor visual, por decisão: a definição é um documento, e o documento é
 * o que se edita. JSON ou YAML, à escolha; a API só recebe JSON, e a conversão
 * acontece no clique de salvar. Um `422` volta como lista, com o step e o
 * campo que cada issue aponta — é para isso que a API devolve `errors[]` em
 * vez de um "definição inválida".
 *
 * O texto nasce a cada abertura, porque reabrir o diálogo de criação com o
 * rascunho anterior enviaria um Workflow que ninguém pediu.
 */
export function WorkflowEditorDialog({
  open,
  onOpenChange,
  workflow,
  onSaved,
}: WorkflowEditorDialogProps) {
  const { t, format: fmt } = useGlossary();
  const workflows = useWorkflows();
  const create = useCreateWorkflow();
  const update = useUpdateWorkflow();

  const [parseError, setParseError] = useState<string | null>(null);
  const [issues, setIssues] = useState<readonly DefinitionIssue[]>([]);

  const editing = workflow !== undefined;
  const pending = create.isPending || update.isPending;

  // O texto nasce na abertura, e não a cada identidade nova do Workflow: com o
  // diálogo aberto sobre a tela de detalhe, qualquer invalidação de
  // `["workflows"]` relê o registro, e reescrever a `<textarea>` apagaria uma
  // definição inteira digitada à mão.
  const server = useMemo(
    () => ({
      format: "yaml" as DefinitionFormat,
      text: workflow === undefined ? "" : stringifyDefinition(workflow.definition, "yaml"),
    }),
    [workflow],
  );
  const { value, set: setForm } = useHydratedForm(
    server,
    open ? (workflow?.id ?? "novo") : "closed",
  );
  const { format, text } = value ?? server;

  useEffect(() => {
    if (!open) return;
    setParseError(null);
    setIssues([]);
  }, [open]);

  function setText(next: string) {
    setForm((current) => ({ ...current, text: next }));
  }

  function changeFormat(next: DefinitionFormat) {
    const converted = convertDefinitionText(text, format, next);
    if (converted === null) {
      // O texto atual não é legível no formato de origem: o formato troca e
      // o texto fica como está, para nada do que foi escrito se perder.
      setParseError(
        `O texto não pôde ser convertido: ele não é ${format.toUpperCase()} válido. O formato foi trocado sem converter.`,
      );
      setForm((current) => ({ ...current, format: next }));
    } else {
      setForm({ format: next, text: converted });
      setParseError(null);
    }
  }

  function fillExample() {
    const example = exampleDefinition(
      workflows.data?.items ?? [],
      fmt("{run} guiada", { run: t("entity.run") }),
    );
    setText(stringifyDefinition(example, format));
    setParseError(null);
    setIssues([]);
  }

  function save() {
    const parsed = parseDefinitionText(text, format);
    if (!parsed.ok) {
      setParseError(parsed.message);
      setIssues([]);
      return;
    }

    const body = toDefinitionBody(parsed.value);
    if (body === null) {
      setParseError("A definição precisa de um `name` e de uma lista `steps`.");
      setIssues([]);
      return;
    }

    setParseError(null);
    setIssues([]);

    const onError = (error: Error) => {
      if (error instanceof DefinitionError) {
        setIssues(mapDefinitionIssues(error.issues, parsed.value));
        return;
      }
      // Nome já usado é `409`, e vem com o motivo em `detail`.
      toast.error(error.message);
    };

    const onSuccess = (saved: WorkflowRecord) => {
      onOpenChange(false);
      onSaved?.(saved);
    };

    if (workflow === undefined) {
      create.mutate(body, { onSuccess, onError });
    } else {
      update.mutate({ id: workflow.id, definition: body }, { onSuccess, onError });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? fmt("Editar {workflow}", { workflow: t("entity.workflow") })
              : fmt("Novo {workflow}", { workflow: t("entity.workflow") })}
          </DialogTitle>
          <DialogDescription>
            {fmt(
              "A definição é um documento: nome, descrição e os {steps}, com dependências, condições e o {gate}. Escreva em YAML ou JSON; a API recebe JSON.",
              { steps: t("entity.workflowStep.plural"), gate: t("entity.approvalGate") },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="workflow-definition">Definição</Label>
          <div className="flex items-center gap-2">
            <FormatToggle disabled={pending} onChange={changeFormat} value={format} />
            <Button disabled={pending} onClick={fillExample} size="xs" variant="outline">
              <Sparkles aria-hidden />
              <span>Usar o exemplo</span>
            </Button>
          </div>
        </div>

        <Textarea
          aria-invalid={parseError !== null || issues.length > 0 ? true : undefined}
          className="max-h-[56vh] min-h-[360px] font-mono text-[12px] leading-4.5 md:text-[12px]"
          data-definition-format={format}
          id="workflow-definition"
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder={
            format === "yaml"
              ? "name: …\nsteps:\n  - type: agent\n    key: analyze\n    name: …\n    prompt: …"
              : '{\n  "name": "…",\n  "steps": []\n}'
          }
          spellCheck={false}
          value={text}
        />

        {(parseError !== null || issues.length > 0) && (
          <div
            className="border-destructive/40 bg-destructive/8 flex flex-col gap-1.5 rounded-[10px] border px-3 py-2.5"
            data-definition-errors
            role="alert"
          >
            <span className="text-destructive flex items-center gap-1.5 text-[12.5px] font-medium">
              <TriangleAlert aria-hidden className="size-3.5" />
              <span>
                {parseError !== null
                  ? "O texto não pôde ser lido"
                  : fmt("A API recusou a definição ({n})", { n: issues.length })}
              </span>
            </span>
            {parseError !== null && (
              <p className="text-muted-foreground m-0 text-[12px] leading-4.5">{parseError}</p>
            )}
            {issues.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {issues.map((issue, index) => (
                  <li
                    key={`${issue.field}-${String(index)}`}
                    className="flex items-start gap-2 text-[12px] leading-4.5"
                    data-definition-issue={issue.stepKey ?? ""}
                  >
                    <code className="border-border text-foreground flex-none rounded-md border bg-white/[0.07] px-1.5 py-px font-mono text-[10.5px]">
                      {describeIssueLocation(issue)}
                    </code>
                    <span className="text-muted-foreground min-w-0">{issue.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <span className="text-muted-foreground self-center text-[11px] leading-4">
            {editing
              ? fmt("{runs} já criadas continuam na versão que congelaram.", {
                  runs: t("entity.run.plural"),
                })
              : fmt("Nenhuma versão nasce agora: a primeira é congelada na primeira {run}.", {
                  run: t("entity.run"),
                })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={text.trim() === "" || pending} onClick={save} type="button">
              {editing ? "Salvar" : "Criar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
