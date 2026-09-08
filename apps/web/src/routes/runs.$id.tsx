import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Clock, ExternalLink, Gem, GitBranch, ListChecks, Play } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { RunStatusChip } from "@/components/execution/chips";
import { EnvBadge } from "@/components/execution/env-badge";
import { Panel } from "@/components/panel";
import { ApprovalGateCard } from "@/components/run/approval-gate-card";
import { CancelRunDialog } from "@/components/run/cancel-run-dialog";
import { FailurePanel } from "@/components/run/failure-panel";
import { ResultPanel } from "@/components/run/result-panel";
import { ResumeRunDialog } from "@/components/run/resume-run-dialog";
import { RunStepsPanel } from "@/components/run/run-steps-panel";
import { RuntimeCard, SessionCard, TimeCard } from "@/components/run/runtime-column";
import { Timeline } from "@/components/run/timeline";
import { KindChip, PriorityText, StatusChip } from "@/components/task/chips";
import { Button } from "@/components/ui/button";
import type { RunRecord } from "@/lib/api-types";
import { useRunGates } from "@/lib/approvals";
import { formatDateTime } from "@/lib/datetime";
import { eventPresentation, isLiveRunStatus, WORKSPACE_STRATEGY } from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";
import { useProject } from "@/lib/projects";
import { useRunEvents } from "@/lib/run-events";
import { canResumeRun, runKeys, useRun } from "@/lib/runs";
import { runDetailSearchSchema } from "@/lib/search";
import { useTask } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { useWorkflowVersion } from "@/lib/workflows";

export const Route = createFileRoute("/runs/$id")({
  validateSearch: runDetailSearchSchema,
  component: RunCockpitPage,
});

function RunCockpitPage() {
  const { id } = Route.useParams();
  const { t } = useGlossary();
  const run = useRun(id);

  if (run.isPending) {
    return <p className="text-muted-foreground text-sm">Lendo…</p>;
  }

  if (run.isError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-destructive text-sm">{run.error.message}</p>
        <Link className="text-sm underline underline-offset-2" to="/runs">
          {t("nav.runs")}
        </Link>
      </div>
    );
  }

  return <Cockpit run={run.data} />;
}

/**
 * O Cristal de Visão: três colunas, e a mesma leitura antes e depois do fim.
 *
 * A Task à esquerda, o Diário no meio, o Runtime e a ação à direita — é o
 * layout da seção 37 do documento técnico, e ele não muda quando a Expedição
 * termina. O que muda é o que aparece abaixo: o resultado estruturado numa
 * vitória, o diagnóstico e o workspace preservado numa derrota.
 *
 * O relógio ao vivo é um estado próprio, com um intervalo de um segundo, e não
 * uma releitura da API: o tempo decorrido é aritmética sobre `startedAt`, e
 * pedir isso ao servidor a cada segundo seria trabalho por nada.
 */
