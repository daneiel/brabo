import type { Story } from './api-types';

/**
 * Por que os controles de corrigir uma história (RN-727) ficam inertes — o
 * texto que a tela diz UMA vez, em vez de um tooltip em botão `disabled`.
 * `null` quando a pessoa pode editar e arquivar. A régua é a da api
 * (`recusaDeCorrecaoDeHistoria`): papel `developer` (o do endpoint), só
 * `draft`, e sem tarefa `in_progress`/`in_review`.
 */
export function motivoDeCorrecaoInerte(
  story: Pick<Story, 'status' | 'tasks'>,
  podeEscrever: boolean,
): { chave: string; count?: number } | null {
  if (!podeEscrever) return { chave: 'storyNode.inertRole' };
  if (story.status !== 'draft') return { chave: 'storyNode.inertStatus' };
  const emExecucao = story.tasks.filter(
    (t) => t.status === 'in_progress' || t.status === 'in_review',
  ).length;
  if (emExecucao > 0) {
    return { chave: 'storyNode.inertRunning', count: emExecucao };
  }
  return null;
}
