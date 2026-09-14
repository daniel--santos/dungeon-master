import type { ExecutionMode, HarnessCapabilities } from "@dungeon-master/contracts";
import { Check, RefreshCw, ShieldCheck, ShieldX, TriangleAlert, X } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import {
  CapabilityIssueList,
  type CapabilityIssueView,
} from "@/components/registry/capability-issues";
import { ProviderAuthBadge } from "@/components/registry/provider-auth-badge";
import { Button } from "@/components/ui/button";
import type { LoadoutPreflightRecord, LoadoutRecord } from "@/lib/api-types";
import { previewCapabilities } from "@/lib/capability-preview";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { useLoadoutPreflight } from "@/lib/registry";
import { ACCENT_AMBER, ACCENT_GREEN } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

const NUMBER = new Intl.NumberFormat("pt-BR");

function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

export type CompatibilityVerdict = "ready" | "pending" | "blocked" | "checking" | "preview";

/** O que o formulário sabe do rascunho, para a prévia pela matriz. */
export interface CompatibilityDraft {
  readonly capabilities: HarnessCapabilities | undefined;
  readonly mode: ExecutionMode | undefined;
  readonly mcpServerNames: readonly string[];
  readonly modelKey: string | null;
  readonly commandToolNames: readonly string[];
  /** O rascunho difere do que está salvo em algo que o preflight olha. */
  readonly dirty: boolean;
}

export interface CompatibilityPanelProps {
  /** O Loadout salvo; `null` num Loadout novo, que só tem prévia. */
  readonly loadout: Pick<LoadoutRecord, "id" | "version"> | null;
  /** O perfil escolhido no formulário, passado ao preflight como override. */
  readonly executionProfileId: string | undefined;
  readonly draft: CompatibilityDraft;
}

/**
 * O painel de compatibilidade do Equipamento (Fase 8C).
 *
 * Duas camadas, uma em cima da outra. A **prévia** é a matriz da Guilda
 * escolhida contra o rascunho do formulário, calculada aqui, na hora, a cada
 * troca de Guilda, perfil, Patrono, Item ou Relíquia — é o que faz o painel
 * responder antes de salvar. A **verificação completa** é o
 * `GET /loadouts/{id}/preflight`: o relatório canônico do domínio, a CLI no
 * modo do perfil e a credencial do Patronato, medidos na chamada. Ela lê o
 * que está salvo, com o perfil do formulário como override (a API aceita), e
 * por isso, com a Guilda ou as referências trocadas e não salvas, o painel
 * diz "salve para verificar" em vez de fingir que verificou.
 */
