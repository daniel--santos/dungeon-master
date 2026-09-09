import type { GlossaryKey } from "@dungeon-master/glossary";
import {
  Anvil,
  BookOpen,
  CirclePlay,
  Folder,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Package,
  Settings,
  Trophy,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";

import type { FileRouteTypes } from "@/routeTree.gen";

/** Um destino de navegação, validado contra a árvore de rotas gerada. */
export type NavPath = FileRouteTypes["to"];

export interface NavItem {
  readonly to: NavPath;
  /** A chave do glossário; o texto do item nunca é escrito aqui. */
  readonly label: GlossaryKey;
  readonly icon: LucideIcon;
  /** Abre um grupo novo na barra lateral, separado por um traço. */
  readonly startsGroup?: true;
  /**
   * Outras rotas que este item representa. O Arsenal é um destino só na
   * barra, mas Habilidades, Itens, Relíquias e Patronatos têm rotas próprias:
   * em qualquer uma delas o item fica ativo e a trilha do cabeçalho o nomeia.
   */
  readonly matches?: readonly NavPath[];
}

/**
 * As onze telas da seção 8 do planejamento v0.4, na ordem do design, mais o
 * Arsenal da Fase 8C.
 *
 * Rota e ícone são idênticos nos dois temas; só o label muda, e ele vem do
 * glossário ativo. Três grupos: o trabalho do dia, o acervo, e o fim da barra.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", label: "nav.dashboard", icon: LayoutDashboard },
  { to: "/inbox", label: "nav.inbox", icon: Inbox },
  { to: "/projects", label: "nav.projects", icon: Folder },
  { to: "/tasks", label: "nav.tasks", icon: ListChecks },
  { to: "/runs", label: "nav.runs", icon: CirclePlay },
  { to: "/knowledge", label: "nav.knowledge", icon: BookOpen, startsGroup: true },
  { to: "/agents", label: "nav.agents", icon: Users },
  { to: "/loadouts", label: "nav.loadouts", icon: Package },
  {
    to: "/skills",
    label: "nav.registry",
    icon: Anvil,
    matches: ["/skills", "/tools", "/mcp-servers", "/providers"],
  },
  { to: "/workflows", label: "nav.workflows", icon: WandSparkles },
  { to: "/hall", label: "nav.hall", icon: Trophy, startsGroup: true },
  { to: "/settings", label: "nav.settings", icon: Settings },
];

/** Os mesmos itens indexados pela rota, para quem já sabe em qual tela está. */
export const NAV_BY_PATH = Object.fromEntries(NAV_ITEMS.map((item) => [item.to, item])) as Readonly<
  Record<NavPath, NavItem>
>;

/** As rotas que um item representa: a própria e as de `matches`. */
export function navPathsOf(item: NavItem): readonly NavPath[] {
  return item.matches ?? [item.to];
}

/** O item de navegação que representa uma rota, pela raiz do caminho. */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find(
    (item) =>
      item.to !== "/" &&
      navPathsOf(item).some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
}
