import type {
  KnowledgeItemStatus,
  KnowledgeItemType,
  KnowledgeReviewFilter,
} from "@dungeon-master/contracts";
import { Link } from "@tanstack/react-router";
import { BookOpen, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { KnowledgeStatusChip, KnowledgeTypeChip } from "@/components/knowledge/knowledge-chips";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { KnowledgeItemRecord } from "@/lib/api-types";
import { relativeTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { KNOWLEDGE_PAGE_SIZE, useProjectKnowledge } from "@/lib/knowledge";
import {
  KNOWLEDGE_REVIEW_FILTER,
  KNOWLEDGE_REVIEW_FILTERS,
  KNOWLEDGE_STATUS,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPE,
  KNOWLEDGE_TYPES,
} from "@/lib/knowledge-domain";

/** O Radix recusa `value=""`, então "sem filtro" precisa de um valor próprio. */
const ANY = "__any__";

/** Quanto a busca espera depois da última tecla antes de ir à URL e à API. */
const SEARCH_DEBOUNCE_MS = 300;

export interface KnowledgeFilterValue {
  readonly type?: KnowledgeItemType;
  readonly status?: KnowledgeItemStatus;
  readonly review?: KnowledgeReviewFilter;
  readonly q?: string;
  readonly page: number;
}

export interface KnowledgeListProps {
  readonly projectId: string;
  readonly value: KnowledgeFilterValue;
  readonly onChange: (next: KnowledgeFilterValue) => void;
}

/**
 * A lista do Grimório com os filtros na URL (Fase 6B).
 *
 * Tipo, estado e revisão mudam de uma vez e vão direto para a rota; a busca
 * tem estado local com um atraso curto, para não empurrar uma navegação (e
 * uma consulta FTS) a cada tecla. Com `q`, a API ordena por relevância; sem
 * ele, do mais recente para o mais antigo.
 *
 * Cada linha abre a gaveta do item pela URL (`item=`), então um link para uma
 * Página específica é só a mesma rota com o parâmetro.
 */
export function KnowledgeList({ projectId, value, onChange }: KnowledgeListProps) {
  const { t, format } = useGlossary();
  const page = useProjectKnowledge(projectId, value);

  const [query, setQuery] = useState(value.q ?? "");

  // A URL manda: um link colado com `q` preenche a caixa, e limpar o filtro
  // por fora limpa a caixa.
  useEffect(() => {
    setQuery(value.q ?? "");
  }, [value.q]);

  // O filtro e o `onChange` entram por ref, e não pelas dependências: a rota
  // monta `value` a cada render, e enquanto o Distiller trabalha cada evento
  // `knowledge.*` a re-renderiza. Com o objeto nas dependências, o efeito
  // reiniciava o timer a cada evento e a busca só saía quando o fluxo parasse.
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === (value.q ?? "")) return;
    const timer = setTimeout(() => {
      const { value: current, onChange: notify } = latest.current;
      notify({ ...current, q: trimmed === "" ? undefined : trimmed, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, value.q]);

  const items = page.data?.items ?? [];
  const total = page.data?.total ?? 0;
  const pageSize = page.data?.pageSize ?? KNOWLEDGE_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered =
    value.type !== undefined ||
    value.status !== undefined ||
    value.review !== undefined ||
    (value.q !== undefined && value.q !== "");

  return (
    <div className="flex flex-col gap-3" data-knowledge-list={items.length}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            aria-label={t("knowledge.search.placeholder")}
            className="h-9 pl-8 text-[13px]"
            data-knowledge-search
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder={t("knowledge.search.placeholder")}
            value={query}
          />
          {query !== "" && (
            <button
              aria-label="Limpar busca"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              onClick={() => {
                setQuery("");
              }}
              type="button"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </div>

        <Filter
          label={t("knowledge.filter.type")}
          onChange={(next) => {
            onChange({ ...value, type: next as KnowledgeItemType | undefined, page: 1 });
          }}
          options={KNOWLEDGE_TYPES.map((type) => ({
            value: type,
            label: t(KNOWLEDGE_TYPE[type].label),
          }))}
          testId="type"
          value={value.type}
        />
        <Filter
          label={t("knowledge.filter.status")}
          onChange={(next) => {
            onChange({ ...value, status: next as KnowledgeItemStatus | undefined, page: 1 });
          }}
          options={KNOWLEDGE_STATUSES.map((status) => ({
            value: status,
            label: t(KNOWLEDGE_STATUS[status].label),
          }))}
          testId="status"
          value={value.status}
        />
        <Filter
          label={t("knowledge.filter.review")}
          onChange={(next) => {
            onChange({ ...value, review: next as KnowledgeReviewFilter | undefined, page: 1 });
          }}
          options={KNOWLEDGE_REVIEW_FILTERS.map((review) => ({
            value: review,
            label: t(KNOWLEDGE_REVIEW_FILTER[review]),
          }))}
          testId="review"
          value={value.review}
        />

        {filtered && (
          <Button
            onClick={() => {
              setQuery("");
              onChange({ page: 1 });
            }}
            size="xs"
            variant="ghost"
          >
            Limpar
          </Button>
        )}

        <span className="flex-1" />

        <span className="text-muted-foreground text-xs" data-knowledge-total={total}>
          {format(total === 1 ? "{n} {one}" : "{n} {many}", {
            n: total,
            one: t("entity.knowledgeItem"),
            many: t("entity.knowledgeItem.plural"),
          })}
        </span>
      </div>

      <Panel className="overflow-hidden">
        {page.isError && <p className="text-destructive px-5 py-4 text-sm">{page.error.message}</p>}

        {page.isPending && <p className="text-muted-foreground px-5 py-4 text-sm">Lendo…</p>}

        {!page.isPending && !page.isError && items.length === 0 && (
          <EmptyState
            icon={BookOpen}
            title={filtered ? t("knowledge.list.noMatch") : t("entity.knowledge")}
          >
            {filtered ? t("knowledge.list.noMatch") : t("knowledge.list.empty")}
          </EmptyState>
        )}

        {items.length > 0 && (
          <ul className="m-0 flex list-none flex-col p-0">
            {items.map((item) => (
              <KnowledgeRow key={item.id} item={item} projectId={projectId} />
            ))}
          </ul>
        )}

        {pages > 1 && (
          <div className="border-border text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
            <span>{format("Página {page} de {pages}", { page: value.page, pages })}</span>
            <span className="flex items-center gap-1">
              <Button
                disabled={value.page <= 1}
                onClick={() => {
                  onChange({ ...value, page: value.page - 1 });
                }}
                size="icon-xs"
                variant="ghost"
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                disabled={value.page >= pages}
                onClick={() => {
                  onChange({ ...value, page: value.page + 1 });
                }}
                size="icon-xs"
                variant="ghost"
              >
                <ChevronRight aria-hidden />
              </Button>
            </span>
          </div>
        )}
      </Panel>
    </div>
  );
}

function KnowledgeRow({ item, projectId }: { item: KnowledgeItemRecord; projectId: string }) {
  const { format } = useGlossary();
  const { icon: Icon } = KNOWLEDGE_TYPE[item.type];

  return (
    <li
      className="border-border flex items-start gap-3.5 border-b px-5 py-3 last:border-b-0"
      data-knowledge-item={item.id}
    >
      <span className="text-muted-foreground mt-0.5 flex size-7 flex-none items-center justify-center rounded-full border border-dashed">
        <Icon aria-hidden className="size-3.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="min-w-0 truncate text-[13.5px] leading-4.5 font-medium underline-offset-2 hover:underline"
            data-knowledge-item-open
            params={{ id: projectId }}
            from="/projects/$id/knowledge"
            search={(previous) => ({ ...previous, item: item.id })}
            to="/projects/$id/knowledge"
          >
            {item.title}
          </Link>
          <KnowledgeTypeChip type={item.type} />
          <KnowledgeStatusChip status={item.status} />
        </div>
        {/* Texto escrito por um modelo: renderizado como texto, nunca como HTML. */}
        <p className="text-muted-foreground m-0 line-clamp-2 text-[12.5px] leading-4.5 whitespace-pre-wrap">
          {item.content}
        </p>
        <span className="text-muted-foreground text-[11px]">
          {format("versão {n} · {when}", { n: item.version, when: relativeTime(item.updatedAt) })}
        </span>
      </div>
    </li>
  );
}

interface FilterProps {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string | undefined) => void;
  readonly testId: string;
}

function Filter({ label, value, options, onChange, testId }: FilterProps) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => {
        onChange(next === ANY ? undefined : next);
      }}
    >
      <SelectTrigger aria-label={label} className="w-44" data-knowledge-filter={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{label}</SelectItem>
        <SelectSeparator />
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
