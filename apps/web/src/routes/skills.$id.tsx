import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  GitCompareArrows,
  History,
  Pencil,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Panel } from "@/components/panel";
import { DeleteRegistryDialog } from "@/components/registry/delete-registry-dialog";
import { SkillDiff } from "@/components/registry/skill-diff";
import { SkillPublishDialog } from "@/components/registry/skill-publish-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SkillDetailRecord, SkillVersionRecord } from "@/lib/api-types";
import { formatDateTime, relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useDeleteSkill, useSkill, useSkillVersions, useUpdateSkill } from "@/lib/registry";
import { REGISTRY_COLOR } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/skills/$id")({
  component: SkillDetailPage,
});

function SkillDetailPage() {
  const { id } = Route.useParams();
  const { t } = useGlossary();
  const skill = useSkill(id);

  if (skill.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (skill.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-destructive text-sm">{skill.error.message}</p>
        <Link className="text-sm underline underline-offset-2" to="/skills">
          {t("entity.skill.plural")}
        </Link>
      </div>
    );
  }

  return <Detail skill={skill.data} />;
}

/**
 * Uma Habilidade (Fase 8C): o texto da versão corrente, as versões, a
 * comparação entre duas delas, publicar e apagar.
 *
 * O texto vai à tela como texto, com as quebras preservadas: é markdown que
 * o Herói recebe, escrito pelo usuário, e nunca é interpretado aqui. Nome e
 * descrição editam em linha (`PATCH`); o texto não se edita — publica-se
 * uma versão nova, e a anterior fica.
 */
