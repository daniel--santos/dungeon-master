import { configure } from "@testing-library/react";

/**
 * Testes de componente em jsdom são lentos nos runners do CI: no
 * `windows-latest`, três selects do Radix levaram mais de 6 s e a query de
 * settings passou de 1 s. Os limites padrão (1 s no `waitFor`/`findBy*`, 5 s
 * por teste) medem a máquina, não o componente. Os valores aqui são tetos
 * largos para não haver falso negativo; um teste que os estoura está travado
 * de verdade.
 */
configure({ asyncUtilTimeout: 15_000 });

/**
 * O jsdom não tem `ResizeObserver`, e o Checkbox do Radix o usa quando está
 * dentro de um `<form>` (o input oculto que participa do envio mede o botão
 * visível). Os formulários de política e de disjuntor (Fase 9C) são os
 * primeiros a pôr um Checkbox num `<form>`. Um stub que nunca observa basta:
 * o tamanho não importa em teste.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
    configurable: true,
    writable: true,
  });
}
