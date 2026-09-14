import {
  ChevronDown,
  ChevronUp,
  Gem,
  KeyRound,
  Lock,
  Package,
  Pin,
  Wrench,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";

import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import type { RunRecord, SkillVersionSnapshotRecord } from "@/lib/api-types";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { mcpServerTarget, REGISTRY_COLOR, TOOL_KIND } from "@/lib/registry-domain";

const CHIP =
  "border-border inline-flex h-[22px] w-fit max-w-full items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs";

export interface FrozenLoadoutPanelProps {
  readonly run: RunRecord;
}

/**
 * O Equipamento congelado no cockpit (Fase 8C): o que a Expedição levou,
 * como estava na partida.
 *
 * Tudo vem do snapshot do Run, e nada dos cadastros: renomear uma Habilidade,
 * publicar uma versão nova ou apagar uma Relíquia depois não pode reescrever
 * o que uma execução passada usou. As Habilidades aparecem com a versão
 * efetiva — a fixada, ou a mais recente na hora da partida — e o texto
 * exato, recolhido; os Itens com a definição; as Relíquias com comando e
 * argumentos (ou URL), os nomes das variáveis e as marcas de só leitura e
 * nascida com o sistema. Um Run anterior à Fase 8 só tem os nomes, e o
 * painel diz isso em vez de mostrar campos vazios.
 *
 * Todo texto é dado — o markdown da Habilidade é escrito pelo usuário — e vai
 * à tela como texto, nunca como HTML.
 */
export function FrozenLoadoutPanel({ run }: FrozenLoadoutPanelProps) {
  const { t, format } = useGlossary();
  const snapshot = run.loadoutSnapshot;
  const legacy = snapshot.skillVersions === undefined || snapshot.toolDefinitions === undefined;

  return (
    <Panel
      className="flex flex-col gap-4 px-4 pt-3.5 pb-4"
      data-run-frozen-loadout={snapshot.version}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Package aria-hidden className="size-3.75" style={{ color: REGISTRY_COLOR }} />
            <span>{t("run.frozen.title")}</span>
            <span className="text-muted-foreground font-mono text-[11px]" data-run-frozen-version>
              {`${snapshot.name} · v${String(snapshot.version)}`}
            </span>
          </span>
          <span className="text-muted-foreground text-[11.5px] leading-4.5">
            {t("run.frozen.description")}
          </span>
        </div>
        <span className="text-muted-foreground flex-none text-[11px]">
          {format("Congelado em {when}", { when: formatDateTime(snapshot.capturedAt) })}
        </span>
      </div>

      {legacy && (
        <p className="text-muted-foreground m-0 text-[12px] leading-4.5" data-run-frozen-legacy>
          {t("run.frozen.legacy")}
        </p>
      )}

      <Section icon={WandSparkles} label={t("entity.skill.plural")}>
        {legacy ? (
          <Names names={snapshot.skills} />
        ) : (snapshot.skillVersions ?? []).length === 0 ? (
          <span className="text-muted-foreground text-[12px]">{t("run.frozen.none")}</span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {(snapshot.skillVersions ?? []).map((skill) => (
              <SkillRow key={skill.skillId} skill={skill} />
            ))}
          </ul>
        )}
      </Section>

      <Section icon={Wrench} label={t("entity.tool.plural")}>
        {legacy ? (
          <Names names={snapshot.tools} />
        ) : (snapshot.toolDefinitions ?? []).length === 0 ? (
          <span className="text-muted-foreground text-[12px]">{t("run.frozen.none")}</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {(snapshot.toolDefinitions ?? []).map((tool) => (
              <span key={tool.toolId} className={CHIP} data-run-frozen-tool={tool.name}>
                <Wrench aria-hidden className="text-muted-foreground size-3" strokeWidth={1.5} />
                <span>{tool.name}</span>
                <span className="text-muted-foreground text-[10px]">{t(TOOL_KIND[tool.kind])}</span>
                <code className="text-muted-foreground font-mono text-[10.5px]">
                  {tool.kind === "COMMAND"
                    ? (tool.command ?? "")
                    : `${tool.mcpServerName ?? ""} · ${tool.toolName ?? ""}`}
                </code>
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Gem} label={t("entity.mcpServer.plural")}>
        {snapshot.mcpServers.length === 0 ? (
          <span className="text-muted-foreground text-[12px]">{t("run.frozen.none")}</span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {snapshot.mcpServers.map((server) => (
              <li
                key={server.name}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]"
                data-run-frozen-mcp={server.name}
              >
                <span className="font-mono font-medium">{server.name}</span>
                <span className="text-muted-foreground font-mono text-[10.5px]">
                  {server.transport}
                </span>
                <code className="text-muted-foreground min-w-0 truncate font-mono text-[10.5px]">
                  {server.command !== undefined && server.command !== null
                    ? mcpServerTarget({
                        transport: server.transport,
                        command: server.command,
                        args: server.args ?? [],
                        url: server.url ?? null,
                      })
                    : server.target}
                </code>
                {server.readOnly === true && (
                  <span className="text-muted-foreground flex items-center gap-1 text-[10.5px]">
                    <Lock aria-hidden className="size-2.75" />
                    <span>{t("mcpServer.readOnly")}</span>
                  </span>
                )}
                {server.builtIn === true && (
                  <span className="text-[10.5px]" style={{ color: REGISTRY_COLOR }}>
                    {t("mcpServer.builtIn")}
                  </span>
                )}
                {server.envKeys !== undefined && server.envKeys.length > 0 && (
                  <span className="text-muted-foreground flex items-center gap-1 text-[10.5px]">
                    <KeyRound aria-hidden className="size-2.75" />
                    <code className="font-mono">{server.envKeys.join(", ")}</code>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Panel>
  );
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Gem;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground flex items-center gap-1.5 text-[11px] tracking-[0.06em] uppercase">
        <Icon aria-hidden className="size-3" />
        <span>{label}</span>
      </span>
      {children}
    </div>
  );
}

function Names({ names }: { names: readonly string[] }) {
  const { t } = useGlossary();
  if (names.length === 0) {
    return <span className="text-muted-foreground text-[12px]">{t("run.frozen.none")}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {names.map((name) => (
        <span key={name} className={CHIP}>
          {name}
        </span>
      ))}
    </div>
  );
}

function SkillRow({ skill }: { skill: SkillVersionSnapshotRecord }) {
  const { t } = useGlossary();
  const [open, setOpen] = useState(false);

  return (
    <li className="flex flex-col gap-1" data-run-frozen-skill={skill.name}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium">{skill.name}</span>
        <span className="font-mono text-[11px]" data-run-frozen-skill-version={skill.version}>
          {`v${String(skill.version)}`}
        </span>
        <span className="text-muted-foreground flex items-center gap-1 text-[10.5px]">
          {skill.pinned && (
            <Pin aria-hidden className="size-2.75" style={{ color: REGISTRY_COLOR }} />
          )}
          <span>
            {skill.pinned ? t("skill.version.pinned") : t("skill.version.latestAtDeparture")}
          </span>
        </span>
        <span className="flex-1" />
        <Button
          aria-expanded={open}
          data-run-frozen-skill-toggle
          onClick={() => {
            setOpen((current) => !current);
          }}
          size="xs"
          variant="ghost"
        >
          {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          <span>{open ? t("run.frozen.hide") : t("run.frozen.show")}</span>
        </Button>
      </div>
      {open && (
        <pre
          className="border-border m-0 max-h-80 overflow-auto rounded-lg border bg-white/[0.03] px-3 py-2.5 font-mono text-[11px] leading-4.5 whitespace-pre-wrap"
          data-run-frozen-skill-content
        >
          {skill.content === "" ? t("skill.content.empty") : skill.content}
        </pre>
      )}
    </li>
  );
}
