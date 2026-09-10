import { Gem, Lock, Pin, Plus, WandSparkles, Wrench, X, type LucideIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { McpServerRegistryRecord, SkillRecord, ToolRecord } from "@/lib/api-types";
import { useGlossary } from "@/lib/glossary";
import { TOOL_KIND } from "@/lib/registry-domain";

/** O Radix recusa `value=""`, então "seguir a mais recente" precisa de um valor próprio. */
const LATEST = "__latest__";

/** Uma Skill escolhida no formulário: o id e o pin, como a API recebe. */
export interface SkillPick {
  readonly skillId: string;
  readonly pinnedVersion: number | null;
}

const CHIP =
  "border-border inline-flex h-[24px] w-fit max-w-full items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs";

function AddSelect({
  label,
  options,
  onAdd,
  attribute,
}: {
  label: string;
  options: readonly { readonly id: string; readonly name: string }[];
  onAdd: (id: string) => void;
  attribute: string;
}) {
  return (
    <Select
      disabled={options.length === 0}
      onValueChange={(id) => {
        onAdd(id);
      }}
      value=""
    >
      <SelectTrigger
        aria-label={label}
        className="border-input text-muted-foreground hover:text-foreground h-[24px] w-auto gap-1 rounded-lg border-dashed px-2 text-xs shadow-none"
        data-reference-add={attribute}
        size="sm"
      >
        <Plus aria-hidden className="size-3" />
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RemoveButton({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <button
      aria-label={`Remover ${name}`}
      className="text-muted-foreground hover:text-foreground -mr-1 flex size-4 items-center justify-center rounded"
      onClick={onRemove}
      type="button"
    >
      <X aria-hidden className="size-3" />
    </button>
  );
}

/**
 * As Habilidades do Equipamento, por referência e com pin (Fase 8C).
 *
 * Cada linha é uma Skill do Arsenal com o seletor de versão: "seguir a mais
 * recente" (nulo, resolvido na hora de congelar o Run) ou uma versão fixada,
 * de 1 até a mais recente publicada. O que aparece é o que a API recebe em
 * `skillRefs`; o nome e o `latestVersion` vêm da lista do Arsenal, não do
 * Loadout, para uma versão publicada agora já aparecer no pin.
 */
export function SkillPicker({
  skills,
  value,
  onChange,
}: {
  readonly skills: readonly SkillRecord[];
  readonly value: readonly SkillPick[];
  readonly onChange: (next: readonly SkillPick[]) => void;
}) {
  const { t, format } = useGlossary();
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const chosen = new Set(value.map((pick) => pick.skillId));
  const available = skills.filter((skill) => !chosen.has(skill.id));

  return (
    <div className="flex flex-col gap-1.5" data-reference-picker="skills">
      <span className="text-muted-foreground text-xs">{t("entity.skill.plural")}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((pick) => {
          const skill = byId.get(pick.skillId);
          const name = skill?.name ?? "…";
          const latest = skill?.latestVersion ?? pick.pinnedVersion ?? 1;
          const versions = Array.from({ length: latest }, (_, index) => latest - index);
          return (
            <span key={pick.skillId} className={CHIP} data-skill-ref={name}>
              <WandSparkles
                aria-hidden
                className="text-muted-foreground size-3.5"
                strokeWidth={1.5}
              />
              <span className="truncate">{name}</span>
              <Select
                onValueChange={(next) => {
                  onChange(
                    value.map((item) =>
                      item.skillId === pick.skillId
                        ? { ...item, pinnedVersion: next === LATEST ? null : Number(next) }
                        : item,
                    ),
                  );
                }}
                value={pick.pinnedVersion === null ? LATEST : String(pick.pinnedVersion)}
              >
                <SelectTrigger
                  aria-label={format("Versão de {name}", { name })}
                  className="h-[18px] gap-1 rounded-md border-none bg-transparent px-1 text-[10.5px] shadow-none"
                  data-skill-pin={
                    pick.pinnedVersion === null ? "latest" : String(pick.pinnedVersion)
                  }
                  size="sm"
                >
                  {pick.pinnedVersion !== null && (
                    <Pin aria-hidden className="size-2.75 text-accent-violet" />
                  )}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={LATEST}>
                    {`${t("loadout.pin.latest")} (v${String(latest)})`}
                  </SelectItem>
                  <SelectSeparator />
                  {versions.map((version) => (
                    <SelectItem key={version} value={String(version)}>
                      {format(t("loadout.pin.version"), { version: `v${String(version)}` })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <RemoveButton
                name={name}
                onRemove={() => {
                  onChange(value.filter((item) => item.skillId !== pick.skillId));
                }}
              />
            </span>
          );
        })}

        <AddSelect
          attribute="skills"
          label={format("Adicionar {skill}", { skill: t("entity.skill") })}
          onAdd={(id) => {
            onChange([...value, { skillId: id, pinnedVersion: null }]);
          }}
          options={available}
        />
      </div>
      <span className="text-muted-foreground text-[11px] leading-4">{t("loadout.pin.hint")}</span>
    </div>
  );
}

/** Os Itens ou as Relíquias do Equipamento, por referência. */
function IdPicker({
  attribute,
  label,
  addLabel,
  icon: Icon,
  items,
  value,
  onChange,
  detail,
}: {
  attribute: "tools" | "mcpServers";
  label: string;
  addLabel: string;
  icon: LucideIcon;
  items: readonly { readonly id: string; readonly name: string }[];
  value: readonly string[];
  onChange: (next: readonly string[]) => void;
  detail?: (id: string) => React.ReactNode;
}) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const chosen = new Set(value);
  const available = items.filter((item) => !chosen.has(item.id));

  return (
    <div className="flex flex-col gap-1.5" data-reference-picker={attribute}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((id) => {
          const name = byId.get(id)?.name ?? "…";
          return (
            <span key={id} className={CHIP} data-reference-ref={name}>
              <Icon aria-hidden className="text-muted-foreground size-3.5" strokeWidth={1.5} />
              <span className="truncate">{name}</span>
              {detail?.(id)}
              <RemoveButton
                name={name}
                onRemove={() => {
                  onChange(value.filter((item) => item !== id));
                }}
              />
            </span>
          );
        })}
        <AddSelect
          attribute={attribute}
          label={addLabel}
          onAdd={(id) => {
            onChange([...value, id]);
          }}
          options={available}
        />
      </div>
    </div>
  );
}

export function ToolPicker({
  tools,
  value,
  onChange,
}: {
  readonly tools: readonly ToolRecord[];
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const { t, format } = useGlossary();
  const byId = new Map(tools.map((tool) => [tool.id, tool]));

  return (
    <IdPicker
      addLabel={format("Adicionar {tool}", { tool: t("entity.tool") })}
      attribute="tools"
      detail={(id) => {
        const tool = byId.get(id);
        return tool === undefined ? null : (
          <span className="text-muted-foreground text-[10px]">{t(TOOL_KIND[tool.kind])}</span>
        );
      }}
      icon={Wrench}
      items={tools}
      label={t("entity.tool.plural")}
      onChange={onChange}
      value={value}
    />
  );
}

export function McpServerPicker({
  servers,
  value,
  onChange,
}: {
  readonly servers: readonly McpServerRegistryRecord[];
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}) {
  const { t, format } = useGlossary();
  const byId = new Map(servers.map((server) => [server.id, server]));

  return (
    <IdPicker
      addLabel={format("Adicionar {server}", { server: t("entity.mcpServer") })}
      attribute="mcpServers"
      detail={(id) => {
        const server = byId.get(id);
        return server === undefined ? null : (
          <span className="text-muted-foreground flex items-center gap-1 text-[10px]">
            <span>{server.transport}</span>
            {server.readOnly && <Lock aria-hidden className="size-2.5" />}
            {server.builtIn && <span>· {t("mcpServer.builtIn").toLowerCase()}</span>}
          </span>
        );
      }}
      icon={Gem}
      items={servers}
      label={t("entity.mcpServer.plural")}
      onChange={onChange}
      value={value}
    />
  );
}
