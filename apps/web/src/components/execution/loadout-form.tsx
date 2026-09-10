import { Backpack, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EnforcementText } from "@/components/execution/chips";
import { CompatibilityPanel } from "@/components/execution/compatibility-panel";
import { EnvBadge } from "@/components/execution/env-badge";
import { LoadoutHistory } from "@/components/execution/loadout-history";
import {
  McpServerPicker,
  SkillPicker,
  ToolPicker,
  type SkillPick,
} from "@/components/execution/reference-picker";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import type { ContextPolicyRecord, KnowledgePolicyRecord, LoadoutRecord } from "@/lib/api-types";
import { CONTEXT_COLOR } from "@/lib/context";
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
import { useMcpServers, useProviders, useSkills, useTools } from "@/lib/registry";

/** O Radix recusa `value=""`, então "usar o padrão" precisa de um valor próprio. */
const HARNESS_DEFAULT = "__default__";
const ANY_PROVIDER = "__any__";

/**
 * O que um Loadout novo pede do Grimório e da Missão: tudo, com o teto de
 * Páginas em 20. São os mesmos valores com que a API preenche um
 * `POST /loadouts` sem política (`DEFAULT_KNOWLEDGE_POLICY` e
 * `DEFAULT_CONTEXT_POLICY` em `packages/database`); repetidos aqui para o
 * formulário mostrar o que vai ser gravado em vez de campos vazios.
 */
const DEFAULT_KNOWLEDGE_POLICY: KnowledgePolicyRecord = {
  includeProjectSummary: true,
  includeDecisions: true,
  maxItems: 20,
};
const DEFAULT_CONTEXT_POLICY: ContextPolicyRecord = {
  includeParentContext: true,
  includeDependencyContext: true,
  maxTokens: 0,
};

/** Um inteiro não negativo digitado, ou `null` quando o texto não é um. */
function parseNonNegative(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

function samePicks(a: readonly SkillPick[], b: readonly SkillPick[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (pick, index) =>
        b[index]?.skillId === pick.skillId && b[index]?.pinnedVersion === pick.pinnedVersion,
    )
  );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => b[index] === id);
}

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
 * Desde a Fase 8C as Habilidades, os Itens e as Relíquias entram **por
 * referência** ao Arsenal (`skillRefs` com pin, `toolIds`, `mcpServerIds`), e
 * não mais como nomes soltos; o Patrono pode ser filtrado pelo Patronato que o
 * serve. Embaixo, o painel de compatibilidade responde a cada troca de Guilda
 * ou perfil pela matriz e, depois de salvar, pelo preflight completo; e o
 * histórico de versões mostra o que mudou e restaura.
 *
 * O resumo do perfil fica visível o tempo todo, e não escondido atrás do
 * seletor, porque é ali que mora a diferença entre rodar isolado e rodar na
 * máquina de quem clicou.
 *
 * O aviso de permissão aparece assim que o Harness escolhido declara
 * `nativePermissions: false`, e vem da matriz que a API expõe, não de uma
 * lista de nomes aqui: é a capability que diz que a allow-list do perfil não
 * vira barreira. O Antigravity ganha um parágrafo a mais porque erra para o
 * lado oposto dos demais — nega tudo em vez de deixar tudo passar — e só o
 * bypass do perfil libera (planejamento v0.4, fechamento da Fase 3). Nada
 * aqui muda a execução: é o mesmo aviso que o Worker escreve no diário,
 * antecipado para a hora da escolha.
 */
