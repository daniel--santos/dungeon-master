import type { ApprovalDecision } from "@dungeon-master/contracts";
import { Clock, ShieldHalf } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalGateRecord } from "@/lib/api-types";
import { GateConflictError, useResolveGate } from "@/lib/approvals";
import { formatDateTime } from "@/lib/datetime";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { APPROVAL_DECISION, APPROVAL_GATE_STATUS } from "@/lib/workflow-domain";

const AMBER = "oklch(0.72 0.13 75)";

const NOTE_MAX_LENGTH = 5_000;

function tint(color: string, percent: number): string {
  return `color-mix(in oklch, ${color} ${String(percent)}%, transparent)`;
}

/** O chip de estado do gate. */
export function GateStatusChip({ gate }: { gate: ApprovalGateRecord }) {
  const { t } = useGlossary();
  const { label, dot, pulse } = APPROVAL_GATE_STATUS[gate.status];

  return (
    <span
      className="border-border inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border bg-white/[0.04] px-2 text-xs whitespace-nowrap"
      data-gate-status={gate.status}
    >
      <span
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", pulse && "animate-pulse")}
        style={{ backgroundColor: dot }}
      />
      <span>{t(label)}</span>
    </span>
  );
}

export interface ApprovalGateCardProps {
  /** Os gates do Run, do mais antigo ao mais novo. */
  readonly gates: readonly ApprovalGateRecord[];
  /**
   * Avisa o cockpit que a carta precisa continuar de pé: um diálogo aberto,
   * um pedido em voo, ou um `409` ainda não lido. Sem isso o Run voltar a
   * `QUEUED` por baixo desmontaria a carta no meio da decisão.
   */
  readonly onHoldingChange: (holding: boolean) => void;
}

/**
 * A Carta do Selo (Fase 4C): o pedido de aprovação em que a Expedição parou.
 *
 * Duas decisões, cada uma atrás de um `AlertDialog`, como manda a decisão de
 * UX da Fase 2 para ação irreversível — e esta é irreversível por contrato: o
 * gate é um CAS no servidor, e uma decisão gravada nunca é sobrescrita. Se a
 * sua perdeu a corrida, o `409` traz o gate como ele ficou, e a carta mostra
 * esse estado com o aviso de que outra decisão chegou antes, em vez de tentar
 * de novo ou fingir que a sua valeu.
 */
