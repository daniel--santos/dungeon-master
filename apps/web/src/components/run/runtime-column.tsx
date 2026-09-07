import { Check, CircleStop, Copy, Cpu } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { EnforcementText } from "@/components/execution/chips";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { RunRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { formatDuration, isCancelPending, runDurationMs } from "@/lib/runs";
import { cn } from "@/lib/utils";

const NUMBER = new Intl.NumberFormat("pt-BR");

/**
 * A coluna direita do cockpit: com o que a Expedição está rodando, e a ação.
 *
 * Os dados vêm do snapshot do Run, e não dos cadastros: renomear um Equipamento
 * depois não pode reescrever o que uma execução passada usou. A versão da CLI e
 * a sessão do harness são as duas coisas que só existem depois do preflight, e
 * ficam vazias enquanto ele não rodou — em vez de fingir um valor.
 */
export function RuntimeCard({ run }: { run: RunRecord }) {
  const { t } = useGlossary();
  const snapshot = run.loadoutSnapshot;
  const profile = run.executionProfileSnapshot;
  const usage = run.result?.usage;

  return (
    <Panel className="flex flex-col gap-2.5 px-4 pt-3.5 pb-4">
      <div className="flex items-center gap-2">
        <Cpu aria-hidden className="text-muted-foreground size-3.5" />
        <span className="text-[13px] font-medium">Runtime</span>
      </div>

      <MetaRow label={t("entity.agent")}>{snapshot.agent.name}</MetaRow>
      <MetaRow label={t("entity.harness")}>{snapshot.harness.name}</MetaRow>
      <MetaRow label={t("entity.model")}>{snapshot.model?.name ?? run.modelKey ?? "—"}</MetaRow>
      <MetaRow label={t("entity.loadout")}>
        {`${snapshot.name} · v${String(snapshot.version)}`}
      </MetaRow>
      <MetaRow label="Versão da CLI">
        {run.harnessVersion === null ? (
          <span className="text-muted-foreground">sem preflight</span>
        ) : (
          <code className="font-mono text-[11px]">{run.harnessVersion}</code>
        )}
      </MetaRow>

      {usage !== undefined && (
        <>
          <Divider />
          <MetaRow label="Tokens de entrada">
            {usage.inputTokens === undefined ? "—" : NUMBER.format(usage.inputTokens)}
          </MetaRow>
          <MetaRow label="Tokens de saída">
            {usage.outputTokens === undefined ? "—" : NUMBER.format(usage.outputTokens)}
          </MetaRow>
          <MetaRow label="Total">
            {usage.totalTokens === undefined ? "—" : NUMBER.format(usage.totalTokens)}
          </MetaRow>
        </>
      )}

      <Divider />
      <MetaRow label={t("enforcement.requested")}>
        <code className="text-muted-foreground font-mono text-[11px]">advisory</code>
      </MetaRow>
      <MetaRow label={t("enforcement.applied")}>
        <EnforcementText className="text-[11px]" level={profile.enforcement} />
      </MetaRow>
      <p className="text-muted-foreground m-0 text-[11px] leading-4">
        A política do perfil é um pedido. Quem barra de fato é quem o nível de enforcement diz.
      </p>
    </Panel>
  );
}

function Divider() {
  return <div aria-hidden className="bg-border my-1 h-px" />;
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.75">
      <span className="text-muted-foreground flex-none text-xs">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px]">{children}</span>
    </div>
  );
}

/**
 * Um valor que existe para ser copiado: caminho de worktree, id de sessão.
 *
 * O botão dá retorno visível por um segundo, porque copiar não muda nada na
 * tela e sem confirmação ninguém sabe se funcionou.
 */
export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

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
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <div className="border-border flex h-7 items-center gap-1.5 rounded-lg border bg-white/[0.05] pr-1 pl-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{value}</span>
        <button
          aria-label={`Copiar ${label}`}
          className="text-muted-foreground hover:text-foreground flex size-5 flex-none items-center justify-center rounded"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => {
                setCopied(true);
              },
              () => {
                // Um clipboard bloqueado não é erro de aplicação: o valor
                // continua na tela para ser selecionado à mão.
              },
            );
          }}
          type="button"
        >
          {copied ? (
            <Check aria-hidden className="size-3" />
          ) : (
            <Copy aria-hidden className="size-3" />
          )}
        </button>
      </div>
    </div>
  );
}

