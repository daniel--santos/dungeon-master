import { NAV_BY_PATH, type NavPath } from "@/components/app-shell/navigation";
import { PageHeader } from "@/components/page-header";
import { useGlossary } from "@/lib/glossary";

export interface PlaceholderPageProps {
  readonly to: NavPath;
  /** Uma frase dizendo em qual fase a tela chega. Nada de texto de mentira. */
  readonly note: string;
}

/**
 * A tela que ainda não existe, com o título já vindo do glossário.
 *
 * A rota, o ícone e o lugar na navegação são definitivos desde agora; só o
 * conteúdo chega depois. Isso mantém o shell inteiro navegável e prova que a
 * troca de tema alcança as onze telas.
 */
export function PlaceholderPage({ to, note }: PlaceholderPageProps) {
  const { t } = useGlossary();
  const item = NAV_BY_PATH[to];

  return (
    <>
      <PageHeader title={t(item.label)} />
      <section className="border-border text-muted-foreground flex flex-col items-center gap-3 rounded-[14px] border border-dashed px-6 py-16 text-center">
        <item.icon aria-hidden className="size-6 opacity-60" />
        <p className="max-w-md text-sm leading-5">{note}</p>
      </section>
    </>
  );
}
