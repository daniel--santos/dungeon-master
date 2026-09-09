import type { ProviderAuthStatus } from "@dungeon-master/contracts";
import { KeyRound } from "lucide-react";

import { useGlossary } from "@/lib/glossary";
import { ACCENT_AMBER, ACCENT_GREEN, PROVIDER_AUTH_STATUS } from "@/lib/registry-domain";
import { cn } from "@/lib/utils";

const TONE_COLOR = {
  ok: ACCENT_GREEN,
  bad: ACCENT_AMBER,
  neutral: "var(--muted-foreground)",
} as const;

/**
 * O estado da credencial de um Patronato, num chip.
 *
 * Só o estado e o nome das variáveis presentes: o valor nunca chega aqui,
 * nem à API. O mesmo chip na tela de Patronatos e no painel de
 * compatibilidade.
 */
export function ProviderAuthBadge({
  status,
  className,
}: {
  readonly status: ProviderAuthStatus;
  readonly className?: string;
}) {
  const { t } = useGlossary();
  const { label, tone } = PROVIDER_AUTH_STATUS[status];
  const color = TONE_COLOR[tone];

  return (
    <span
      className={cn(
        "inline-flex h-[22px] w-fit items-center gap-1.5 rounded-lg border px-2 text-xs whitespace-nowrap",
        tone === "neutral" && "text-muted-foreground",
        className,
      )}
      data-provider-auth={status}
      style={{
        borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
      }}
    >
      <KeyRound aria-hidden className="size-3" style={{ color }} />
      <span>{t(label)}</span>
    </span>
  );
}