/** A sessão do harness e o caminho do workspace, quando existem. */
export function SessionCard({ run }: { run: RunRecord }) {
  const { t, format } = useGlossary();

  if (run.harnessSessionId === null && run.workspacePath === null) return null;

  return (
    <Panel className="flex flex-col gap-2.25 px-4 pt-3.5 pb-4">
      {run.harnessSessionId !== null && (
        <CopyRow label="Sessão capturada" value={run.harnessSessionId} />
      )}
      {run.workspacePath !== null && <CopyRow label="Workspace" value={run.workspacePath} />}
      {run.harnessSessionId !== null && !run.loadoutSnapshot.harness.capabilities.resume && (
        <span className="text-muted-foreground text-[10.5px] leading-4">
          {format("A {harness} não declara resume nas capabilities.", {
            harness: t("entity.harness"),
          })}
        </span>
      )}
    </Panel>
  );
}

export interface TimeCardProps {
  readonly run: RunRecord;
  /** Redesenhado a cada segundo enquanto o Run corre. */
  readonly now: number;
  readonly onCancel: () => void;
}

/**
 * O relógio da Expedição, e a ação que a encerra.
 *
 * Enquanto o cancelamento foi pedido e o estado terminal não chegou, o botão dá
 * lugar ao aviso de que a retirada está em andamento: o pedido está gravado, o
 * worker está matando a árvore, e clicar de novo não adiantaria nada.
 */
export function TimeCard({ run, now, onCancel }: TimeCardProps) {
  const { t, format } = useGlossary();
  const duration = runDurationMs(run, now);
  const pending = isCancelPending(run);
  const finished = run.finishedAt !== null;

  const color =
    run.status === "SUCCEEDED"
      ? "oklch(0.72 0.13 150)"
      : run.status === "TIMED_OUT"
        ? "oklch(0.72 0.13 75)"
        : undefined;

  return (
    <Panel className="flex flex-col gap-2.5 px-4 pt-3.5 pb-4">
      <div className="flex items-end justify-between">
        <div className="flex flex-col gap-0.75">
          <span className="text-muted-foreground text-[11px]">
            {finished ? "Duração" : "Tempo decorrido"}
          </span>
          <span
            className="font-mono text-[26px] leading-7.5 tracking-[-0.02em]"
            style={color === undefined ? undefined : { color }}
          >
            {duration === null ? "—" : formatDuration(duration)}
          </span>
        </div>
        <span className="text-muted-foreground pb-1 text-[11px]">
          {format("tentativa {n}", { n: run.attempt })}
        </span>
      </div>

      {pending ? (
        <div className="border-border flex items-center gap-2 rounded-lg border bg-white/[0.04] px-2.5 py-2">
          <span
            aria-hidden
            className="size-1.5 flex-none animate-pulse rounded-full"
            style={{ backgroundColor: "var(--destructive)" }}
          />
          <span className="text-[12px]" data-cancel-pending>
            {format("{cancelled} em andamento", { cancelled: t("run.status.cancelled") })}
          </span>
        </div>
      ) : (
        !finished && (
          <Button
            className="border-destructive/45 bg-destructive/14 text-destructive hover:bg-destructive/20 w-full border"
            onClick={onCancel}
            variant="ghost"
          >
            <CircleStop aria-hidden />
            <span>{format("Cancelar {run}", { run: t("entity.run") })}</span>
          </Button>
        )
      )}

      <p
        className={cn("text-muted-foreground m-0 text-[10.5px] leading-3.75", finished && "hidden")}
      >
        {format(
          "Pede confirmação antes de encerrar. Só vira {cancelled} depois que a árvore de processos for confirmada encerrada.",
          { cancelled: t("run.status.cancelled") },
        )}
      </p>
    </Panel>
  );
}
