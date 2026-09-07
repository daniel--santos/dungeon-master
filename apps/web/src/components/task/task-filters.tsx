import type { components } from "@dungeon-master/api-client";
import type { TaskKind, TaskPriority, TaskStatus } from "@dungeon-master/contracts";
import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TASK_KIND,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_PRIORITY,
  TASK_STATUS,
  TASK_STATUSES,
} from "@/lib/domain";
import { useGlossary } from "@/lib/glossary";

type Project = components["schemas"]["Project"];

/** O Radix recusa `value=""`, então "sem filtro" precisa de um valor próprio. */
const ANY = "__any__";

export interface TaskFilterValue {
  readonly projectId?: string;
  readonly kind?: TaskKind;
  readonly priority?: TaskPriority;
  readonly status?: readonly TaskStatus[];
  readonly q?: string;
}

export interface TaskFiltersProps {
  readonly value: TaskFilterValue;
  readonly onChange: (next: TaskFilterValue) => void;
  readonly projects: readonly Project[];
  /** Fora quando a lista já está dentro de um Project. */
  readonly showProject?: boolean;
  readonly total: number;
}

/**
 * A barra de filtros da lista.
 *
 * O estado real mora na URL — quem chama grava nos parâmetros de busca tipados
 * da rota. Só a busca por título tem estado local, para não empurrar uma
 * navegação a cada tecla; o resto muda de uma vez e vai direto.
 */
export function TaskFilters({
  value,
  onChange,
  projects,
  showProject = true,
  total,
}: TaskFiltersProps) {
  const { t, format } = useGlossary();
  const [q, setQ] = useState(value.q ?? "");

  // A URL também muda por fora — voltar no histórico, ou o botão de limpar.
  useEffect(() => {
    setQ(value.q ?? "");
  }, [value.q]);

  useEffect(() => {
    const current = value.q ?? "";
    if (q === current) return;

    const timer = setTimeout(() => {
      onChange({ ...value, q: q === "" ? undefined : q });
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [onChange, q, value]);

  const status = value.status ?? [];
  const dirty =
    value.projectId !== undefined ||
    value.kind !== undefined ||
    value.priority !== undefined ||
    status.length > 0 ||
    (value.q ?? "") !== "";

  function toggleStatus(candidate: TaskStatus, checked: boolean) {
    const next = checked ? [...status, candidate] : status.filter((item) => item !== candidate);
    onChange({ ...value, status: next.length === 0 ? undefined : next });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-65">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          aria-label="Buscar por título"
          className="pl-9"
          onChange={(event) => {
            setQ(event.target.value);
          }}
          placeholder="Buscar por título"
          value={q}
        />
      </div>

      {showProject && (
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
      )}

      <Select
        value={value.kind ?? ANY}
        onValueChange={(next) => {
          onChange({ ...value, kind: next === ANY ? undefined : (next as TaskKind) });
        }}
      >
        <SelectTrigger aria-label="Tipo" className="w-35">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Tipo</SelectItem>
          <SelectSeparator />
          {TASK_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {t(TASK_KIND[kind].label)}
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
            {TASK_STATUSES.map((candidate) => (
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
                <span>{t(TASK_STATUS[candidate].label)}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Select
        value={value.priority ?? ANY}
        onValueChange={(next) => {
          onChange({ ...value, priority: next === ANY ? undefined : (next as TaskPriority) });
        }}
      >
        <SelectTrigger aria-label="Prioridade" className="w-37.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Prioridade</SelectItem>
          <SelectSeparator />
          {TASK_PRIORITIES.map((priority) => (
            <SelectItem key={priority} value={priority}>
              {t(TASK_PRIORITY[priority].label)}
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

      <span className="text-muted-foreground self-center text-xs">
        {format(total === 1 ? "{n} {one}" : "{n} {many}", {
          n: total,
          one: t("entity.task"),
          many: t("entity.task.plural"),
        })}
      </span>
    </div>
  );
}