export function CompatibilityPanel({
  loadout,
  executionProfileId,
  draft,
}: CompatibilityPanelProps) {
  const { t } = useGlossary();

  const preflight = useLoadoutPreflight(
    loadout ?? undefined,
    { executionProfileId },
    loadout !== null && !draft.dirty,
  );

  const preview = useMemo(() => {
    if (draft.capabilities === undefined || draft.mode === undefined) return null;
    return previewCapabilities({
      capabilities: draft.capabilities,
      mode: draft.mode,
      mcpServerNames: draft.mcpServerNames,
      modelKey: draft.modelKey,
      commandToolNames: draft.commandToolNames,
    });
  }, [draft]);

  const data = loadout !== null && !draft.dirty ? preflight.data : undefined;
  const checking = loadout !== null && !draft.dirty && preflight.isFetching;

  const previewIssues: CapabilityIssueView[] =
    preview === null
      ? []
      : [
          ...preview.blockers.map((issue) => ({ ...issue, severity: "BLOCKER" as const })),
          ...preview.warnings.map((issue) => ({ ...issue, severity: "WARNING" as const })),
        ];

  const verdict: CompatibilityVerdict =
    data !== undefined
      ? data.capabilities.blockers.length > 0 ||
        !data.harness.enabled ||
        !data.executionProfile.enabled
        ? "blocked"
        : data.ready && data.capabilities.warnings.length === 0
          ? "ready"
          : "pending"
      : checking
        ? "checking"
        : preview !== null && preview.blockers.length > 0
          ? "blocked"
          : "preview";

  const color =
    verdict === "blocked"
      ? "var(--destructive)"
      : verdict === "ready"
        ? ACCENT_GREEN
        : verdict === "pending"
          ? ACCENT_AMBER
          : "var(--muted-foreground)";
  const Icon = verdict === "blocked" ? ShieldX : verdict === "ready" ? ShieldCheck : TriangleAlert;

  return (
    <div
      className="border-border flex flex-col gap-3 rounded-lg border px-3.5 py-3"
      data-loadout-compat={verdict}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <Icon aria-hidden className="size-3.5" style={{ color }} />
            <span>{t("loadout.compat.title")}</span>
            <span
              className="rounded-md border px-1.5 py-px text-[10.5px]"
              data-loadout-compat-verdict={verdict}
              style={{ borderColor: tint(color, 45), color }}
            >
              {verdict === "blocked"
                ? t("loadout.compat.blocked")
                : verdict === "ready"
                  ? t("loadout.compat.ready")
                  : verdict === "pending"
                    ? t("loadout.compat.pending")
                    : verdict === "checking"
                      ? t("loadout.compat.checking")
                      : t("loadout.compat.preview")}
            </span>
          </span>
          <span className="text-muted-foreground text-[11.5px] leading-4.5">
            {t("loadout.compat.description")}
          </span>
        </div>

        {loadout !== null && (
          <Button
            className="flex-none"
            data-loadout-compat-check
            disabled={checking || draft.dirty}
            onClick={() => {
              void preflight.refetch();
            }}
            size="xs"
            variant="outline"
          >
            <RefreshCw aria-hidden className={cn(checking && "animate-spin")} />
            <span>{checking ? t("loadout.compat.checking") : t("loadout.compat.check")}</span>
          </Button>
        )}
      </div>

      {/* A prévia pela matriz, sempre que o rascunho difere do salvo ou não há salvo. */}
      {(data === undefined || draft.dirty) && preview !== null && (
        <div className="flex flex-col gap-2" data-loadout-compat-preview>
          {previewIssues.length === 0 ? (
            <span className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
              <Check aria-hidden className="size-3.5" style={{ color: ACCENT_GREEN }} />
              <span>{t("loadout.compat.none")}</span>
            </span>
          ) : (
            <CapabilityIssueList issues={previewIssues} />
          )}
          <span className="text-muted-foreground text-[11px] leading-4">
            {loadout === null || draft.dirty
              ? t("loadout.compat.unsaved")
              : t("loadout.compat.preview")}
          </span>
        </div>
      )}

      {preflight.isError && !draft.dirty && (
        <span className="text-destructive text-[12px]">{preflight.error.message}</span>
      )}

      {data !== undefined && !draft.dirty && <Report data={data} />}
    </div>
  );
}