export function ApprovalGateCard({ gates, onHoldingChange }: ApprovalGateCardProps) {
  const { t, format } = useGlossary();
  const resolve = useResolveGate();

  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState<ApprovalDecision | null>(null);
  const [conflict, setConflict] = useState<ApprovalGateRecord | null>(null);

  const pending = gates.find((gate) => gate.status === "PENDING") ?? null;
  // Depois do `409` a lista já mostra o gate decidido; a carta segura o que o
  // problem details trouxe, que é a verdade do instante da recusa.
  const shown = conflict ?? pending ?? gates.at(-1) ?? null;

  const holding = confirming !== null || resolve.isPending || conflict !== null;
  useEffect(() => {
    onHoldingChange(holding);
  }, [holding, onHoldingChange]);

  if (shown === null) {
    return (
      <Panel>
        <p className="text-muted-foreground m-0 text-[12.5px]">Lendo…</p>
      </Panel>
    );
  }

  function decide(decision: ApprovalDecision) {
    if (shown === null) return;
    resolve.mutate(
      { gateId: shown.id, decision, note: note.trim() },
      {
        onSuccess: (gate) => {
          setConfirming(null);
          toast.success(
            format("{status}: {title}", {
              status: t(APPROVAL_GATE_STATUS[gate.status].label),
              title: gate.title,
            }),
          );
        },
        onError: (error: Error) => {
          setConfirming(null);
          if (error instanceof GateConflictError) {
            setConflict(error.gate);
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  const decided = shown.status !== "PENDING";
  const confirmingDecision = confirming === null ? null : APPROVAL_DECISION[confirming];

  return (
    <>
      <Panel>
        <div className="flex items-start gap-3.5">
          <span
            className="mt-0.5 flex size-9 flex-none items-center justify-center rounded-full border"
            style={{ borderColor: tint(AMBER, 40), backgroundColor: tint(AMBER, 12), color: AMBER }}
          >
            <ShieldHalf aria-hidden className="size-4.5" />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-[11px] tracking-[0.1em] uppercase">
                {t("approval.card.title")}
              </span>
              <span className="text-muted-foreground font-mono text-[10.5px]">{shown.gateKey}</span>
              <span className="flex-1" />
              <GateStatusChip gate={shown} />
            </div>

            <h2 className="m-0 text-[19px] leading-6 font-semibold">{shown.title}</h2>

            {shown.description !== null && shown.description !== "" && (
              <p className="text-muted-foreground m-0 text-[13px] leading-5 whitespace-pre-wrap">
                {shown.description}
              </p>
            )}

            <span className="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
              <Clock aria-hidden className="size-3.25" />
              <span>{format("Pedido em {when}", { when: formatDateTime(shown.requestedAt) })}</span>
            </span>

            {conflict !== null ? (
              <div
                className="border-destructive/40 bg-destructive/8 flex flex-col gap-2 rounded-[10px] border px-3 py-2.5"
                data-approval-conflict={conflict.status}
              >
                <span className="text-[12.5px] leading-4.5 font-medium">
                  {format(t("approval.conflict"), {
                    status: t(APPROVAL_GATE_STATUS[conflict.status].label).toLowerCase(),
                  })}
                </span>
                {conflict.note !== null && conflict.note !== "" && (
                  <span className="text-muted-foreground text-[12px] leading-4.5">
                    {conflict.note}
                  </span>
                )}
                <span className="text-muted-foreground text-[11px]">
                  {conflict.resolvedAt === null
                    ? "—"
                    : format("Decidido em {when}", { when: formatDateTime(conflict.resolvedAt) })}
                </span>
                <Button
                  className="w-fit"
                  onClick={() => {
                    setConflict(null);
                  }}
                  size="xs"
                  variant="outline"
                >
                  Entendi
                </Button>
              </div>
            ) : decided ? (
              <p className="text-muted-foreground m-0 text-[12.5px]">
                {shown.note === null || shown.note === ""
                  ? t(APPROVAL_GATE_STATUS[shown.status].label)
                  : `${t(APPROVAL_GATE_STATUS[shown.status].label)} · ${shown.note}`}
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[12px]" htmlFor="approval-note">
                    Nota (opcional)
                  </Label>
                  <Textarea
                    className="min-h-16 text-[13px]"
                    id="approval-note"
                    maxLength={NOTE_MAX_LENGTH}
                    onChange={(event) => {
                      setNote(event.target.value);
                    }}
                    placeholder="Justificativa. Fica registrada junto da decisão."
                    rows={2}
                    value={note}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <DecisionButton
                    decision="approve"
                    disabled={resolve.isPending}
                    onClick={() => {
                      setConfirming("approve");
                    }}
                  />
                  <DecisionButton
                    decision="reject"
                    disabled={resolve.isPending}
                    onClick={() => {
                      setConfirming("reject");
                    }}
                  />
                  <span className="text-muted-foreground text-[11px]">
                    Pede confirmação. A decisão fica registrada e não pode ser desfeita.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </Panel>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        open={confirming !== null}
      >
        {confirmingDecision !== null && confirming !== null && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(confirmingDecision.confirmTitle)}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-2">
                  <p className="text-foreground font-medium">{shown.title}</p>
                  <p>{t(confirmingDecision.confirmBody)}</p>
                  {note.trim() !== "" && (
                    <p className="border-border rounded-md border bg-white/[0.04] px-2.5 py-2 text-[12.5px] whitespace-pre-wrap">
                      {note.trim()}
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>Voltar</AlertDialogCancel>
              <AlertDialogAction
                className={cn(
                  "text-white",
                  confirming === "approve"
                    ? "bg-[oklch(0.55_0.13_150)] hover:bg-[oklch(0.5_0.13_150)]"
                    : "bg-destructive/60 hover:bg-destructive/70",
                )}
                data-approval-confirm={confirming}
                disabled={resolve.isPending}
                onClick={(event) => {
                  // O AlertDialog fecha sozinho no clique da ação; segurar o
                  // fechamento deixa o botão desabilitado enquanto o pedido voa.
                  event.preventDefault();
                  decide(confirming);
                }}
              >
                <confirmingDecision.icon aria-hidden />
                <span>{t(confirmingDecision.label)}</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}

function DecisionButton({
  decision,
  disabled,
  onClick,
}: {
  decision: ApprovalDecision;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useGlossary();
  const { icon: Icon, label, color } = APPROVAL_DECISION[decision];

  return (
    <Button
      className="border"
      data-approval-decision={decision}
      disabled={disabled}
      onClick={onClick}
      size="sm"
      style={{ borderColor: tint(color, 45), backgroundColor: tint(color, 14), color }}
      variant="ghost"
    >
      <Icon aria-hidden />
      <span>{t(label)}</span>
    </Button>
  );
}

/** A moldura âmbar da carta, a mesma cor do estado "aguardando" em todo o cockpit. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-[14px] border px-4.5 py-4"
      data-approval-card
      style={{ borderColor: tint(AMBER, 38), backgroundColor: tint(AMBER, 8) }}
    >
      {children}
    </section>
  );
}
