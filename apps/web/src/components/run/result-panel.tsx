import {
  BookOpen,
  FileText,
  GitCommitHorizontal,
  ListChecks,
  Package,
  Quote,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Panel } from "@/components/panel";
import type { RunRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

const NUMBER = new Intl.NumberFormat("pt-BR");

/**
 * O resultado estruturado de uma Expedição bem-sucedida.
 *
 * `RunResult` é um objeto aberto no contrato de propósito: o schema completo de
 * `TaskExecutionResult` — artefatos, tarefas descobertas, candidatos a
 * conhecimento — chega nas Fases 5 e 6, e fechá-lo agora faria a API descartar
 * em silêncio campos que o worker já sabe produzir. Esta tela lê o que existir,
 * com a mesma disciplina do Diário: campo ausente vira estado vazio honesto, e
 * campo com forma inesperada vira o texto que dá para mostrar.
 *
 * O `status` do resultado é uma pergunta diferente do status do Run: o processo
 * pode ter terminado bem e o agente ainda reportar que o trabalho ficou
 * bloqueado. Os dois aparecem, porque confundir um com o outro é o erro que a
 * seção 36 do documento técnico previne.
 */
export function ResultPanel({ run }: { run: RunRecord }) {
  const { t, format } = useGlossary();
  const result = run.result;

  if (result === null || result === undefined) {
    return (
      <Panel className="flex flex-col gap-2 px-5 py-4.5">
        <span className="text-sm font-medium">
          {format("Resultado da {run}", { run: t("entity.run") })}
        </span>
        <p className="text-muted-foreground m-0 text-[13px] leading-5">
          {format(
            "A {run} terminou sem resultado estruturado. É por isso que a {task} foi para {failed}: a execução correu, mas ninguém consegue dizer o que ficou pronto.",
            {
              run: t("entity.run"),
              task: t("entity.task"),
              failed: t("task.status.failed"),
            },
          )}
        </p>
      </Panel>
    );
  }

  const extra = result as unknown as Record<string, unknown>;
  const artifacts = readList(extra["artifacts"]);
  const commits = readList(extra["commits"]);
  const discovered = readList(extra["discoveredTasks"]);
  const knowledge = readList(extra["knowledgeCandidates"]);
  const warnings = result.warnings ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h2 className="m-0 text-xl leading-6.5 font-semibold">
          {format("Resultado da {run}", { run: t("entity.run") })}
        </h2>
        <span className="text-muted-foreground text-[11.5px]">
          {format("veredito do agente: {status}", { status: result.status })}
        </span>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.32fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Block icon={Quote} title="Resumo">
            {result.summary === undefined || result.summary === "" ? (
              <p className="text-muted-foreground m-0 text-[13px]">
                O agente não escreveu um resumo.
              </p>
            ) : (
              <p className="text-muted-foreground m-0 text-[13px] leading-5 whitespace-pre-wrap">
                {result.summary}
              </p>
            )}
          </Block>

          <Block icon={Package} title={t("entity.artifact.plural")}>
            {artifacts.length === 0 ? (
              <Empty
                icon={Package}
                note={format(
                  "A {run} não registrou nada para guardar. A coleta de {artifacts} chega junto com o resultado completo.",
                  { run: t("entity.run"), artifacts: t("entity.artifact.plural") },
                )}
                title="Nenhum ainda"
              />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0 p-0">
                {artifacts.map((item, index) => (
                  <li
                    key={`${item.title}-${String(index)}`}
                    className="flex items-center gap-2.5 py-1.25"
                  >
                    <FileText aria-hidden className="text-muted-foreground size-3.25 flex-none" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                      {item.title}
                    </span>
                    {item.note !== null && (
                      <span className="text-muted-foreground flex-none text-[10.5px]">
                        {item.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {commits.length > 0 && (
            <Block icon={GitCommitHorizontal} title="Commits no workspace">
              <ul className="m-0 flex list-none flex-col gap-0 p-0">
                {commits.map((item, index) => (
                  <li
                    key={`${item.title}-${String(index)}`}
                    className="flex items-start gap-2.5 py-1.25"
                  >
                    <GitCommitHorizontal
                      aria-hidden
                      className="text-muted-foreground mt-0.5 size-3.25 flex-none"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[12.5px] leading-4.25">{item.title}</span>
                      {item.note !== null && (
                        <span className="text-muted-foreground font-mono text-[10.5px]">
                          {item.note}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Block
            icon={ListChecks}
            title={format("{tasks} propostas", { tasks: t("entity.task.plural") })}
          >
            {discovered.length === 0 ? (
              <Empty
                icon={ListChecks}
                note={format(
                  "A {run} não propôs desdobramentos. A decomposição automática chega na Fase 5.",
                  { run: t("entity.run") },
                )}
                title="Nenhuma ainda"
              />
            ) : (
              <SimpleList items={discovered.map((item) => item.title)} />
            )}
          </Block>

          <Block
            icon={BookOpen}
            title={format("Candidatos ao {knowledge}", { knowledge: t("entity.knowledge") })}
          >
            {knowledge.length === 0 ? (
              <Empty
                icon={BookOpen}
                note={format(
                  "O que virou aprendizado ainda mora no {timeline}. A destilação chega na Fase 6.",
                  { timeline: t("run.timeline") },
                )}
                title="Nenhum ainda"
              />
            ) : (
              <SimpleList items={knowledge.map((item) => item.title)} />
            )}
          </Block>

          {warnings.length > 0 && (
            <Block icon={TriangleAlert} title="Avisos">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {warnings.map((warning, index) => (
                  <li
                    key={`${warning}-${String(index)}`}
                    className="text-muted-foreground text-[12.5px] leading-4.5"
                  >
                    {warning}
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      </div>
    </div>
  );
}

function Block({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Panel className={cn("flex flex-col gap-2.5 px-4 pt-3.5 pb-4", className)}>
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="text-muted-foreground size-3.5" />
        <span className="text-[13px] font-medium">{title}</span>
      </div>
      {children}
    </Panel>
  );
}

function SimpleList({ items }: { items: readonly string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0 p-0">
      {items.map((item, index) => (
        <li key={`${item}-${String(index)}`} className="py-1.25 text-[12.5px] leading-4.5">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Empty({ icon: Icon, title, note }: { icon: LucideIcon; title: string; note: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.75 px-2 pt-3.5 pb-4">
      <span className="border-input text-muted-foreground flex size-8 items-center justify-center rounded-full border border-dashed">
        <Icon aria-hidden className="size-3.75" />
      </span>
      <span className="text-[12.5px]">{title}</span>
      <p className="text-muted-foreground m-0 max-w-75 text-center text-[11px] leading-4">{note}</p>
    </div>
  );
}

interface ListItem {
  readonly title: string;
  readonly note: string | null;
}

/**
 * Lê uma lista de um campo que o contrato não descreve.
 *
 * Aceita texto puro e objeto, e nos objetos procura os nomes prováveis em vez
 * de exigir um só. O pior caso é o JSON do item como texto, que é feio e
 * verdadeiro; descartar em silêncio seria bonito e mentiroso.
 */
function readList(value: unknown): readonly ListItem[] {
  if (!Array.isArray(value)) return [];

  return value.map((item): ListItem => {
    if (typeof item === "string") return { title: item, note: null };

    if (typeof item === "object" && item !== null) {
      const fields = item as Record<string, unknown>;
      const title = firstString(fields, ["path", "title", "name", "message", "summary"]);
      const note = firstString(fields, ["kind", "hash", "type", "sha"]);
      const bytes = fields["bytes"];
      const size = typeof bytes === "number" ? `${NUMBER.format(bytes)} bytes` : null;

      return {
        title: title ?? JSON.stringify(item),
        note: [note, size].filter((part) => part !== null).join(" · ") || null,
      };
    }

    return { title: String(item), note: null };
  });
}

function firstString(fields: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}