/** O relatório completo, como a API o devolveu. */
function Report({ data }: { data: LoadoutPreflightRecord }) {
  const { t, format } = useGlossary();
  const issues: CapabilityIssueView[] = [
    ...data.capabilities.blockers,
    ...data.capabilities.warnings,
  ];

  return (
    <div className="flex flex-col gap-3" data-loadout-compat-report>
      {!data.harness.enabled && <Line tone="bad">{t("loadout.compat.harnessDisabled")}</Line>}
      {!data.executionProfile.enabled && (
        <Line tone="bad">{t("loadout.compat.profileDisabled")}</Line>
      )}

      {issues.length === 0 ? (
        <Line tone="ok">{t("loadout.compat.none")}</Line>
      ) : (
        <CapabilityIssueList issues={issues} />
      )}

      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <Fact label={t("loadout.compat.cli")}>
          {data.cli === null ? (
            <span className="text-muted-foreground">{t("loadout.compat.cli.none")}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-x-1.5" data-loadout-compat-cli>
              <code className="font-mono text-[11px]">{data.cli.adapterId}</code>
              <span aria-hidden>·</span>
              <span
                style={{
                  color: data.cli.timedOut || !data.cli.installed ? ACCENT_AMBER : ACCENT_GREEN,
                }}
              >
                {data.cli.timedOut
                  ? t("loadout.compat.cli.timedOut")
                  : data.cli.installed
                    ? `${t("loadout.compat.cli.installed")}${data.cli.version === null ? "" : ` ${data.cli.version}`}`
                    : t("loadout.compat.cli.notInstalled")}
              </span>
              {data.cli.authenticated !== null && (
                <>
                  <span aria-hidden>·</span>
                  <span style={{ color: data.cli.authenticated ? ACCENT_GREEN : ACCENT_AMBER }}>
                    {data.cli.authenticated
                      ? t("loadout.compat.cli.authenticated")
                      : t("loadout.compat.cli.notAuthenticated")}
                  </span>
                </>
              )}
            </span>
          )}
        </Fact>

        <Fact label={t("entity.provider")}>
          {data.provider === null ? (
            <span className="text-muted-foreground">{t("loadout.compat.provider.none")}</span>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5" data-loadout-compat-provider>
              <span>{data.provider.name}</span>
              <ProviderAuthBadge status={data.provider.status} />
            </span>
          )}
        </Fact>

        {data.provider !== null && data.provider.authEnvKeys.length > 0 && (
          <span className="text-muted-foreground text-[11px] sm:col-span-2">
            {format(t("loadout.compat.provider.keys"), {
              keys: data.provider.authEnvKeys
                .map((key) =>
                  data.provider !== null && data.provider.presentEnvKeys.includes(key)
                    ? `${key} ✓`
                    : key,
                )
                .join(", "),
            })}
          </span>
        )}

        {data.docker !== null && (
          <Fact label={t("loadout.compat.container")}>
            <span className="flex flex-wrap items-center gap-x-2" data-loadout-compat-docker>
              <span className="flex items-center gap-1">
                {data.docker.daemonReachable ? (
                  <Check aria-hidden className="size-3" style={{ color: ACCENT_GREEN }} />
                ) : (
                  <X aria-hidden className="text-muted-foreground size-3" />
                )}
                <span>{t("loadout.compat.container.daemon")}</span>
              </span>
              <span className="flex items-center gap-1">
                {data.docker.imagePresent ? (
                  <Check aria-hidden className="size-3" style={{ color: ACCENT_GREEN }} />
                ) : (
                  <X aria-hidden className="text-muted-foreground size-3" />
                )}
                <span>{t("loadout.compat.container.image")}</span>
                <code className="text-muted-foreground font-mono text-[10.5px]">
                  {data.docker.imageName}
                </code>
              </span>
            </span>
          </Fact>
        )}
      </div>

      {(data.cli?.problems.length ?? 0) > 0 && (
        <ul className="text-muted-foreground m-0 flex list-none flex-col gap-1 p-0 text-[11.5px] leading-4.5">
          {data.cli?.problems.map((problem, index) => (
            <li data-loadout-compat-problem={problem.code} key={`${problem.code}-${String(index)}`}>
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      <span className="text-muted-foreground text-[11px]" data-loadout-compat-checked-at>
        {format(t("loadout.compat.checkedAt"), {
          when: relativeTime(data.checkedAt),
          ms: NUMBER.format(data.durationMs),
        })}
      </span>
    </div>
  );
}

function Line({ tone, children }: { tone: "ok" | "bad"; children: ReactNode }) {
  const color = tone === "ok" ? ACCENT_GREEN : "var(--destructive)";
  const Icon = tone === "ok" ? Check : X;
  return (
    <span className="flex items-center gap-1.5 text-[12px]">
      <Icon aria-hidden className="size-3.5" style={{ color }} />
      <span>{children}</span>
    </span>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 text-[12px]">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
