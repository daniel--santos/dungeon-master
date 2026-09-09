import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus, Trash2, WandSparkles } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
import { RegistryHeader } from "@/components/registry/registry-header";
import { SkillCreateDialog } from "@/components/registry/skill-create-dialog";
import { Button } from "@/components/ui/button";
import type { SkillRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useDeleteSkill, useSkills } from "@/lib/registry";
import { REGISTRY_COLOR } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/skills/")({
  component: SkillsPage,
});

/**
 * As Habilidades do Arsenal (Fase 8C): a lista, com a versão mais recente de
 * cada uma e o caminho para a página dela.
 *
 * A lista não edita: o nome, a descrição, o texto e as versões moram em
 * `/skills/:id`, porque uma Habilidade é um documento com histórico, e não
 * uma linha de formulário.
 */
function SkillsPage() {
  const { t, format } = useGlossary();
  const navigate = useNavigate();
  const skills = useSkills();
  const remove = useDeleteSkill();

  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<SkillRecord | null>(null);

  const items = skills.data?.items ?? [];

  return (
    <>
      <RegistryHeader
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus aria-hidden />
            <span>{t("skill.create.title")}</span>
          </Button>
        }
        tab="skills"
      />

      <Panel className="flex flex-col px-5 pt-4 pb-3.5">
        <div className="flex items-center justify-between gap-4 pb-1.5">
          <div className="flex items-center gap-2">
            <WandSparkles aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
            <span className="text-sm font-medium">{t("entity.skill.plural")}</span>
          </div>
          <span className="text-muted-foreground text-xs">
            {format("{n} cadastradas", { n: items.length })}
          </span>
        </div>
        <p className="text-muted-foreground m-0 pb-2 text-[12.5px] leading-5">
          {t("skill.description")}
        </p>

        {skills.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
        {skills.error !== null && (
          <p className="text-destructive py-6 text-sm">{skills.error.message}</p>
        )}

        {!skills.isPending && skills.error === null && items.length === 0 && (
          <EmptyState
            action={
              <Button
                onClick={() => {
                  setCreating(true);
                }}
                size="sm"
                variant="outline"
              >
                <Plus aria-hidden />
                <span>{t("skill.create.title")}</span>
              </Button>
            }
            icon={WandSparkles}
            title={format("Nenhuma {skill} ainda", { skill: t("entity.skill") })}
          >
            {t("skill.list.empty")}
          </EmptyState>
        )}

        {items.map((skill, index) => (
          <div
            key={skill.id}
            className={cn("flex items-center gap-3 py-3", index > 0 && "border-border border-t")}
            data-skill={skill.name}
          >
            <span className="border-border flex size-8 flex-none items-center justify-center rounded-lg border bg-[oklch(0.72_0.13_305)]/12">
              <WandSparkles aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Link
                className="flex w-fit items-center gap-1 text-[13px] font-medium underline-offset-2 hover:underline"
                params={{ id: skill.id }}
                to="/skills/$id"
              >
                <span>{skill.name}</span>
                <ChevronRight aria-hidden className="text-muted-foreground size-3" />
              </Link>
              <span className="text-muted-foreground truncate text-xs leading-4.5">
                {skill.description === null || skill.description === ""
                  ? "Sem descrição."
                  : skill.description}
              </span>
            </div>

            <span
              className="text-muted-foreground flex-none font-mono text-[10.5px]"
              data-skill-latest-version={skill.latestVersion}
              title={t("skill.latestVersion")}
            >
              {`v${String(skill.latestVersion)}`}
            </span>
            <span className="text-muted-foreground w-24 flex-none text-right text-[11px]">
              {relativeTime(skill.updatedAt)}
            </span>

            <Button
              aria-label={`Excluir ${skill.name}`}
              className="text-muted-foreground hover:text-destructive flex-none"
              onClick={() => {
                setRemoving(skill);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
      </Panel>

      <SkillCreateDialog
        onCreated={(skill) => {
          void navigate({ to: "/skills/$id", params: { id: skill.id } });
        }}
        onOpenChange={setCreating}
        open={creating}
      />

      <DeleteRegistryDialog
        action={format("Apagar {skill}", { skill: t("entity.skill") })}
        body={t("skill.delete.body")}
        data-skill-delete-dialog=""
        done={t("skill.delete.done")}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing}
        title={t("skill.delete.title")}
      />
    </>
  );
}
