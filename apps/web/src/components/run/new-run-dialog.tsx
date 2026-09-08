import type { ExecutionMode } from "@dungeon-master/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Ban, GitBranch, Package, Swords, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EnforcementText } from "@/components/execution/chips";
import { KindChip, PriorityText } from "@/components/task/chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ExecutionProfileRecord, TaskDetailRecord } from "@/lib/api-types";
import { AGENT_ROLE, EXECUTION_MODE, WORKSPACE_STRATEGY } from "@/lib/execution-domain";
import {
  useAgents,
  useExecutionProfiles,
  useHarnesses,
  useLoadouts,
  useModels,
} from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useCreateRun } from "@/lib/runs";
import { useHostAcknowledgement } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useWorkflows } from "@/lib/workflows";

export interface NewRunDialogProps {
  readonly task: TaskDetailRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * O diálogo que faz uma Expedição partir.
 *
 * Três escolhas, nesta ordem porque é a ordem em que elas importam: qual
 * Equipamento, em que ambiente, e com qual prompt. O prompt vem montado do
 * título e da descrição da Task e é editável — o que estiver aqui é o que o
 * harness recebe, e esconder isso atrás de "montamos para você" tiraria do
 * usuário a única alavanca que ele tem sobre o que o agente vai ler.
 *
 * O aceite do modo host é obrigatório para partir e não é uma formalidade: é a
 * exigência da Fase 2B, e ele explica exatamente o que vai acontecer — acesso
 * ao disco e à rede, worktree separado que não é sandbox, política pedida
 * contra política imposta.
 */
export function NewRunDialog({ task, open, onOpenChange }: NewRunDialogProps) {
  const { t, format } = useGlossary();
  const navigate = useNavigate();

  const loadouts = useLoadouts();
  const agents = useAgents();
  const harnesses = useHarnesses();
  const models = useModels();
  const profiles = useExecutionProfiles();
  const host = useHostAcknowledgement();
  const create = useCreateRun();
  const workflows = useWorkflows();
  const workflow =
    task.workflowId === null
      ? null
      : (workflows.data?.items.find((item) => item.id === task.workflowId) ?? null);

  const [loadoutId, setLoadoutId] = useState("");
  const [mode, setMode] = useState<ExecutionMode>("HOST");
  const [prompt, setPrompt] = useState("");
  const [accepted, setAccepted] = useState(false);

  const loadoutItems = loadouts.data?.items ?? [];
  const loadout = loadoutItems.find((item) => item.id === loadoutId);

  const profileItems = profiles.data?.items ?? [];
  const loadoutProfile = profileItems.find((item) => item.id === loadout?.executionProfileId);

  /** O perfil que a partida vai usar: o do Equipamento, ou o do ambiente escolhido. */
  const profile = useMemo<ExecutionProfileRecord | undefined>(() => {
    if (loadoutProfile !== undefined && loadoutProfile.mode === mode) return loadoutProfile;
    return profileItems.find((item) => item.enabled && item.mode === mode);
  }, [loadoutProfile, mode, profileItems]);

  const agent = (agents.data?.items ?? []).find((item) => item.id === loadout?.agentId);
  const harness = (harnesses.data?.items ?? []).find((item) => item.id === loadout?.harnessId);
  const model = (models.data?.items ?? []).find((item) => item.id === loadout?.modelId);

  // O prompt e as escolhas nascem a cada abertura: reabrir sobre outra Task com
  // o texto da anterior mandaria o agente para o lugar errado.
  useEffect(() => {
    if (!open) return;
    setPrompt(
      task.description === null || task.description === ""
        ? task.title
        : `${task.title}\n\n${task.description}`,
    );
    setMode("HOST");
    setAccepted(host.acknowledged);
  }, [host.acknowledged, open, task.description, task.title]);

  useEffect(() => {
    if (!open || loadoutId !== "") return;
    const fallback = loadoutItems.find((item) => item.isDefault) ?? loadoutItems[0];
    if (fallback !== undefined) setLoadoutId(fallback.id);
  }, [loadoutId, loadoutItems, open]);

  const dockerProfile = profileItems.find((item) => item.mode === "DOCKER" && item.enabled);
  const needsAcceptance = mode === "HOST";
  const ready =
    loadout !== undefined &&
    prompt.trim() !== "" &&
    (!needsAcceptance || accepted) &&
    !create.isPending;

  function depart() {
    if (loadout === undefined) return;

    // O aceite passa a valer para as próximas partidas. Só grava quando o
    // usuário acabou de marcar: regravar o mesmo valor é escrita à toa.
    if (needsAcceptance && accepted && !host.acknowledged) host.set(true);

    create.mutate(
      {
        taskId: task.id,
        loadoutId: loadout.id,
        // O override só vai quando o perfil difere do que o Equipamento traz;
        // mandar o mesmo id seria ruído no snapshot.
        ...(profile !== undefined && profile.id !== loadout.executionProfileId
          ? { executionProfileId: profile.id }
          : {}),
        prompt: prompt.trim(),
      },
      {
        onSuccess: (run) => {
          onOpenChange(false);
          void navigate({ to: "/runs/$id", params: { id: run.id } });
        },
        onError: (error: Error) => {
          // O `409` diz o motivo: Task fora de READY, Project sem workspace,
          // dependência pendente, Harness ou perfil desligado.
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{format("Nova {run}", { run: t("entity.run") })}</DialogTitle>
          <DialogDescription>
            {format(
              "Escolha o {loadout} e o ambiente. O prompt vem montado do título e da descrição da {task} — edite antes de partir.",
              { loadout: t("entity.loadout"), task: t("entity.task") },
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="border-border flex items-center gap-2.5 rounded-[10px] border bg-white/[0.035] px-3 py-2.25">
          <KindChip kind={task.kind} />
          <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
          <PriorityText className="flex-none text-[11.5px]" priority={task.priority} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="run-loadout">{t("entity.loadout")}</Label>
          <Select value={loadoutId} onValueChange={setLoadoutId}>
            <SelectTrigger aria-label={t("entity.loadout")} id="run-loadout">
              <SelectValue placeholder={t("entity.loadout")} />
            </SelectTrigger>
            <SelectContent>
              {loadoutItems.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {loadout !== undefined && (
            <div className="border-input flex items-center gap-3 rounded-[10px] border bg-white/[0.045] px-3 py-2.5">
              <span className="border-border flex size-8.5 flex-none items-center justify-center rounded-[9px] border bg-[oklch(0.72_0.13_305)]/12">
                <Package aria-hidden className="size-4.25 text-[oklch(0.72_0.13_305)]" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[13.5px] font-medium">{loadout.name}</span>
                <span className="text-muted-foreground truncate text-[11.5px]">
                  {[
                    agent?.name,
                    agent === undefined ? undefined : t(AGENT_ROLE[agent.role]),
                    harness?.name,
                    model?.name ?? format("{model} padrão", { model: t("entity.model") }),
                  ]
                    .filter((part) => part !== undefined)
                    .join(" · ")}
                </span>
              </div>
              <span className="text-muted-foreground flex-none font-mono text-[10.5px]">
                {`v${String(loadout.version)}`}
              </span>
            </div>
          )}

          {loadout !== undefined && (
            <span className="text-muted-foreground text-[11px] leading-4">
              {format("{skills} · {tools} · {relics} vão junto.", {
                skills: `${String(loadout.skills.length)} ${t("entity.skill.plural")}`,
                tools: `${String(loadout.tools.length)} ${t("entity.tool.plural")}`,
                relics: `${String(loadout.mcpServers.length)} ${t("entity.mcpServer.plural")}`,
              })}
            </span>
          )}
        </div>

        {task.workflowId !== null && (
          <div
            className="border-border flex items-start gap-3 rounded-[10px] border bg-white/[0.035] px-3 py-2.5"
            data-run-workflow={task.workflowId}
          >
            <span className="border-border flex size-8.5 flex-none items-center justify-center rounded-[9px] border bg-[oklch(0.72_0.13_75)]/12">
              <WandSparkles aria-hidden className="size-4.25 text-[oklch(0.72_0.13_75)]" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
                {t("entity.workflow")}
              </span>
              <span className="truncate text-[13.5px] font-medium">{workflow?.name ?? "…"}</span>
              <span className="text-muted-foreground text-[11px] leading-4">
                {workflow === null
                  ? t("workflow.captureNote")
                  : format("{n} {steps}. {note}", {
                      n: workflow.definition.steps.length,
                      steps: t("entity.workflowStep.plural").toLowerCase(),
                      note: t("workflow.captureNote"),
                    })}
              </span>
            </div>
          </div>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-[12.5px] font-medium">Ambiente</legend>

          <ModeOption
            checked={mode === "HOST"}
            description="Mais rápido, sem custo de partida. O agente roda direto na sua máquina."
            mode="HOST"
            onSelect={() => {
              setMode("HOST");
            }}
          />
          <ModeOption
            checked={mode === "DOCKER"}
            description={
              dockerProfile === undefined
                ? "Isolada, com custo extra para subir o container. Nenhum perfil de execução em container está habilitado."
                : "Isolada, com custo extra para subir o container. O agente trabalha dentro dele e não alcança o resto da máquina."
            }
            disabled={dockerProfile === undefined}
            mode="DOCKER"
            {...(dockerProfile === undefined ? { note: "sem perfil" } : {})}
            onSelect={() => {
              setMode("DOCKER");
            }}
          />
        </fieldset>

        {needsAcceptance && (
          <label
            className="border-destructive/38 bg-destructive/9 flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-3"
            data-host-acknowledgement
          >
            <Checkbox
              aria-label={format("Aceito executar {warning}", { warning: t("env.host.warning") })}
              checked={accepted}
              className="mt-0.5"
              onCheckedChange={(checked) => {
                setAccepted(checked === true);
              }}
            />
            <span className="flex flex-col gap-1.25">
              <span className="text-[12.5px] leading-4.5">
                {format(
                  "Entendo que o {agent} vai rodar direto na minha máquina, com acesso ao disco e à rede, {warning}.",
                  { agent: t("entity.agent"), warning: t("env.host.warning") },
                )}
              </span>
              <span className="text-muted-foreground text-[11px] leading-4">
                {profile === undefined
                  ? format("A {run} roda no workspace do projeto.", { run: t("entity.run") })
                  : format(
                      "A {run} usa {strategy}, que separa as alterações mas não é um sandbox. As permissões ficam com a CLI:",
                      {
                        run: t("entity.run"),
                        strategy: t(WORKSPACE_STRATEGY[profile.workspaceStrategy]).toLowerCase(),
                      },
                    )}{" "}
                {profile !== undefined && <EnforcementText level={profile.enforcement} />}
              </span>
            </span>
          </label>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="run-prompt">Prompt</Label>
          <Textarea
            id="run-prompt"
            maxLength={100_000}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
            rows={6}
            value={prompt}
          />
          <span className="text-muted-foreground text-[11px] leading-4">
            {format(
              "Montado do título e da descrição da {task}. O que você escrever aqui é o que a {harness} recebe.",
              { task: t("entity.task"), harness: t("entity.harness") },
            )}
          </span>
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-muted-foreground flex items-center gap-1.5 self-center text-[11.5px]">
            <GitBranch aria-hidden className="size-3.25" />
            <span>
              {profile === undefined ? "—" : t(WORKSPACE_STRATEGY[profile.workspaceStrategy])}
            </span>
          </span>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={!ready} onClick={depart}>
              <Swords aria-hidden />
              <span>Partir</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Uma opção de ambiente.
 *
 * O nome, o aviso e o texto canônico vêm juntos, como no badge: a escolha entre
 * rodar isolado e rodar na própria máquina é o momento em que essa informação
 * mais importa.
 */
function ModeOption({
  mode,
  checked,
  disabled = false,
  description,
  note,
  onSelect,
}: {
  mode: ExecutionMode;
  checked: boolean;
  disabled?: boolean;
  description: string;
  note?: string;
  onSelect: () => void;
}) {
  const { t } = useGlossary();
  const { label, canonical, warning } = EXECUTION_MODE[mode];
  const accent = mode === "HOST" ? "var(--destructive)" : "oklch(0.72 0.13 250)";

  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-[10px] border px-3 py-2.75",
        disabled ? "border-border cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
      data-mode-option={mode}
      style={
        checked && !disabled
          ? {
              borderColor: `color-mix(in oklch, ${accent} 45%, transparent)`,
              backgroundColor: `color-mix(in oklch, ${accent} 9%, transparent)`,
            }
          : undefined
      }
    >
      <input
        checked={checked}
        className="sr-only"
        disabled={disabled}
        name="execution-mode"
        onChange={onSelect}
        type="radio"
        value={mode}
      />
      <span
        aria-hidden
        className="mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border"
        style={{ borderColor: checked && !disabled ? accent : "var(--input)" }}
      >
        {checked && !disabled && (
          <span className="size-2 rounded-full" style={{ backgroundColor: accent }} />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium">{t(label)}</span>
          {warning !== null && (
            <>
              <span className="text-muted-foreground text-[13.5px]">·</span>
              <span className="text-[13.5px]" style={{ color: accent }}>
                {t(warning)}
              </span>
            </>
          )}
          {note !== undefined && (
            <span className="border-border text-muted-foreground inline-flex h-4.5 items-center gap-1 rounded-full border px-1.75 text-[10.5px]">
              <Ban aria-hidden className="size-2.5" />
              <span>{note}</span>
            </span>
          )}
        </span>
        <span className="text-muted-foreground text-[11.5px]">{description}</span>
      </span>

      <span
        className="flex h-5 flex-none items-center rounded-md border px-1.5 font-mono text-[10px] tracking-[0.04em]"
        style={{
          borderColor: `color-mix(in oklch, ${accent} 40%, transparent)`,
          backgroundColor: `color-mix(in oklch, ${accent} 12%, transparent)`,
          color: accent,
        }}
      >
        {t(canonical)}
      </span>
    </label>
  );
}
