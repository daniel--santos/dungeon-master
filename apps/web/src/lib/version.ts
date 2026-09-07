/**
 * A versão da web, lida do `package.json` em tempo de build.
 *
 * O valor entra por `define` do Vite (veja `vite.config.ts` e
 * `vitest.config.ts`), e não por um import de JSON, para não arrastar o
 * `package.json` inteiro para dentro do bundle.
 */
declare const __WEB_VERSION__: string;

export const WEB_VERSION: string = __WEB_VERSION__;
