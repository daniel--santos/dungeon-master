/**
 * A marca do produto: um dado de vinte faces estilizado.
 *
 * É um desenho próprio, e não um ícone do lucide, porque nenhum dos ícones da
 * biblioteca é este traço. Vem direto do canvas de design da Fase 1
 * (`docs/design/fase1/build-artboards.mjs`, ícone `die`).
 */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2.5 3.5 7.25v9.5L12 21.5l8.5-4.75v-9.5z" />
      <path d="M12 8.5 7.5 15.5h9z" />
    </svg>
  );
}
