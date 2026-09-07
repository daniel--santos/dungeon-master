import type { McpTransport } from "@dungeon-master/contracts";
import { Gem, Plus, WandSparkles, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ChipInput } from "@/components/execution/chip-input";
import type { LoadoutRecord, McpServerRecord } from "@/lib/api-types";
import { EnforcementText } from "@/components/execution/chips";
import { EnvBadge } from "@/components/execution/env-badge";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AGENT_ROLE, WORKSPACE_STRATEGY } from "@/lib/execution-domain";
import {
  useAgents,
  useCreateLoadout,
  useExecutionProfiles,
  useHarnesses,
  useModels,
  useUpdateLoadout,
} from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";

/** O Radix recusa `value=""`, então "usar o padrão" precisa de um valor próprio. */
const HARNESS_DEFAULT = "__default__";

export interface LoadoutFormProps {
  /** `null` monta um Loadout novo; um Loadout edita aquele. */
  readonly loadout: LoadoutRecord | null;
  readonly onSaved: (loadout: LoadoutRecord) => void;
  readonly onCancel: () => void;
}

/**
 * O formulário de Loadout: o que um Agent leva para a execução.
 *
 * A `version` é mostrada e nunca editada: ela sobe no servidor, e só quando a
 * edição muda alguma coisa. Cada Run congela o número junto do snapshot, então
 * o que aparece aqui é o que a próxima Expedição vai carregar — não o que a
 * anterior carregou.
 *
 * O resumo do perfil fica visível o tempo todo, e não escondido atrás do
 * seletor, porque é ali que mora a diferença entre rodar isolado e rodar na
 * máquina de quem clicou.
 */