function Detail({ skill }: { skill: SkillDetailRecord }) {
  const { t, theme, format } = useGlossary();
  const navigate = useNavigate();
  const update = useUpdateSkill();
  const remove = useDeleteSkill();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(skill.name);
  const [description, setDescription] = useState(skill.description ?? "");
  const [publishing, setPublishing] = useState(false);
  const [removing, setRemoving] = useState(false);

  // A versão aberta no painel de texto: a mais recente até alguém escolher
  // outra na lista. Publicar volta para a mais recente.
  const [viewing, setViewing] = useState<number>(skill.latestVersion);
  useEffect(() => {
    setViewing(skill.latestVersion);
  }, [skill.latestVersion]);

  const [page, setPage] = useState(1);
  const versions = useSkillVersions(skill.id, page);
  const versionItems = versions.data?.items ?? [];
  const total = versions.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / 50));

  const byNumber = useMemo(() => {
    const map = new Map<number, SkillVersionRecord>();
    for (const version of versionItems) map.set(version.version, version);
    map.set(skill.latest.version, skill.latest);
    return map;
  }, [skill.latest, versionItems]);

  const shown = byNumber.get(viewing) ?? skill.latest;

  function startEditing() {
    setName(skill.name);
    setDescription(skill.description ?? "");
    setEditing(true);
  }

  function save() {
    update.mutate(
      {
        id: skill.id,
        ...(name.trim() === skill.name ? {} : { name: name.trim() }),
        description: description.trim() === "" ? null : description.trim(),
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(t("skill.edit.done"));
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <nav
          aria-label="Trilha"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Link className="hover:text-foreground" to="/skills">
            {t("nav.registry")}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <Link className="hover:text-foreground" to="/skills">
            {t("entity.skill.plural")}
          </Link>
          <ChevronRight aria-hidden className="size-3" />
          <span className="text-foreground max-w-md truncate">{skill.name}</span>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase">
              <WandSparkles aria-hidden className="size-3" />
              <span>{t("entity.skill")}</span>
            </span>

            {editing ? (
              <div className="grid max-w-3xl gap-x-5 gap-y-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-edit-name">Nome</Label>
                  <Input
                    id="skill-edit-name"
                    maxLength={200}
                    onChange={(event) => {
                      setName(event.target.value);
                    }}
                    value={name}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="skill-edit-description">Descrição</Label>
                  <Input
                    id="skill-edit-description"
                    maxLength={2_000}
                    onChange={(event) => {
                      setDescription(event.target.value);
                    }}
                    value={description}
                  />
                </div>
              </div>
            ) : (
              <>
                <h1
                  className={cn(
                    "max-w-3xl text-[30px] leading-9.5 font-semibold",
                    theme === "dnd" && "font-display",
                  )}
                >
                  {skill.name}
                </h1>
                <p className="text-muted-foreground max-w-3xl text-sm leading-5">
                  {skill.description === null || skill.description === ""
                    ? "Sem descrição."
                    : skill.description}
                </p>
              </>
            )}

            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs">
              <span data-skill-latest-version={skill.latestVersion}>
                {`${t("skill.latestVersion")}: v${String(skill.latestVersion)}`}
              </span>
              <span aria-hidden>·</span>
              <span>{format("{n} versões", { n: total === 0 ? skill.latestVersion : total })}</span>
              <span aria-hidden>·</span>
              <span>{format("Atualizada {when}", { when: relativeTime(skill.updatedAt) })}</span>
            </div>
          </div>

          <div className="flex flex-none items-center gap-2">
            {editing ? (
              <>
                <Button
                  onClick={() => {
                    setEditing(false);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Cancelar
                </Button>
                <Button disabled={name.trim() === "" || update.isPending} onClick={save} size="sm">
                  Salvar
                </Button>
              </>
            ) : (
              <>
                <Button onClick={startEditing} size="sm" variant="outline">
                  <Pencil aria-hidden />
                  <span>Editar</span>
                </Button>
                <Button
                  data-skill-publish
                  onClick={() => {
                    setPublishing(true);
                  }}
                  size="sm"
                >
                  <span>{t("skill.publish.action")}</span>
                </Button>
                <Button
                  className="text-muted-foreground"
                  onClick={() => {
                    setRemoving(true);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 aria-hidden />
                  <span>Apagar</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="flex flex-col overflow-hidden" data-skill-content={shown.version}>
          <div className="border-border flex h-11 flex-none items-center justify-between gap-3 border-b px-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t("skill.content.title")}</span>
              <span className="text-muted-foreground font-mono text-[11px]">
                {`v${String(shown.version)}`}
              </span>
              {shown.version === skill.latestVersion && (
                <span className="text-muted-foreground text-[11px]">
                  {`· ${t("skill.latestVersion").toLowerCase()}`}
                </span>
              )}
            </div>
            <span className="text-muted-foreground text-[11px]">
              {formatDateTime(shown.createdAt)}
            </span>
          </div>

          {shown.changelog !== null && shown.changelog !== "" && (
            <p
              className="border-border text-muted-foreground m-0 border-b px-4 py-2.5 text-[12px] leading-4.5 whitespace-pre-wrap"
              data-skill-changelog
            >
              {shown.changelog}
            </p>
          )}

          {shown.content === "" ? (
            <p className="text-muted-foreground m-0 px-4 py-6 text-center text-[12.5px]">
              {t("skill.content.empty")}
            </p>
          ) : (
            <pre
              className="m-0 max-h-[40rem] overflow-auto px-4 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap"
              data-skill-text
            >
              {shown.content}
            </pre>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel className="flex flex-col overflow-hidden" data-skill-versions>
            <div className="border-border flex h-11 flex-none items-center justify-between gap-3 border-b px-4">
              <div className="flex items-center gap-2">
                <History aria-hidden className="text-muted-foreground size-3.75" />
                <span className="text-sm font-medium">{t("skill.history.title")}</span>
              </div>
              <span className="text-muted-foreground text-[11px]">
                {versions.data === undefined ? "" : format("{n} publicadas", { n: total })}
              </span>
            </div>

            {versions.isError && (
              <p className="text-destructive px-4 py-4 text-sm">{versions.error.message}</p>
            )}

            <ul className="m-0 flex list-none flex-col p-0">
              {versionItems.map((version) => {
                const active = version.version === viewing;
                return (
                  <li
                    key={version.id}
                    className={cn(
                      "border-border border-b last:border-b-0",
                      active && "bg-white/[0.04]",
                    )}
                    data-skill-version={version.version}
                  >
                    <button
                      className="flex w-full items-start gap-3 px-4 py-2.5 text-left"
                      onClick={() => {
                        setViewing(version.version);
                      }}
                      type="button"
                    >
                      <span
                        className="w-9 flex-none font-mono text-[12.5px] font-medium"
                        style={active ? { color: REGISTRY_COLOR } : undefined}
                      >
                        {`v${String(version.version)}`}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[12.5px]">
                          {version.changelog === null || version.changelog === ""
                            ? t("skill.history.changelog.none")
                            : version.changelog}
                        </span>
                        <span className="text-muted-foreground text-[11px]">
                          {formatDateTime(version.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {total > 50 && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <Button
                  disabled={page <= 1}
                  onClick={() => {
                    setPage(page - 1);
                  }}
                  size="xs"
                  variant="outline"
                >
                  Anterior
                </Button>
                <span className="text-muted-foreground text-xs">
                  {format("{page} de {lastPage}", { page, lastPage })}
                </span>
                <Button
                  disabled={page >= lastPage}
                  onClick={() => {
                    setPage(page + 1);
                  }}
                  size="xs"
                  variant="outline"
                >
                  Próxima
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {byNumber.size > 1 && <Compare latest={skill.latestVersion} versions={byNumber} />}

      <SkillPublishDialog
        onOpenChange={setPublishing}
        onPublished={(version) => {
          setViewing(version.version);
        }}
        skill={publishing ? skill : null}
      />

      <DeleteRegistryDialog
        action={format("Apagar {skill}", { skill: t("entity.skill") })}
        body={t("skill.delete.body")}
        data-skill-delete-dialog=""
        done={t("skill.delete.done")}
        onDeleted={() => {
          void navigate({ to: "/skills" });
        }}
        onOpenChange={(open) => {
          if (!open) setRemoving(false);
        }}
        pending={remove.isPending}
        remove={(id) => remove.mutateAsync(id)}
        target={removing ? skill : null}
        title={t("skill.delete.title")}
      />
    </>
  );
}

/**
 * Comparar duas versões: da anterior para a mais recente, por padrão.
 *
 * As duas escolhas vêm da página de versões já lida; comparar versões de
 * páginas diferentes é folhear antes.
 */
function Compare({
  latest,
  versions,
}: {
  latest: number;
  versions: ReadonlyMap<number, SkillVersionRecord>;
}) {
  const { t } = useGlossary();
  const numbers = useMemo(() => [...versions.keys()].sort((a, b) => b - a), [versions]);
  const [from, setFrom] = useState<number>(numbers.find((n) => n < latest) ?? latest);
  const [to, setTo] = useState<number>(latest);

  useEffect(() => {
    setTo(latest);
    setFrom(numbers.find((n) => n < latest) ?? latest);
  }, [latest, numbers]);

  const before = versions.get(from);
  const after = versions.get(to);

  return (
    <Panel className="flex flex-col gap-3 px-4 pt-3.5 pb-4" data-skill-compare>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows aria-hidden className="text-muted-foreground size-3.75" />
          <span className="text-sm font-medium">{t("skill.diff.title")}</span>
        </div>
        <span className="flex-1" />
        <VersionSelect
          id="skill-diff-from"
          label={t("skill.diff.from")}
          numbers={numbers}
          onChange={setFrom}
          value={from}
        />
        <VersionSelect
          id="skill-diff-to"
          label={t("skill.diff.to")}
          numbers={numbers}
          onChange={setTo}
          value={to}
        />
      </div>

      {before !== undefined && after !== undefined && (
        <SkillDiff after={after.content} before={before.content} />
      )}
    </Panel>
  );
}

function VersionSelect({
  id,
  label,
  numbers,
  value,
  onChange,
}: {
  id: string;
  label: string;
  numbers: readonly number[];
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-muted-foreground text-[11.5px]" htmlFor={id}>
        {label}
      </Label>
      <Select
        onValueChange={(next) => {
          onChange(Number(next));
        }}
        value={String(value)}
      >
        <SelectTrigger aria-label={label} className="h-7 w-24 font-mono text-[12px]" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {numbers.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {`v${String(n)}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
