import type { AutonomyLevel } from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Landmark, ScrollText, ShieldHalf, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { AUTONOMY_COLOR, AUTONOMY_LEVEL } from "@/lib/autonomy-domain";
import { useEventsStore } from "@/lib/events";
import { useGlossary } from "@/lib/glossary";

/**
 * Os toasts da autonomia controlada, em qualquer tela (Fase 9C).
 *
 * Cada evento sai na transação da decisão, então o toast nunca anuncia o que
 * o banco não tem: um orçamento que barrou uma partida, um disjuntor que
 * mudou de estado, uma Task que uma política criou sem passar pela proposta,
 * o nível de um Project que mudou. O texto diz quem decidiu — o nome do
 * orçamento, do disjuntor, da Task — e leva à tela de autonomia da Campanha
 * (ou à Task, quando é ela a novidade). A releitura das queries mora em
 * `useLiveQueries`.
 *
 * `budget.warned` e `policy.decided` não viram toast: o aviso de orçamento e
 * a decisão de partida chegam a quem partiu, na resposta do `POST /runs`, e
 * ficam no diário do Run; repeti-los aqui seria o mesmo fato duas vezes.
 */

const BudgetExceededPayloadSchema = z.object({
  budgetId: z.string(),
  name: z.string(),
  projectId: z.string().nullable().optional(),
  reason: z.string(),
});

const BreakerPayloadSchema = z.object({
  breakerId: z.string(),
  name: z.string(),
  to: z.string(),
  reason: z.string().optional(),
});

const TaskAutoCreatedPayloadSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  projectId: z.string(),
  reason: z.string().optional(),
});

const AutonomyChangedPayloadSchema = z.object({
  projectId: z.string(),
  from: z.number(),
  to: z.number(),
});

export const BUDGET_EXCEEDED = "budget.exceeded";
export const BREAKER_OPENED = "breaker.opened";
export const BREAKER_HALF_OPEN = "breaker.half_open";
export const BREAKER_CLOSED = "breaker.closed";
export const TASK_AUTO_CREATED = "task.auto_created";
export const AUTONOMY_CHANGED = "autonomy.changed";

const tint = (percent: number) =>
  `color-mix(in oklab, ${AUTONOMY_COLOR} ${String(percent)}%, transparent)`;

interface AutonomyToastProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string | null;
  /** O destino do atalho; `null` fecha sem link. */
  readonly link:
    | { readonly kind: "autonomy"; readonly projectId: string }
    | { readonly kind: "task"; readonly taskId: string }
    | null;
  readonly onOpen: () => void;
  readonly testId: string;
}