export function LoadoutForm({ loadout, onSaved, onCancel }: LoadoutFormProps) {
  const { t, format } = useGlossary();

  const agents = useAgents();
  const harnesses = useHarnesses();
  const models = useModels();
  const profiles = useExecutionProfiles();

  const create = useCreateLoadout();
  const update = useUpdateLoadout();

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [harnessId, setHarnessId] = useState("");
  const [modelId, setModelId] = useState<string>(HARNESS_DEFAULT);
  const [executionProfileId, setExecutionProfileId] = useState("");
  const [skills, setSkills] = useState<readonly string[]>([]);
  const [tools, setTools] = useState<readonly string[]>([]);
  const [mcpServers, setMcpServers] = useState<readonly McpServerRecord[]>([]);
  const [addingServer, setAddingServer] = useState(false);

  const enabledHarnesses = (harnesses.data?.items ?? []).filter((harness) => harness.enabled);
  const enabledProfiles = (profiles.data?.items ?? []).filter((profile) => profile.enabled);

  useEffect(() => {
    setName(loadout?.name ?? "");
    setAgentId(loadout?.agentId ?? "");
    setHarnessId(loadout?.harnessId ?? "");
    setModelId(loadout?.modelId ?? HARNESS_DEFAULT);
    setExecutionProfileId(loadout?.executionProfileId ?? "");
    setSkills(loadout?.skills ?? []);
    setTools(loadout?.tools ?? []);
    setMcpServers(loadout?.mcpServers ?? []);
  }, [loadout]);

  // Um Loadout novo já abre com a escolha óbvia: o primeiro Harness ligado e o
  // perfil padrão. Deixar tudo vazio faria o usuário preencher o que o sistema
  // já sabe.
  useEffect(() => {
    if (loadout !== null) return;
    if (harnessId === "" && enabledHarnesses[0] !== undefined) setHarnessId(enabledHarnesses[0].id);
    if (executionProfileId === "") {
      const fallback = enabledProfiles.find((profile) => profile.isDefault) ?? enabledProfiles[0];
      if (fallback !== undefined) setExecutionProfileId(fallback.id);
    }
  }, [enabledHarnesses, enabledProfiles, executionProfileId, harnessId, loadout]);

  const harnessModels = useMemo(
    () => (models.data?.items ?? []).filter((model) => model.harnessId === harnessId),
    [harnessId, models.data],
  );

  // Trocar de Harness invalida o Model escolhido: a API recusa um Model de
  // outro Harness, e deixar a escolha velha na tela só adiaria o erro.
  useEffect(() => {
    if (modelId === HARNESS_DEFAULT) return;
    if (!harnessModels.some((model) => model.id === modelId)) setModelId(HARNESS_DEFAULT);
  }, [harnessModels, modelId]);

  const profile = enabledProfiles.find((item) => item.id === executionProfileId);
  const agent = (agents.data?.items ?? []).find((item) => item.id === agentId);

  const pending = create.isPending || update.isPending;
  const valid =
    name.trim() !== "" && agentId !== "" && harnessId !== "" && executionProfileId !== "";

  function save() {
    const body = {
      name: name.trim(),
      agentId,
      harnessId,
      modelId: modelId === HARNESS_DEFAULT ? null : modelId,
      executionProfileId,
      skills: [...skills],
      tools: [...tools],
      mcpServers: [...mcpServers],
    };

    const done = {
      onSuccess: (saved: LoadoutRecord) => {
        onSaved(saved);
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    if (loadout === null) create.mutate(body, done);
    else update.mutate({ id: loadout.id, ...body }, done);
  }

  return (
    <Panel className="flex flex-col gap-4 px-5 pt-4.5 pb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">
            {loadout === null
              ? format("Novo {loadout}", { loadout: t("entity.loadout") })
              : loadout.name}
          </span>
          <span className="text-muted-foreground text-xs">
            {loadout === null
              ? format("Nasce em {version}", { version: "v1" })
              : format("{version} · congelada em cada {run} que a usou", {
                  version: `v${String(loadout.version)}`,
                  run: t("entity.run"),
                })}
          </span>
        </div>

        <div className="flex flex-none items-center gap-2">
          <Button onClick={onCancel} size="sm" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={!valid || pending} onClick={save} size="sm">
            Salvar
          </Button>
        </div>
      </div>

      <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="loadout-name">Nome</Label>
          <Input
            id="loadout-name"
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
            value={name}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="loadout-agent">{t("entity.agent")}</Label>
          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger aria-label={t("entity.agent")} id="loadout-agent">
              <SelectValue placeholder={t("entity.agent")} />
            </SelectTrigger>
            <SelectContent>
              {(agents.data?.items ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {`${item.name} · ${t(AGENT_ROLE[item.role])}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="loadout-harness">{t("entity.harness")}</Label>
          <Select value={harnessId} onValueChange={setHarnessId}>
            <SelectTrigger aria-label={t("entity.harness")} id="loadout-harness">
              <SelectValue placeholder={t("entity.harness")} />
            </SelectTrigger>
            <SelectContent>
              {enabledHarnesses.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="loadout-model">{t("entity.model")}</Label>
          <Select value={modelId} onValueChange={setModelId}>
            <SelectTrigger aria-label={t("entity.model")} id="loadout-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={HARNESS_DEFAULT}>
                {format("Padrão da {harness}", { harness: t("entity.harness") })}
              </SelectItem>
              {harnessModels.length > 0 && <SelectSeparator />}
              {harnessModels.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="loadout-profile">{t("entity.executionProfile")}</Label>
          <Select value={executionProfileId} onValueChange={setExecutionProfileId}>
            <SelectTrigger aria-label={t("entity.executionProfile")} id="loadout-profile">
              <SelectValue placeholder={t("entity.executionProfile")} />
            </SelectTrigger>
            <SelectContent>
              {enabledProfiles.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {`${item.name} · ${t(WORKSPACE_STRATEGY[item.workspaceStrategy])}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {profile !== undefined && (
        <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border bg-white/[0.03] px-3 py-2.5">
          <EnvBadge mode={profile.mode} size="sm" />
          <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <span>Workspace</span>
            <span className="text-foreground">
              {t(WORKSPACE_STRATEGY[profile.workspaceStrategy])}
            </span>
          </span>
          <span className="text-[11px]">
            <EnforcementText level={profile.enforcement} />
          </span>
          {agent !== undefined && (
            <span className="text-muted-foreground text-[11px]">{t(AGENT_ROLE[agent.role])}</span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <ChipInput
          icon={WandSparkles}
          label={t("entity.skill.plural")}
          onChange={setSkills}
          placeholder="Adicionar"
          values={skills}
        />
        <ChipInput
          icon={Wrench}
          label={t("entity.tool.plural")}
          onChange={setTools}
          placeholder="Adicionar"
          values={tools}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t("entity.mcpServer.plural")}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {mcpServers.map((server) => (
              <span
                key={server.name}
                className="border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs"
              >
                <Gem aria-hidden className="text-muted-foreground size-3.5" strokeWidth={1.5} />
                <span>{server.name}</span>
                <span className="text-muted-foreground text-[10px]">{server.transport}</span>
                <button
                  aria-label={`Remover ${server.name}`}
                  className="text-muted-foreground hover:text-foreground -mr-1 flex size-4 items-center justify-center rounded"
                  onClick={() => {
                    setMcpServers(mcpServers.filter((item) => item.name !== server.name));
                  }}
                  type="button"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            ))}

            <button
              className="border-input text-muted-foreground hover:text-foreground inline-flex h-[22px] items-center gap-1 rounded-lg border border-dashed px-2 text-xs"
              onClick={() => {
                setAddingServer(true);
              }}
              type="button"
            >
              <Plus aria-hidden className="size-3" />
              <span>Adicionar</span>
            </button>
          </div>
        </div>
      </div>

      <McpServerDialog
        onAdd={(server) => {
          setMcpServers([...mcpServers.filter((item) => item.name !== server.name), server]);
          setAddingServer(false);
        }}
        onOpenChange={setAddingServer}
        open={addingServer}
      />
    </Panel>
  );
}

const TRANSPORTS: readonly McpTransport[] = ["STDIO", "HTTP"];

/**
 * Um servidor MCP tem três campos, e nenhum deles cabe num chip.
 *
 * `target` é comando para `STDIO` e URL para `HTTP`. O valor entra inteiro e
 * nunca é montado por concatenação: quem executa recebe a string como está.
 */
function McpServerDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (server: McpServerRecord) => void;
}) {
  const { t } = useGlossary();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransport>("STDIO");
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setTransport("STDIO");
      setTarget("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("entity.mcpServer")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-name">Nome</Label>
            <Input
              id="mcp-name"
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
              }}
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-transport">Transporte</Label>
            <Select
              value={transport}
              onValueChange={(next) => {
                setTransport(next as McpTransport);
              }}
            >
              <SelectTrigger aria-label="Transporte" className="w-40" id="mcp-transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-target">{transport === "STDIO" ? "Comando" : "URL"}</Label>
            <Input
              className="font-mono text-[13px]"
              id="mcp-target"
              maxLength={2_000}
              onChange={(event) => {
                setTarget(event.target.value);
              }}
              value={target}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={name.trim() === "" || target.trim() === ""}
            onClick={() => {
              onAdd({ name: name.trim(), transport, target: target.trim() });
            }}
          >
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
