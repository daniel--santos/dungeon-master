import { Check, Copy, FileCode2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Panel } from "@/components/panel";
import { FormatToggle } from "@/components/workflow/format-toggle";
import type { WorkflowDefinitionBody } from "@/lib/api-types";
import { stringifyDefinition, type DefinitionFormat } from "@/lib/workflow-editor";

export interface DefinitionTextProps {
  readonly definition: WorkflowDefinitionBody;
  /** O que a faixa de topo mostra à direita: o botão de editar, quando houver. */
  readonly action?: React.ReactNode;
}

/**
 * A definição de um Ritual como texto, somente leitura.
 *
 * O formato é escolha de quem lê: YAML para ler, JSON para colar em outro
 * lugar. O botão de copiar existe pelo mesmo motivo do `CopyRow` do cockpit —
 * a próxima coisa que alguém faz com uma definição é levá-la para um editor.
 */
export function DefinitionText({ definition, action }: DefinitionTextProps) {
  const [format, setFormat] = useState<DefinitionFormat>("yaml");
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => stringifyDefinition(definition, format), [definition, format]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1_500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden" data-definition-text={format}>
      <div className="border-border flex h-11 flex-none items-center justify-between gap-3 border-b px-4">
        <div className="flex items-center gap-2">
          <FileCode2 aria-hidden className="text-muted-foreground size-3.75" />
          <span className="text-sm font-medium">Definição</span>
        </div>
        <div className="flex items-center gap-2">
          <FormatToggle onChange={setFormat} value={format} />
          <button
            aria-label="Copiar definição"
            className="text-muted-foreground hover:text-foreground border-border flex size-7 items-center justify-center rounded-lg border"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(
                () => {
                  setCopied(true);
                },
                () => {
                  // Clipboard bloqueado não é erro: o texto continua na tela.
                },
              );
            }}
            type="button"
          >
            {copied ? (
              <Check aria-hidden className="size-3.25" />
            ) : (
              <Copy aria-hidden className="size-3.25" />
            )}
          </button>
          {action}
        </div>
      </div>
      <pre className="m-0 max-h-[520px] overflow-auto px-4 py-3 font-mono text-[11.5px] leading-4.5 whitespace-pre">
        {text}
      </pre>
    </Panel>
  );
}
