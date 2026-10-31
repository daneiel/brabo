import { useQuery } from '@tanstack/react-query';
import { getOpenQuestions } from './api-client';

/**
 * RN-861 (AT-521): a fila "Perguntas em aberto" do projeto. UMA chave, lida
 * pelo bloco de pendências do chat e pelo aviso do composer. SEM poll: quem
 * diz quando reler é o canal da sessão (`artifact.open_question`,
 * `open_question.answered`, `pr.gate_changed` — alvo `perguntas` do
 * `criarInvalidadorDoCanal`) e a resposta dada aqui.
 */
export const CHAVE_DAS_PERGUNTAS_EM_ABERTO = (projectId: string) =>
  ['open-questions', projectId, 'open'] as const;

/** Âncora da fila, alvo do atalho do composer. */
export const ID_DA_FILA_DE_PERGUNTAS = 'fila-perguntas-em-aberto';

export function usePerguntasEmAberto(projectId: string | undefined) {
  return useQuery({
    queryKey: CHAVE_DAS_PERGUNTAS_EM_ABERTO(projectId ?? ''),
    queryFn: () => getOpenQuestions(projectId!, 'open'),
    enabled: !!projectId,
  });
}

export function rolarAteAsPerguntas() {
  document.getElementById(ID_DA_FILA_DE_PERGUNTAS)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}