function AutonomyToast({ icon: Icon, title, body, link, onOpen, testId }: AutonomyToastProps) {
  const { t, theme } = useGlossary();

  return (
    <div
      className="bg-card flex w-full items-start gap-3 rounded-[12px] p-3.5"
      data-autonomy-toast={testId}
      style={{
        border: `1px solid ${tint(55)}`,
        boxShadow: `0 0 0 1px ${tint(18)}, 0 10px 30px -12px ${tint(40)}`,
      }}
    >
      <span
        className="flex size-9 flex-none items-center justify-center rounded-full"
        style={{ border: `1px solid ${tint(40)}`, background: tint(12), color: AUTONOMY_COLOR }}
      >
        <Icon aria-hidden className="size-4.5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={
            theme === "dnd"
              ? "font-display text-[14.5px] leading-5 font-semibold tracking-[0.03em]"
              : "text-[14.5px] leading-5 font-semibold"
          }
        >
          {title}
        </span>
        {body !== null && (
          <span className="text-muted-foreground text-[12.5px] leading-4.5">{body}</span>
        )}
        {link !== null && link.kind === "autonomy" && (
          <Link
            className="text-muted-foreground hover:text-foreground mt-0.5 flex w-fit items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
            onClick={onOpen}
            params={{ id: link.projectId }}
            search={{ tab: "level", scope: "project" }}
            to="/projects/$id/autonomy"
          >
            <span>{t("autonomy.toast.open")}</span>
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        )}
        {link !== null && link.kind === "task" && (
          <Link
            className="text-muted-foreground hover:text-foreground mt-0.5 flex w-fit items-center gap-1 text-[11.5px] underline-offset-2 hover:underline"
            onClick={onOpen}
            params={{ id: link.taskId }}
            to="/tasks/$id"
          >
            <span>{t("entity.task")}</span>
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

function show(id: string, props: Omit<AutonomyToastProps, "onOpen">): void {
  toast.custom(
    (toastId) => (
      <AutonomyToast
        {...props}
        onOpen={() => {
          toast.dismiss(toastId);
        }}
      />
    ),
    { id, duration: 12_000 },
  );
}

const BREAKER_TITLE: Record<string, GlossaryKey> = {
  [BREAKER_OPENED]: "autonomy.toast.breakerOpened",
  [BREAKER_HALF_OPEN]: "autonomy.toast.breakerHalfOpen",
  [BREAKER_CLOSED]: "autonomy.toast.breakerClosed",
};

/** Escuta o canal de dashboard e anuncia cada decisão da autonomia. */
export function useAutonomyToasts(): void {
  const addListener = useEventsStore((state) => state.addListener);
  const { t, format } = useGlossary();

  useEffect(() => {
    return addListener((event) => {
      if (event.type === BUDGET_EXCEEDED) {
        const parsed = BudgetExceededPayloadSchema.safeParse(event.payload);
        if (!parsed.success) {
          console.error("[autonomy] payload de orçamento ilegível", event.payload);
          return;
        }
        const payload = parsed.data;
        show(`budget-exceeded:${String(event.sequence)}`, {
          icon: Landmark,
          title: format(t("autonomy.toast.budgetExceeded"), { name: payload.name }),
          body: payload.reason,
          link:
            payload.projectId === null || payload.projectId === undefined
              ? null
              : { kind: "autonomy", projectId: payload.projectId },
          testId: `budget:${payload.budgetId}`,
        });
        return;
      }

      const breakerTitle = BREAKER_TITLE[event.type];
      if (breakerTitle !== undefined) {
        const parsed = BreakerPayloadSchema.safeParse(event.payload);
        if (!parsed.success) {
          console.error("[autonomy] payload de disjuntor ilegível", event.payload);
          return;
        }
        const payload = parsed.data;
        show(`breaker:${payload.breakerId}:${payload.to}:${String(event.sequence)}`, {
          icon: ShieldHalf,
          title: format(t(breakerTitle), { name: payload.name }),
          body: payload.reason ?? null,
          link: null,
          testId: `breaker:${payload.breakerId}:${payload.to}`,
        });
        return;
      }

      if (event.type === TASK_AUTO_CREATED) {
        const parsed = TaskAutoCreatedPayloadSchema.safeParse(event.payload);
        if (!parsed.success) {
          console.error("[autonomy] payload de Task auto-criada ilegível", event.payload);
          return;
        }
        const payload = parsed.data;
        show(`task-auto-created:${payload.taskId}`, {
          icon: ScrollText,
          title: format(t("autonomy.toast.taskAutoCreated"), { title: payload.title }),
          body: payload.reason ?? null,
          link: { kind: "task", taskId: payload.taskId },
          testId: `task:${payload.taskId}`,
        });
        return;
      }

      if (event.type === AUTONOMY_CHANGED) {
        const parsed = AutonomyChangedPayloadSchema.safeParse(event.payload);
        if (!parsed.success) {
          console.error("[autonomy] payload de nível ilegível", event.payload);
          return;
        }
        const payload = parsed.data;
        const level = AUTONOMY_LEVEL[payload.to as AutonomyLevel] as
          (typeof AUTONOMY_LEVEL)[AutonomyLevel] | undefined;
        show(`autonomy-changed:${payload.projectId}:${String(payload.to)}`, {
          icon: ScrollText,
          title: format(t("autonomy.toast.levelChanged"), {
            level: level === undefined ? String(payload.to) : t(level.label),
          }),
          body: null,
          link: { kind: "autonomy", projectId: payload.projectId },
          testId: `level:${payload.projectId}:${String(payload.to)}`,
        });
      }
    });
  }, [addListener, format, t]);
}
