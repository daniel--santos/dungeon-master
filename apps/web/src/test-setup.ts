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