function Cockpit({ run }: { run: RunRecord }) {
  const { t, theme, format } = useGlossary();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const live = isLiveRunStatus(run.status);
  const events = useRunEvents(run.id);
  const task = useTask(run.taskId);
  const project = useProject(run.projectId);

  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // A Fase 4: o Run com Ritual tem passos, e pode estar parado num gate.
  const guided = run.workflowVersionId !== null;
  const version = useWorkflowVersion(run.workflowVersionId);
  const gates = useRunGates(run.id, live && guided);
  const [holdingGate, setHoldingGate] = useState(false);
  const onHoldingChange = useCallback((holding: boolean) => {
    setHoldingGate(holding);
  }, []);

  // O Diário chega primeiro; a lista de passos é lida do banco. Um evento do
  // motor no stream é o sinal de que o banco mudou, e a releitura sai na hora
  // em vez de esperar o próximo ciclo.
  const queryClient = useQueryClient();
  const lastEventType = events.events.at(-1)?.type;
  const lastSequence = events.lastSequence;
  useEffect(() => {
    if (!guided || lastEventType === undefined) return;
    if (eventPresentation(lastEventType).group !== "workflow") return;
    void queryClient.invalidateQueries({ queryKey: runKeys.steps(run.id) });
    void queryClient.invalidateQueries({ queryKey: runKeys.gates(run.id) });
    void queryClient.invalidateQueries({ queryKey: runKeys.detail(run.id) });
  }, [guided, lastEventType, lastSequence, queryClient, run.id]);

  // Decisão de UX da Fase 2: retomar só aparece quando a Guilda declara
  // `resume` e uma sessão foi capturada. Um botão que sempre existe e às vezes
  // volta em `409` ensina o usuário a desconfiar de todos os botões.
  const resumable = canResumeRun(run);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [live]);

  const profile = run.executionProfileSnapshot;

  return (
    <>
      <div className="flex flex-none flex-col gap-2">
        <nav
          aria-label="Trilha"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Link className="hover:text-foreground" to="/runs">
            {t("nav.runs")}
          </Link>
          {run.projectId !== null && (
            <>
              <ChevronRight aria-hidden className="size-3" />
              <Link
                className="hover:text-foreground"
                params={{ id: run.projectId }}
                to="/projects/$id"
              >
                {project.data?.title ?? "…"}
              </Link>
            </>
          )}
          <ChevronRight aria-hidden className="size-3" />
          <span className="text-foreground max-w-md truncate">
            {format("tentativa {n}", { n: run.attempt })}
          </span>
        </nav>

        <div className="flex items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-0.75">
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.1em] uppercase">
              <Gem aria-hidden className="size-3" />
              <span>{t("run.cockpit")}</span>
            </span>
            <h1
              className={cn(
                "max-w-3xl text-[27px] leading-8.5 font-semibold",
                theme === "dnd" && "font-display",
              )}
            >
              {task.data?.title ?? "…"}
            </h1>
          </div>

          <div className="flex flex-none items-center gap-2 pt-3">
            <Button asChild size="sm" variant="outline">
              <Link params={{ id: run.taskId }} to="/tasks/$id">
                <ExternalLink aria-hidden />
                <span>{format("Abrir {task}", { task: t("entity.task") })}</span>
              </Link>
            </Button>
            {resumable && (
              <Button
                onClick={() => {
                  setResuming(true);
                }}
                size="sm"
              >
                <Play aria-hidden />
                <span>{format("Retomar a {run}", { run: t("entity.run") })}</span>
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
          <RunStatusChip status={run.status} />
          {task.data !== undefined && <KindChip kind={task.data.kind} />}
          <EnvBadge mode={run.executionMode} size="lg" />

          <div className="flex-1" />

          <span className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
            <Clock aria-hidden className="size-3.25" />
            <span>
              {run.startedAt === null
                ? format("{status} em {when}", {
                    status: t("run.status.created"),
                    when: formatDateTime(run.createdAt),
                  })
                : format("Iniciada em {when}", { when: formatDateTime(run.startedAt) })}
            </span>
          </span>
        </div>
      </div>

      {guided && (run.status === "WAITING_APPROVAL" || holdingGate) && (
        <ApprovalGateCard gates={gates.data?.items ?? []} onHoldingChange={onHoldingChange} />
      )}

      <div className="grid min-h-150 items-stretch gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        <div className="flex min-h-0 flex-col gap-4">
          <Panel className="flex flex-col gap-2 px-4 pt-3.5 pb-4">
            <div className="flex items-center gap-2">
              <ListChecks aria-hidden className="text-muted-foreground size-3.5" />
              <span className="text-[13px] font-medium">{t("entity.task")}</span>
            </div>

            <MetaRow label={t("entity.project")}>
              {run.projectId === null ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <Link
                  className="underline-offset-2 hover:underline"
                  params={{ id: run.projectId }}
                  to="/projects/$id"
                >
                  {project.data?.title ?? "…"}
                </Link>
              )}
            </MetaRow>
            <MetaRow label={t("entity.workflow")}>
              {!guided ? (
                <span className="text-muted-foreground">{t("workflow.none")}</span>
              ) : version.data === undefined ? (
                "…"
              ) : (
                <Link
                  className="underline-offset-2 hover:underline"
                  data-run-workflow={version.data.workflowId}
                  params={{ id: version.data.workflowId }}
                  to="/workflows/$id"
                >
                  {`${version.data.definition.name} · v${String(version.data.version)}`}
                </Link>
              )}
            </MetaRow>
            {task.data !== undefined && (
              <>
                <MetaRow label="Status">
                  <StatusChip status={task.data.status} />
                </MetaRow>
                <MetaRow label="Prioridade">
                  <PriorityText priority={task.data.priority} />
                </MetaRow>
                <MetaRow label={t("entity.subtask.plural")}>
                  {format("{done} de {total}", {
                    done: task.data.children.filter(
                      (child) => child.status === "COMPLETED" || child.status === "CANCELLED",
                    ).length,
                    total: task.data.children.length,
                  })}
                </MetaRow>
              </>
            )}
          </Panel>

          <Panel className="flex flex-col gap-2 px-4 pt-3.5 pb-4">
            <div className="flex items-center gap-2">
              <GitBranch aria-hidden className="text-muted-foreground size-3.5" />
              <span className="text-[13px] font-medium">{t("entity.executionProfile")}</span>
            </div>
            <MetaRow label="Nome">{profile.name}</MetaRow>
            <MetaRow label="Workspace">{t(WORKSPACE_STRATEGY[profile.workspaceStrategy])}</MetaRow>
            <MetaRow label="Comandos">{profile.permissionPolicy.commandExecution}</MetaRow>
            <MetaRow label="Rede">{profile.networkPolicy.access}</MetaRow>
          </Panel>

          <Panel className="flex flex-col gap-2 px-4 pt-3.5 pb-4">
            <span className="text-[13px] font-medium">Prompt</span>
            <p className="text-muted-foreground m-0 max-h-40 overflow-auto text-[12px] leading-4.5 whitespace-pre-wrap">
              {run.prompt}
            </p>
          </Panel>
        </div>

        <Timeline
          filter={search.events}
          live={live}
          onFilterChange={(next) => {
            void navigate({
              search: () => ({ events: next }),
              replace: true,
              to: "/runs/$id",
              params: { id: run.id },
            });
          }}
          state={events}
        />

        <div className="flex min-h-0 flex-col gap-4">
          <RuntimeCard run={run} />
          <SessionCard run={run} />
          <TimeCard
            now={now}
            onCancel={() => {
              setCancelling(true);
            }}
            run={run}
          />
        </div>
      </div>

      {guided && <RunStepsPanel live={live} now={now} runId={run.id} />}

      {run.status === "SUCCEEDED" && <ResultPanel run={run} />}
      {(run.status === "FAILED" || run.status === "TIMED_OUT") && (
        <FailurePanel
          onResume={() => {
            setResuming(true);
          }}
          run={run}
        />
      )}

      <CancelRunDialog onOpenChange={setCancelling} open={cancelling} run={run} />
      <ResumeRunDialog onOpenChange={setResuming} open={resuming} run={run} />
    </>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.75">
      <span className="text-muted-foreground flex-none text-xs">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px]">{children}</span>
    </div>
  );
}
