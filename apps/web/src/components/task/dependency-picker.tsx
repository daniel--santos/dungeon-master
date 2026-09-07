import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { KindChip } from "@/components/task/chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useGlossary } from "@/lib/glossary";
import { useAddDependency, useTasks } from "@/lib/tasks";

export interface DependencyPickerProps {
  readonly taskId: string;
  /** Ids que já não podem entrar: a própria Task e as ligações existentes. */
  readonly excluded: ReadonlySet<string>;
}

/**
 * Adiciona uma dependência buscando pelo título.
 *
 * O ciclo não é checado aqui: quem sabe se a aresta fecha um caminho é o
 * servidor, e ele responde `409` com o caminho do impasse em `detail`. A tela
 * mostra esse texto em vez de tentar adivinhar a regra.
 */
export function DependencyPicker({ taskId, excluded }: DependencyPickerProps) {
  const { t, format } = useGlossary();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const add = useAddDependency();

  const results = useTasks({ q: q.trim() === "" ? undefined : q.trim(), pageSize: 8 });
  const options = (results.data?.items ?? []).filter((task) => !excluded.has(task.id));

  function choose(dependsOnId: string) {
    add.mutate(
      { id: taskId, dependsOnId },
      {
        onSuccess: () => {
          setOpen(false);
          setQ("");
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="outline">
          <Plus aria-hidden />
          <span>Adicionar</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <Input
          autoFocus
          className="mb-2"
          onChange={(event) => {
            setQ(event.target.value);
          }}
          placeholder="Buscar por título"
          value={q}
        />

        {results.isPending && <p className="text-muted-foreground px-2 py-3 text-xs">Lendo…</p>}

        {!results.isPending && options.length === 0 && (
          <p className="text-muted-foreground px-2 py-3 text-xs">
            {format("Nenhuma outra {task} casa com essa busca.", { task: t("entity.task") })}
          </p>
        )}

        <div className="flex max-h-64 flex-col overflow-y-auto">
          {options.map((task) => (
            <button
              key={task.id}
              className="hover:bg-accent flex flex-col items-start gap-1 rounded-sm px-2 py-2 text-left"
              disabled={add.isPending}
              onClick={() => {
                choose(task.id);
              }}
              type="button"
            >
              <span className="line-clamp-2 text-[13px] leading-4">{task.title}</span>
              <KindChip kind={task.kind} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
