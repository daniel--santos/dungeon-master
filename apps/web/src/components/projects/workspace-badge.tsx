import { FolderCheck, FolderX } from "lucide-react";

import type { ProjectRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { hasWorkspace, WORKSPACE_KIND } from "@/lib/workspace";

export interface WorkspaceBadgeProps {
  readonly project: ProjectRecord;
  readonly className?: string;
}

/**
 * O estado do workspace, no cabeçalho do Project.
 *
 * É a informação que decide se este Project consegue executar alguma coisa, e
 * por isso ela fica no cabeçalho e não escondida numa aba: sem `workspacePath`
 * não há onde o agente trabalhar, e toda tentativa de partir volta em `409`.
 *
 * Quando há caminho, ele aparece por inteiro — em monoespaçada e com `title`,
 * porque é o dado que o usuário confere quando desconfia de que o agente mexeu
 * no diretório errado.
 */
export function WorkspaceBadge({ project, className }: WorkspaceBadgeProps) {
  const { t, format } = useGlossary();
  const configured = hasWorkspace(project);

  return (
    <span
      className={cn(
        "border-border inline-flex max-w-full items-center gap-2 rounded-[9px] border px-2.5 py-1.5 text-[11.5px]",
        configured ? "bg-white/[0.035]" : "border-destructive/38 bg-destructive/9",
        className,
      )}
      data-workspace={configured ? "configured" : "missing"}
    >
      {configured ? (
        <FolderCheck aria-hidden className="text-muted-foreground size-3.5 flex-none" />
      ) : (
        <FolderX aria-hidden className="text-destructive size-3.5 flex-none" />
      )}

      {configured ? (
        <>
          <span className="flex-none">
            {format("Workspace configurado · {kind}", {
              kind: t(WORKSPACE_KIND[project.workspaceKind]).toLowerCase(),
            })}
          </span>
          <span
            className="text-muted-foreground min-w-0 truncate font-mono text-[11px]"
            title={project.workspacePath ?? undefined}
          >
            {project.workspacePath}
          </span>
        </>
      ) : (
        <span>
          {format("Sem workspace · {runs} indisponíveis", { runs: t("entity.run.plural") })}
        </span>
      )}
    </span>
  );
}
