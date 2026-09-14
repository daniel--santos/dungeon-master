import { getGlossary } from "@dungeon-master/glossary";
import { Search } from "lucide-react";

import { PALETTE_SHORTCUT } from "@/components/app-shell/command-palette";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useGlossary, useThemeSetting } from "@/lib/glossary";

const SWITCH_ID = "ui-theme";

/** O mesmo termo nos dois glossários, para o usuário ver a troca antes de fazê-la. */
const PREVIEW = {
  dnd: getGlossary("dnd")["entity.task"],
  plain: getGlossary("plain")["entity.task"],
} as const;

/**
 * A seção "Aparência" de Settings: o interruptor "Tema Dungeon Master".
 *
 * A troca é otimista e não recarrega nada. O `PUT /settings/ui.theme` persiste
 * a preferência, e o evento `settings.changed` leva a mudança para as outras
 * abas (planejamento v0.4, seção 47.1).
 */
export function AppearanceSection() {
  const { t } = useGlossary();
  const { theme, change, isLoading, isSaving, error } = useThemeSetting();

  return (
    <section className="bg-card border-border flex max-w-[760px] flex-col gap-[18px] rounded-xl border p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold">Aparência</span>
        <span className="text-muted-foreground text-[13px]">Como o produto fala com você.</span>
      </div>

      <Separator />

      <div className="flex items-start justify-between gap-8">
        <div className="flex flex-col gap-1">
          <label htmlFor={SWITCH_ID} className="text-sm font-medium">
            {t("settings.theme.toggle")}
          </label>
          <span className="text-muted-foreground text-[13px] leading-5">
            {t("settings.theme.description")}
          </span>
        </div>

        <Switch
          id={SWITCH_ID}
          checked={theme === "dnd"}
          disabled={isLoading || isSaving}
          onCheckedChange={(checked) => {
            change(checked ? "dnd" : "plain");
          }}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="border-border bg-input/20 flex items-center rounded-lg border px-5 py-4">
          <PreviewHalf term={PREVIEW.dnd} caption="Interruptor ligado" display />
          <span aria-hidden className="bg-border w-px self-stretch" />
          <PreviewHalf term={PREVIEW.plain} caption="Interruptor desligado" />
        </div>
        <span className="text-muted-foreground text-xs leading-[18px]">
          O interruptor troca só texto. Rotas, URLs, ícones, layout e dados são idênticos nos dois
          modos, e a página não recarrega.
        </span>
      </div>

      {error !== null && <p className="text-destructive text-sm">{error.message}</p>}

      <div className="text-muted-foreground flex items-center gap-2">
        <Search aria-hidden className="size-3.5" />
        <span className="text-xs">
          Esta tela também abre pela paleta de comandos: {PALETTE_SHORTCUT}.
        </span>
      </div>
    </section>
  );
}

function PreviewHalf({
  term,
  caption,
  display = false,
}: {
  readonly term: string;
  readonly caption: string;
  readonly display?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5 py-1">
      <span className={display ? "font-display text-xl font-semibold" : "text-xl font-semibold"}>
        {term}
      </span>
      <span className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
        {caption}
      </span>
    </div>
  );
}
