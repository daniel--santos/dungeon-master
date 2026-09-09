import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useEventsStore } from "@/lib/events";
import { invalidateExecution } from "@/lib/execution";
import { invalidateRegistry } from "@/lib/registry";

/**
 * Os prefixos de `RegistryEventType` que não são de Workflow.
 *
 * `workflow.` também é cadastro, mas tem tela e chave próprias e continua no
 * ramo dele, logo acima.
 */
const REGISTRY_PREFIXES = [
  "harness.",
  "model.",
  "agent.",
  "execution_profile.",
  "loadout.",
] as const;

/**
 * Invalida as queries afetadas por cada evento de domínio do SSE.
 *
 * O caminho inteiro é: a escrita grava a linha de `activity` e o evento na
 * mesma transação, o trigger emite o `NOTIFY`, a API empurra pelo stream, e
 * aqui a query volta ao servidor. Uma captura feita em outra aba aparece no
 * Quadro sem recarregar e sem polling.
 *
 * A invalidação é por prefixo, e não por chave exata, porque o evento não diz
 * qual página da lista mudou — e uma lista errada por uma página é pior do que
 * uma releitura a mais.
 */
export function useLiveQueries(): void {
  const queryClient = useQueryClient();
  const addListener = useEventsStore((state) => state.addListener);

  useEffect(() => {
    return addListener((event) => {
      if (event.type.startsWith("task.")) {
        // Uma Task mexe na sua própria lista, na Inbox (que são Tasks em
        // `INBOX`), nas contagens por estado que a tela de Project mostra e
        // no grafo do Project (Fase 5B): criar, mudar de estado, ligar ou
        // desligar uma dependência muda o desenho. `task.proposed` e
        // `task.proposal.resolved` também começam por `task.`, e a caixa de
        // propostas relê junto.
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["inbox"] });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        void queryClient.invalidateQueries({ queryKey: ["task-graph"] });
        void queryClient.invalidateQueries({ queryKey: ["proposed-tasks"] });
        return;
      }

      if (event.type.startsWith("project.")) {
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        return;
      }

      // post-mortem #17 (08/09/2026): não havia ramo para `run.`. Uma Expedição
      // reclamada pelo Worker e encerrada ficava desenhada em "Na fila" na
      // lista de `/runs` até uma navegação de página inteira: `useRuns` não tem
      // `refetchInterval` e só `approval.*` invalidava `["runs"]`, de carona —
      // o que existe apenas em Run com Ritual. O cockpit tinha stream próprio e
      // escondia o defeito de quem olhava só uma Expedição.
      if (event.type.startsWith("run.")) {
        // O mesmo conjunto que `useCreateRun` invalida: a Expedição muda a sua
        // lista, o estado da Missão de origem e as contagens da Campanha.
        void queryClient.invalidateQueries({ queryKey: ["runs"] });
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["projects"] });
        return;
      }

      if (event.type.startsWith("workflow.")) {
        // Criar, editar ou apagar um Workflow muda a lista, o detalhe e as
        // escolhas que a Task oferece.
        void queryClient.invalidateQueries({ queryKey: ["workflows"] });
        return;
      }

      if (event.type === "registry.changed") {
        // Os quatro registros da Fase 8A saem num tipo só, com `kind` no
        // payload. A invalidação é dos quatro de uma vez, mais os cadastros
        // de execução: um Loadout mostra o nome e o `latestVersion` de cada
        // Skill, e uma Skill publicada muda o que o pin oferece.
        invalidateRegistry(queryClient);
        return;
      }

      if (REGISTRY_PREFIXES.some((prefix) => event.type.startsWith(prefix))) {
        // Os cadastros de execução existem, no contrato, só para a tela deles
        // se atualizar sozinha: uma mudança feita em outra aba, pelo `db:seed`
        // ou pela CLI precisa chegar sem navegação. O conjunto de chaves é o
        // mesmo das mutações locais, e por isso vem de lá.
        invalidateExecution(queryClient);
        return;
      }

      if (event.type.startsWith("approval.")) {
        // Um gate aberto ou decidido muda a caixa de pendentes, o estado do Run
        // (que parou ou voltou à fila) e os steps dele.
        void queryClient.invalidateQueries({ queryKey: ["approval-gates"] });
        void queryClient.invalidateQueries({ queryKey: ["runs"] });
        return;
      }

      if (event.type.startsWith("knowledge.") || event.type.startsWith("knowledge_item.")) {
        // Um lote destilado, um item revisado ou promovido (Fase 6B): a lista e
        // a fila do Grimório, o resumo, as decisões, os lotes e o contador da
        // navegação releem; os candidatos do cockpit também, porque o lote é o
        // que os decide.
        void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
        void queryClient.invalidateQueries({ queryKey: ["knowledge-candidates"] });
        return;
      }

      if (event.type === "achievement.forged") {
        // A forja ganhou uma carta: a seção do Hall relê. O toast mora em
        // `useForgedToasts`, no layout raiz.
        void queryClient.invalidateQueries({ queryKey: ["achievements", "forged"] });
      }
    });
  }, [addListener, queryClient]);
}
