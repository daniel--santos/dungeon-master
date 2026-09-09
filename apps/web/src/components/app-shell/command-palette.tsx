import type { GlossaryKey } from "@dungeon-master/glossary";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { NAV_ITEMS, type NavItem, type NavPath } from "@/components/app-shell/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useGlossary } from "@/lib/glossary";

/**
 * O atalho como o sistema do usuário o escreve.
 *
 * O atalho em si é o mesmo em toda plataforma: ⌘K vira Ctrl+K onde não há
 * tecla de comando.
 */
export const PALETTE_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
    ? "⌘K"
    : "Ctrl K";

/**
 * Estado da paleta de comandos, compartilhado entre o botão do cabeçalho e o
 * atalho de teclado.
 *
 * Fica num hook e não numa store porque a paleta é uma só, montada no layout
 * raiz junto do cabeçalho que a abre.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // ⌘K no macOS, Ctrl+K no Windows. O mesmo atalho nos dois temas: o
      // interruptor troca texto, nunca atalho (planejamento v0.4, seção 14).
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((current) => !current);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return { open, setOpen };
}

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** As quatro rotas do Arsenal (Fase 8C), cada uma com o nome do próprio registro. */
const REGISTRY_DESTINATIONS: readonly { readonly to: NavPath; readonly label: GlossaryKey }[] = [
  { to: "/skills", label: "entity.skill.plural" },
  { to: "/tools", label: "entity.tool.plural" },
  { to: "/mcp-servers", label: "entity.mcpServer.plural" },
  { to: "/providers", label: "entity.provider.plural" },
];

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useGlossary();
  const navigate = useNavigate();

  const go = useCallback(
    (to: NavPath) => {
      onOpenChange(false);
      void navigate({ to });
    },
    [navigate, onOpenChange],
  );

  const registry = NAV_ITEMS.find((item: NavItem) => item.label === "nav.registry");

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paleta de comandos"
      description="Busque uma tela ou uma ação."
    >
      <CommandInput placeholder="Buscar…" />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>

        <CommandGroup heading="Ir para">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.to}
              value={`${t(item.label)} ${item.to}`}
              onSelect={() => {
                go(item.to);
              }}
            >
              <item.icon aria-hidden />
              <span>{t(item.label)}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {registry !== undefined && (
          <CommandGroup heading={t(registry.label)}>
            {REGISTRY_DESTINATIONS.map((destination) => (
              <CommandItem
                key={destination.to}
                value={`${t(registry.label)} ${t(destination.label)} ${destination.to}`}
                onSelect={() => {
                  go(destination.to);
                }}
              >
                <registry.icon aria-hidden />
                <span>{t(destination.label)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Ações">
          <CommandItem
            value="Capturar"
            onSelect={() => {
              // Nesta rodada a ação só leva à tela; o campo de captura chega
              // com a Inbox de verdade.
              go("/inbox");
            }}
          >
            <Plus aria-hidden />
            <span>Capturar</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
