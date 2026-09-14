import type { HarnessKey, RunStatus } from "@dungeon-master/contracts";
import { ChevronDown, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { HarnessRecord, ProjectRecord } from "@/lib/api-types";
import { RUN_STATUS, RUN_STATUSES } from "@/lib/execution-domain";
import { useGlossary } from "@/lib/glossary";

/** O Radix recusa `value=""`, então "sem filtro" precisa de um valor próprio. */
const ANY = "__any__";

export interface RunFilterValue {
  readonly projectId?: string;
  readonly harnessKey?: HarnessKey;
  readonly status?: readonly RunStatus[];
}

export interface RunFiltersProps {
  readonly value: RunFilterValue;
  readonly onChange: (next: RunFilterValue) => void;
  readonly projects: readonly ProjectRecord[];
  readonly harnesses: readonly HarnessRecord[];
  /** Quantas Expedições o servidor conta com este filtro. */
  readonly total: number;
  /** Quantas estão em andamento agora, para o pulso do canto direito. */
  readonly running: number;
}

/**
 * A barra de filtros da lista de Expedições.
 *
 * O estado mora na URL, como na lista de Tasks, e os três filtros vão para a
 * API: `projectId`, `status` e `harnessKey`. Por isso o contador da direita pode
 * falar em `total` sem ressalva — ele conta o que o filtro deixa passar no
 * banco, e não o que sobrou da página recebida.
 */
export function RunFilters({
  value,
  onChange,
  projects,
  harnesses,
  total,
  running,
}: RunFiltersProps) {
  const { t, format } = useGlossary();

  const status = value.status ?? [];
  const dirty =
    value.projectId !== undefined || value.harnessKey !== undefined || status.length > 0;

  function toggleStatus(candidate: RunStatus, checked: boolean) {
    const next = checked ? [...status, candidate] : status.filter((item) => item !== candidate);
    onChange({ ...value, status: next.length === 0 ? undefined : next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.projectId ?? ANY}
        onValueChange={(next) => {
          onChange({ ...value, projectId: next === ANY ? undefined : next });
        }}
      >
        <SelectTrigger aria-label={t("entity.project")} className="w-47.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t("entity.project.plural")}</SelectItem>
          <SelectSeparator />
          {projects.map((project) => (
            <SelectItem key={project.id} value={project.id}>
              {project.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            className="dark:bg-input/30 dark:hover:bg-input/50 w-35 justify-between border bg-transparent font-normal shadow-xs"
            variant="ghost"
          >
            <span className={status.length === 0 ? "text-muted-foreground" : undefined}>
              {status.length === 0 ? "Status" : format("Status · {n}", { n: status.length })}
            </span>
            <ChevronDown aria-hidden className="text-muted-foreground size-4 opacity-70" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2">
          <div className="flex flex-col">
            {RUN_STATUSES.map((candidate) => (
              <label
                key={candidate}
                className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
              >
                <Checkbox
                  checked={status.includes(candidate)}
                  onCheckedChange={(checked) => {
                    toggleStatus(candidate, checked === true);
                  }}
                />
                <span>{t(RUN_STATUS[candidate].label)}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Select
        value={value.harnessKey ?? ANY}
        onValueChange={(next) => {
          onChange({ ...value, harnessKey: next === ANY ? undefined : (next as HarnessKey) });
        }}
      >
        <SelectTrigger aria-label={t("entity.harness")} className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{t("entity.harness.plural")}</SelectItem>
          <SelectSeparator />
          {harnesses.map((harness) => (
            <SelectItem key={harness.id} value={harness.key}>
              {harness.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {dirty && (
        <Button
          onClick={() => {
            onChange({});
          }}
          size="sm"
          variant="ghost"
        >
          <X aria-hidden />
          <span>Limpar</span>
        </Button>
      )}

      <div className="flex-1" />

      <span className="text-muted-foreground flex items-center gap-1.75 self-center text-xs">
        {running > 0 && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full"
            style={{ backgroundColor: "var(--accent-blue)" }}
          />
        )}
        <span>
          {running > 0
            ? format("{running} {status} · {total} {runs}", {
                running,
                status: t("run.status.running").toLowerCase(),
                total,
                runs: total === 1 ? t("entity.run") : t("entity.run.plural"),
              })
            : format("{total} {runs}", {
                total,
                runs: total === 1 ? t("entity.run") : t("entity.run.plural"),
              })}
        </span>
      </span>
    </div>
  );
}