export function LoadoutForm({ loadout, onSaved, onCancel }: LoadoutFormProps) {
  const { t, format } = useGlossary();

  const agents = useAgents();
  const harnesses = useHarnesses();
  const models = useModels();
  const profiles = useExecutionProfiles();
  const providers = useProviders();
  const skillsQuery = useSkills();
  const toolsQuery = useTools();
  const serversQuery = useMcpServers();

  const create = useCreateLoadout();
  const update = useUpdateLoadout();

  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [harnessId, setHarnessId] = useState("");
  const [providerId, setProviderId] = useState<string>(ANY_PROVIDER);
  const [modelId, setModelId] = useState<string>(HARNESS_DEFAULT);
  const [executionProfileId, setExecutionProfileId] = useState("");
  const [skillRefs, setSkillRefs] = useState<readonly SkillPick[]>([]);
  const [toolIds, setToolIds] = useState<readonly string[]>([]);
  const [mcpServerIds, setMcpServerIds] = useState<readonly string[]>([]);
  const [knowledgePolicy, setKnowledgePolicy] =
    useState<KnowledgePolicyRecord>(DEFAULT_KNOWLEDGE_POLICY);
  const [contextPolicy, setContextPolicy] = useState<ContextPolicyRecord>(DEFAULT_CONTEXT_POLICY);
  // Os dois números ficam como texto até o envio, como nos blocos de Settings.
  const [maxItemsText, setMaxItemsText] = useState(String(DEFAULT_KNOWLEDGE_POLICY.maxItems));
  const [maxTokensText, setMaxTokensText] = useState(String(DEFAULT_CONTEXT_POLICY.maxTokens));

  const enabledHarnesses = (harnesses.data?.items ?? []).filter((harness) => harness.enabled);
  const enabledProfiles = (profiles.data?.items ?? []).filter((profile) => profile.enabled);
  const skills = skillsQuery.data?.items ?? [];
  const tools = toolsQuery.data?.items ?? [];
  const servers = serversQuery.data?.items ?? [];

  useEffect(() => {
    setName(loadout?.name ?? "");
    setAgentId(loadout?.agentId ?? "");
    setHarnessId(loadout?.harnessId ?? "");
    setModelId(loadout?.modelId ?? HARNESS_DEFAULT);
    setProviderId(ANY_PROVIDER);
    setExecutionProfileId(loadout?.executionProfileId ?? "");
    setSkillRefs(
      (loadout?.skillRefs ?? []).map((ref) => ({
        skillId: ref.skillId,
        pinnedVersion: ref.pinnedVersion,
      })),
    );
    setToolIds((loadout?.toolRefs ?? []).map((ref) => ref.toolId));
    setMcpServerIds((loadout?.mcpServerRefs ?? []).map((ref) => ref.mcpServerId));
    setKnowledgePolicy(loadout?.knowledgePolicy ?? DEFAULT_KNOWLEDGE_POLICY);
    setContextPolicy(loadout?.contextPolicy ?? DEFAULT_CONTEXT_POLICY);
    setMaxItemsText(String((loadout?.knowledgePolicy ?? DEFAULT_KNOWLEDGE_POLICY).maxItems));
    setMaxTokensText(String((loadout?.contextPolicy ?? DEFAULT_CONTEXT_POLICY).maxTokens));
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

  const harness = enabledHarnesses.find((item) => item.id === harnessId);

  // Os Patronatos que servem a Guilda escolhida; os outros não teriam Patrono aqui.
  const harnessProviders = useMemo(
    () =>
      (providers.data?.items ?? []).filter(
        (provider) => harness === undefined || provider.harnessKeys.includes(harness.key),
      ),
    [harness, providers.data],
  );

  const harnessModels = useMemo(
    () =>
      (models.data?.items ?? []).filter(
        (model) =>
          model.harnessId === harnessId &&
          (providerId === ANY_PROVIDER || model.providerId === providerId),
      ),
    [harnessId, models.data, providerId],
  );

  // Trocar de Harness invalida o Model escolhido: a API recusa um Model de
  // outro Harness, e deixar a escolha velha na tela só adiaria o erro. Trocar
  // o filtro de Patronato faz o mesmo com um Model que saiu da lista.
  useEffect(() => {
    if (modelId === HARNESS_DEFAULT) return;
    if (!harnessModels.some((model) => model.id === modelId)) setModelId(HARNESS_DEFAULT);
  }, [harnessModels, modelId]);

  useEffect(() => {
    if (providerId === ANY_PROVIDER) return;
    if (!harnessProviders.some((provider) => provider.id === providerId))
      setProviderId(ANY_PROVIDER);
  }, [harnessProviders, providerId]);

  const profile = enabledProfiles.find((item) => item.id === executionProfileId);
  const agent = (agents.data?.items ?? []).find((item) => item.id === agentId);
  const model = harnessModels.find((item) => item.id === modelId);
  const withoutNativePermissions = harness !== undefined && !harness.capabilities.nativePermissions;

  const maxItems = parseNonNegative(maxItemsText);
  const maxTokens = parseNonNegative(maxTokensText);

  const pending = create.isPending || update.isPending;
  const valid =
    name.trim() !== "" &&
    agentId !== "" &&
    harnessId !== "" &&
    executionProfileId !== "" &&
    maxItems !== null &&
    maxTokens !== null;

  // O que o preflight completo olha e o formulário pode ter mudado sem salvar:
  // a Guilda, o Patrono e as referências. O perfil vai como override, e por
  // isso não entra aqui.
  const savedPicks = useMemo<readonly SkillPick[]>(
    () =>
      (loadout?.skillRefs ?? []).map((ref) => ({
        skillId: ref.skillId,
        pinnedVersion: ref.pinnedVersion,
      })),
    [loadout],
  );
  const dirtyForPreflight =
    loadout === null ||
    harnessId !== loadout.harnessId ||
    (modelId === HARNESS_DEFAULT ? null : modelId) !== loadout.modelId ||
    !samePicks(skillRefs, savedPicks) ||
    !sameIds(
      toolIds,
      loadout.toolRefs.map((ref) => ref.toolId),
    ) ||
    !sameIds(
      mcpServerIds,
      loadout.mcpServerRefs.map((ref) => ref.mcpServerId),
    );

  const draft = useMemo(
    () => ({
      capabilities: harness?.capabilities,
      mode: profile?.mode,
      mcpServerNames: mcpServerIds.map(
        (id) => servers.find((server) => server.id === id)?.name ?? id,
      ),
      modelKey: model?.key ?? null,
      commandToolNames: toolIds
        .map((id) => tools.find((tool) => tool.id === id))
        .filter((tool) => tool !== undefined && tool.kind === "COMMAND")
        .map((tool) => tool!.name),
      dirty: dirtyForPreflight,
    }),
    [dirtyForPreflight, harness, mcpServerIds, model, profile, servers, toolIds, tools],
  );

  function save() {
    if (maxItems === null || maxTokens === null) return;
    const body = {
      name: name.trim(),
      agentId,
      harnessId,
      modelId: modelId === HARNESS_DEFAULT ? null : modelId,
      executionProfileId,
      skillRefs: skillRefs.map((pick) => ({
        skillId: pick.skillId,
        pinnedVersion: pick.pinnedVersion,
      })),
      toolIds: [...toolIds],
      mcpServerIds: [...mcpServerIds],
      knowledgePolicy: { ...knowledgePolicy, maxItems },
      contextPolicy: { ...contextPolicy, maxTokens },
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
          <Label htmlFor="loadout-provider">{t("entity.provider")}</Label>
          <Select value={providerId} onValueChange={setProviderId}>
            <SelectTrigger aria-label={t("entity.provider")} id="loadout-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_PROVIDER}>{t("loadout.model.anyProvider")}</SelectItem>
              {harnessProviders.length > 0 && <SelectSeparator />}
              {harnessProviders.map((item) => (
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

        <div className="flex flex-col gap-1.5">
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

        {withoutNativePermissions && (
          <div
            className="flex items-start gap-2.5 rounded-lg border border-accent-amber/40 bg-accent-amber/8 px-3 py-2.5 sm:col-span-2"
            data-loadout-permission-warning={harness.key}
            role="note"
          >
            <ShieldAlert
              aria-hidden
              className="mt-0.5 size-3.5 flex-none text-accent-amber"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[12.5px] font-medium">
                {t("loadout.noNativePermissions.title")}
              </span>
              <span className="text-muted-foreground text-[11.5px] leading-4.5">
                {format(t("loadout.noNativePermissions.body"), {
                  harness: t("entity.harness"),
                  profile: t("entity.executionProfile"),
                })}
              </span>
              {harness.key === "ANTIGRAVITY" && (
                <span
                  className="text-muted-foreground text-[11.5px] leading-4.5"
                  data-loadout-permission-bypass
                >
                  {format(t("loadout.noNativePermissions.antigravity"), {
                    host: t("env.host"),
                    hostWarning: t("env.host.warning"),
                    run: t("entity.run"),
                    profile: t("entity.executionProfile"),
                  })}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {profile !== undefined && (
        <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-white/[0.03] px-3 py-2.5">
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

      <div className="flex flex-col gap-3" data-loadout-references>
        <SkillPicker onChange={setSkillRefs} skills={skills} value={skillRefs} />
        <ToolPicker onChange={setToolIds} tools={tools} value={toolIds} />
        <McpServerPicker onChange={setMcpServerIds} servers={servers} value={mcpServerIds} />
        <span className="text-muted-foreground text-[11px] leading-4">
          {t("loadout.refs.hint")}
        </span>
      </div>

      <CompatibilityPanel
        draft={draft}
        executionProfileId={
          loadout !== null && executionProfileId !== loadout.executionProfileId
            ? executionProfileId
            : undefined
        }
        loadout={loadout}
      />

      <div
        className="border-border flex flex-col gap-3 rounded-lg border px-3.5 py-3"
        data-loadout-policy
      >
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[13px] font-medium">
            <Backpack aria-hidden className="size-3.5" style={{ color: CONTEXT_COLOR }} />
            <span>{t("loadout.policy.title")}</span>
          </span>
          <span className="text-muted-foreground text-[11.5px] leading-4.5">
            {t("loadout.policy.description")}
          </span>
        </div>

        <div className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
          <PolicySwitch
            checked={knowledgePolicy.includeProjectSummary}
            id="loadout-policy-summary"
            label={t("loadout.policy.includeProjectSummary")}
            name="includeProjectSummary"
            onChange={(checked) => {
              setKnowledgePolicy({ ...knowledgePolicy, includeProjectSummary: checked });
            }}
          />
          <PolicySwitch
            checked={knowledgePolicy.includeDecisions}
            id="loadout-policy-decisions"
            label={t("loadout.policy.includeDecisions")}
            name="includeDecisions"
            onChange={(checked) => {
              setKnowledgePolicy({ ...knowledgePolicy, includeDecisions: checked });
            }}
          />
          <PolicySwitch
            checked={contextPolicy.includeParentContext}
            id="loadout-policy-parent"
            label={t("loadout.policy.includeParentContext")}
            name="includeParentContext"
            onChange={(checked) => {
              setContextPolicy({ ...contextPolicy, includeParentContext: checked });
            }}
          />
          <PolicySwitch
            checked={contextPolicy.includeDependencyContext}
            id="loadout-policy-dependencies"
            label={t("loadout.policy.includeDependencyContext")}
            name="includeDependencyContext"
            onChange={(checked) => {
              setContextPolicy({ ...contextPolicy, includeDependencyContext: checked });
            }}
          />

          <PolicyNumber
            description={t("loadout.policy.maxItems.description")}
            id="loadout-policy-max-items"
            invalid={maxItems === null}
            label={t("loadout.policy.maxItems")}
            name="maxItems"
            onChange={setMaxItemsText}
            value={maxItemsText}
          />
          <PolicyNumber
            description={t("loadout.policy.maxTokens.description")}
            id="loadout-policy-max-tokens"
            invalid={maxTokens === null}
            label={t("loadout.policy.maxTokens")}
            name="maxTokens"
            onChange={setMaxTokensText}
            suffix="tokens"
            value={maxTokensText}
          />
        </div>
      </div>

      {loadout !== null && <LoadoutHistory loadout={loadout} onRestored={onSaved} />}
    </Panel>
  );
}

function PolicySwitch({
  id,
  label,
  name,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-[12.5px]" htmlFor={id}>
        {label}
      </Label>
      <Switch
        checked={checked}
        data-loadout-policy-switch={name}
        id={id}
        onCheckedChange={onChange}
        size="sm"
      />
    </div>
  );
}

function PolicyNumber({
  id,
  label,
  description,
  name,
  value,
  onChange,
  invalid,
  suffix,
}: {
  id: string;
  label: string;
  description: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[12.5px]" htmlFor={id}>
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          aria-invalid={invalid}
          className="w-28 font-mono"
          data-loadout-policy-field={name}
          id={id}
          inputMode="numeric"
          min={0}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          type="number"
          value={value}
        />
        {suffix !== undefined && (
          <span className="text-muted-foreground text-[12px]">{suffix}</span>
        )}
      </div>
      <span
        className={invalid ? "text-destructive text-[11px]" : "text-muted-foreground text-[11px]"}
      >
        {invalid ? "Um inteiro a partir de 0." : description}
      </span>
    </div>
  );
}
