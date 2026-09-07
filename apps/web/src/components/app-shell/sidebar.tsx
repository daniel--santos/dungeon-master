import { Link } from "@tanstack/react-router";
import { Fragment } from "react";

import { BrandMark } from "@/components/app-shell/brand-mark";
import { NAV_ITEMS } from "@/components/app-shell/navigation";
import { useGlossary } from "@/lib/glossary";
import { WEB_VERSION } from "@/lib/version";

/**
 * A barra lateral do design da Fase 1: marca, onze destinos em três grupos e
 * a versão no rodapé.
 *
 * Ícone, rota e ordem são iguais nos dois temas; só o texto do item muda.
 */
export function Sidebar() {
  const { t } = useGlossary();

  return (
    <aside className="bg-card border-border flex w-62 flex-none flex-col border-r">
      <div className="border-border flex h-14 items-center gap-2.5 border-b px-4">
        <BrandMark className="text-foreground size-5" />
        <span className="text-[15px] font-semibold tracking-tight">{t("system.name")}</span>
      </div>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV_ITEMS.map((item) => (
          <Fragment key={item.to}>
            {item.startsGroup === true && <div aria-hidden className="bg-border mx-1 my-2 h-px" />}
            <Link
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors"
              activeProps={{ className: "bg-muted text-foreground font-medium" }}
              inactiveProps={{ className: "text-muted-foreground hover:text-foreground" }}
            >
              <item.icon aria-hidden className="size-4 flex-none" />
              <span>{t(item.label)}</span>
            </Link>
          </Fragment>
        ))}
      </nav>

      <div className="border-border text-muted-foreground border-t px-4 py-3 text-[11px]">
        {t("system.name")} {WEB_VERSION}
      </div>
    </aside>
  );
}
