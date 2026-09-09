import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { PALETTE_SHORTCUT } from "@/components/app-shell/command-palette";
import { navItemFor } from "@/components/app-shell/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGlossary } from "@/lib/glossary";

/**
 * Iniciais do usuário a partir do label do glossário.
 *
 * Derivadas, e não escritas: "Mestre da Guilda" vira MG e "Você" vira V sem
 * que nenhum dos dois apareça no código.
 */
function initialsOf(label: string): string {
  const words = label.split(/\s+/).filter((word) => word.length > 2);
  const source = words.length > 0 ? words : [label];
  return source
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join("");
}

export interface HeaderProps {
  readonly onOpenPalette: () => void;
}

export function Header({ onOpenPalette }: HeaderProps) {
  const { t } = useGlossary();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = navItemFor(pathname);
  const user = t("entity.user");

  return (
    <header className="border-border bg-background flex h-14 flex-none items-center gap-4 border-b px-6">
      <nav aria-label="Trilha" className="flex min-w-0 items-center gap-1.5 text-sm">
        {current === undefined ? (
          <span aria-current="page" className="truncate font-medium">
            {t("nav.dashboard")}
          </span>
        ) : (
          <>
            <Link to="/" className="text-muted-foreground hover:text-foreground truncate">
              {t("nav.dashboard")}
            </Link>
            <ChevronRight aria-hidden className="text-muted-foreground size-3.5 flex-none" />
            <span aria-current="page" className="truncate font-medium">
              {t(current.label)}
            </span>
          </>
        )}
      </nav>

      <button
        type="button"
        onClick={onOpenPalette}
        className="border-input bg-input/30 text-muted-foreground hover:border-ring flex h-9 w-[420px] min-w-0 shrink items-center justify-between gap-2 rounded-lg border px-3 text-sm transition-colors"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Search aria-hidden className="size-4 flex-none" />
          <span className="truncate">
            {`Buscar ${t("entity.task.plural")}, ${t("entity.project.plural")}, ${t("entity.agent.plural")}…`}
          </span>
        </span>
        <kbd className="border-border bg-muted/60 text-muted-foreground flex h-5 flex-none items-center rounded-md border px-1.5 font-mono text-[11px]">
          {PALETTE_SHORTCUT}
        </kbd>
      </button>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger className="border-border bg-card flex h-9 flex-none items-center gap-2 rounded-lg border py-0 pr-2 pl-1.5">
          <span
            aria-hidden
            className="bg-muted text-foreground flex size-6 items-center justify-center rounded-full text-[10px] font-semibold"
          >
            {initialsOf(user)}
          </span>
          <span className="text-sm font-medium">{user}</span>
          <ChevronDown aria-hidden className="text-muted-foreground size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{user}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings">{t("nav.settings")}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
