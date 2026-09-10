import { Check, ShieldAlert, X } from "lucide-react";
import type { ReactNode } from "react";

import { EnvBadge } from "@/components/execution/env-badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { DockerPreflightRecord, HarnessRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useDockerPreflight, useExecutionProfiles, useHarnesses } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useHostAcknowledgement } from "@/lib/settings";

/**
 * A seção "Execução" de Settings: o aceite do modo host, e como revogá-lo.
 *
 * O aceite é lembrado para que o diálogo de partida não pergunte a cada
 * Expedição — perguntar sempre treina o usuário a marcar sem ler. Revogar
 * precisa existir no mesmo lugar, e ser um clique, porque um aceite que não se
 * desfaz não é um aceite.
 *
 * O badge fica aqui mesmo quando o aceite está dado: lembrar a decisão não é o
 * mesmo que esconder o que ela significa.
 */
export function ExecutionSection() {
  const { t, format } = useGlossary();
  const host = useHostAcknowledgement();
  const harnesses = useHarnesses();
  const profiles = useExecutionProfiles();

  const dockerProfile = (profiles.data?.items ?? []).find(
    (profile) => profile.mode === "DOCKER" && profile.enabled,
  );
  const harnessItems = harnesses.data?.items ?? [];

  return (
    <section className="bg-card border-border flex max-w-190 flex-col gap-4.5 rounded-xl border p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold">Ambiente de execução</span>
        <span className="text-muted-foreground text-[13px]">
          {format("Onde uma {run} roda, e o que você já aceitou sobre isso.", {
            run: t("entity.run"),
          })}
        </span>
      </div>

      <Separator />

      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ShieldAlert aria-hidden className="text-destructive size-3.5" />
            <span className="text-sm font-medium">
              {format("Aceite de execução {warning}", { warning: t("env.host.warning") })}
            </span>
          </div>

          <span className="text-muted-foreground text-[13px] leading-5">
            {host.acknowledged
              ? format(
                  "O aceite está dado: o {agent} pode rodar direto nesta máquina, com acesso ao disco e à rede. O diálogo de partida não pergunta de novo enquanto ele valer.",
                  { agent: t("entity.agent") },
                )
              : format(
                  "Nenhum aceite dado. A próxima {run} em {host} vai pedir o aceite explícito antes de partir.",
                  { run: t("entity.run"), host: t("env.host") },
                )}
          </span>

          <EnvBadge className="mt-0.5" mode="HOST" size="md" />
        </div>

        {host.acknowledged && (
          <Button
            className="flex-none"
            disabled={host.isLoading || host.isSaving}
            onClick={() => {
              host.set(false);
            }}
            size="sm"
            variant="outline"
          >
            Revogar
          </Button>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-3" data-docker-execution>
        <div className="flex items-start justify-between gap-8">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("env.docker")}</span>
            <span className="text-muted-foreground text-[13px] leading-5">
              {dockerProfile === undefined
                ? format(
                    "Nenhum perfil em container habilitado. Enquanto não houver um, o diálogo de partida não deixa escolher {docker}.",
                    { docker: t("env.docker") },
                  )
                : format(
                    "O perfil {profile} está habilitado, então a partida pode acontecer dentro de um container. Quais {harnesses} sabem rodar lá é declarado pelo adapter, e não descoberto:",
                    {
                      profile: dockerProfile.name,
                      harnesses: t("entity.harness.plural"),
                    },
                  )}
            </span>
            <EnvBadge className="mt-0.5" mode="DOCKER" size="md" />
          </div>
        </div>

        <ul className="flex flex-col gap-1.5">
          {harnessItems.map((harness) => (
            <PreflightRow
              data-docker-harness={harness.key}
              detail={harness.installedVersion ?? "—"}
              key={harness.id}
              label={harness.name}
              ok={harness.capabilities.dockerExecution}
              when={harness.checkedAt}
            />
          ))}
        </ul>

        <span className="text-muted-foreground text-[11.5px] leading-4.5">
          A versão e a data acima vêm do preflight de cada CLI no host, gravado pelo Worker no boot.
        </span>

        <DockerPreflightBlock harnesses={harnessItems} />
      </div>
    </section>
  );
}

/**
 * Uma linha de preflight: o mesmo desenho para a CLI de host, o daemon, a
 * imagem e cada harness dentro do container. O verde e o cinza são os mesmos
 * porque o significado é o mesmo — medido e aprovado, ou não.
 */
function PreflightRow({
  ok,
  label,
  detail,
  status,
  when,
  ...rest
}: {
  readonly ok: boolean;
  readonly label: ReactNode;
  readonly detail: ReactNode;
  /** Um terceiro campo, quando houver: a credencial, ou o motivo da falha. */
  readonly status?: ReactNode;
  readonly when: string | null;
  readonly [attribute: `data-${string}`]: string | undefined;
}) {
  return (
    <li
      className="border-border flex items-center gap-3 rounded-lg border bg-white/[0.025] px-3 py-2"
      data-docker-preflight-ok={String(ok)}
      {...rest}
    >
      <span className={ok ? "text-accent-green flex" : "text-muted-foreground flex"}>
        {ok ? <Check aria-hidden className="size-3.5" /> : <X aria-hidden className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      {status !== undefined && (
        <span className="text-muted-foreground flex-none text-[11px]">{status}</span>
      )}
      <span className="text-muted-foreground flex-none text-[11.5px]">{detail}</span>
      <span className="text-muted-foreground w-28 flex-none text-right text-[11px]">
        {when === null ? "—" : relativeTime(when)}
      </span>
    </li>
  );
}

/**
 * O preflight do container, medido quando o usuário pede.
 *
 * Sem o nome do modo aqui: "o preflight do próprio Masmorra selada" não é
 * frase. Container é infraestrutura, e infraestrutura não é tematizada
 * (planejamento v0.4, seção 14). O que é tematizado — o nome do harness —
 * vem do cadastro, e não do id do adapter.
 */
function DockerPreflightBlock({ harnesses }: { readonly harnesses: readonly HarnessRecord[] }) {
  const { t, format } = useGlossary();
  const preflight = useDockerPreflight();
  const data = preflight.data;

  const state =
    data === undefined
      ? preflight.isFetching
        ? "checking"
        : preflight.isError
          ? "error"
          : "idle"
      : data.daemon.reachable && data.image.present
        ? "ok"
        : "problem";

  const nameOf = (item: DockerPreflightRecord["harnesses"][number]) =>
    harnesses.find((harness) => harness.key === item.harnessKey)?.name ?? item.adapterId;

  return (
    <div className="flex flex-col gap-2.5" data-docker-preflight={state}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Preflight do container</span>
          <span className="text-muted-foreground text-[11.5px] leading-4.5">
            {format(
              "Medido na hora, e só quando você pede: daemon, imagem e, por {harnesses} que roda em container, versão e credencial de dentro da imagem.",
              { harnesses: t("entity.harness") },
            )}
          </span>
        </div>
        <Button
          className="flex-none"
          disabled={preflight.isFetching}
          onClick={() => {
            void preflight.refetch();
          }}
          size="sm"
          variant="outline"
        >
          {preflight.isFetching
            ? "Verificando…"
            : data === undefined
              ? "Verificar agora"
              : "Verificar de novo"}
        </Button>
      </div>

      {state === "idle" && (
        <span className="text-muted-foreground text-[11.5px] leading-4.5">
          Ainda não verificado nesta sessão. A verificação sobe um container descartável por harness
          e leva alguns segundos; ela nunca roda sozinha.
        </span>
      )}

      {preflight.isError && (
        <span className="text-destructive text-[12px] leading-4.5">{preflight.error.message}</span>
      )}

      {data !== undefined && (
        <>
          <ul className="flex flex-col gap-1.5">
            <PreflightRow
              data-docker-preflight-row="daemon"
              detail={data.daemon.serverVersion ?? "—"}
              // Só "Daemon": o nome do backend é o label de ambiente do glossário, e
              // a varredura de labels o proíbe escrito à mão, mesmo em infraestrutura.
              label="Daemon"
              ok={data.daemon.reachable}
              when={data.checkedAt}
            />
            <PreflightRow
              data-docker-preflight-row="image"
              detail={data.image.user === null ? "—" : `USER ${data.image.user}`}
              label={data.image.name}
              ok={data.image.present}
              when={data.checkedAt}
            />
            {data.harnesses.map((item) => {
              const fatal = item.problems.some((problem) => problem.fatal);
              return (
                <PreflightRow
                  data-docker-preflight-harness={item.harnessKey}
                  detail={item.timedOut ? "não respondeu no tempo" : (item.version ?? "—")}
                  key={item.adapterId}
                  label={nameOf(item)}
                  ok={item.installed && !item.timedOut && !fatal}
                  status={
                    item.authenticated === null
                      ? undefined
                      : item.authenticated
                        ? "autenticado"
                        : "sem credencial"
                  }
                  when={data.checkedAt}
                />
              );
            })}
          </ul>

          {(data.problems.length > 0 ||
            data.harnesses.some((item) => item.problems.length > 0)) && (
            <ul className="text-muted-foreground m-0 flex list-none flex-col gap-1 p-0 text-[11.5px] leading-4.5">
              {data.problems.map((problem, index) => (
                <li data-docker-preflight-problem={problem.code} key={`env-${String(index)}`}>
                  {problem.message}
                </li>
              ))}
              {data.harnesses.flatMap((item) =>
                item.problems.map((problem, index) => (
                  <li
                    data-docker-preflight-problem={problem.code}
                    key={`${item.adapterId}-${String(index)}`}
                  >
                    {`${nameOf(item)}: ${problem.message}`}
                  </li>
                )),
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
