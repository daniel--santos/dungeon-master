import { dnd, plain, THEME_IDS, type ThemeId } from "@dungeon-master/glossary";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EnvBadge, type EnvBadgeSize } from "@/components/execution/env-badge";
import { useGlossaryStore } from "@/lib/glossary";

/**
 * A regra da seção 14, provada nos dois temas, nos dois modos e nos três
 * tamanhos: trocar o tema muda o nome, nunca o aviso nem o texto canônico.
 *
 * O contraexemplo do artboard de componente é justamente uma linha só com
 * "Campo aberto". Se este teste passar a permitir isso, a informação de
 * segurança sumiu da tela.
 */

const SIZES: readonly EnvBadgeSize[] = ["lg", "md", "sm"];

afterEach(() => {
  cleanup();
  useGlossaryStore.setState({ theme: "dnd" });
});

function comTema(theme: ThemeId, ui: React.ReactElement) {
  useGlossaryStore.setState({ theme });
  return render(ui);
}

describe("badge de ambiente", () => {
  it.each(THEME_IDS)("no modo host, %s mostra nome, aviso e canônico", (theme) => {
    const glossary = theme === "dnd" ? dnd : plain;

    for (const size of SIZES) {
      cleanup();
      comTema(theme, <EnvBadge mode="HOST" size={size} />);

      expect(screen.getByText(glossary["env.host"])).toBeDefined();
      expect(screen.getByText(glossary["env.host.warning"])).toBeDefined();
      expect(screen.getByText(glossary["env.host.canonical"])).toBeDefined();
    }
  });

  it.each(THEME_IDS)("o aviso e o canônico do host são idênticos em %s", (theme) => {
    comTema(theme, <EnvBadge mode="HOST" />);

    expect(screen.getByText("sem isolamento")).toBeDefined();
    expect(screen.getByText("HOST · UNISOLATED")).toBeDefined();
  });

  it.each(THEME_IDS)("no modo docker, %s mostra nome e canônico, sem aviso de host", (theme) => {
    const glossary = theme === "dnd" ? dnd : plain;

    comTema(theme, <EnvBadge mode="DOCKER" />);

    expect(screen.getByText(glossary["env.docker"])).toBeDefined();
    expect(screen.getByText(glossary["env.docker.canonical"])).toBeDefined();
    expect(screen.queryByText(glossary["env.host.warning"])).toBeNull();
  });

  it("o modo aparece como dado, para a tabela e o e2e o encontrarem", () => {
    const { container } = comTema("dnd", <EnvBadge mode="HOST" size="sm" />);

    expect(container.querySelector('[data-env-badge="HOST"]')).not.toBeNull();
  });

  it("trocar o tema troca o nome e mantém o resto", () => {
    const { rerender } = comTema("dnd", <EnvBadge mode="HOST" />);
    expect(screen.getByText(dnd["env.host"])).toBeDefined();

    useGlossaryStore.setState({ theme: "plain" });
    rerender(<EnvBadge mode="HOST" />);

    expect(screen.getByText(plain["env.host"])).toBeDefined();
    expect(screen.queryByText(dnd["env.host"])).toBeNull();
    expect(screen.getByText("sem isolamento")).toBeDefined();
    expect(screen.getByText("HOST · UNISOLATED")).toBeDefined();
  });
});
