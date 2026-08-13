import { AGENTS } from '../../lib/agents';
import { ModelIcon } from './icons';
import styles from './ChatBubble.module.css';

/**
 * O avatar do agente — a caixa colorida que representa "quem está falando",
 * compartilhada entre o fio da Sessão (`SessionPage.tsx`) e o detalhe
 * expandido da árvore de Executores (`AgentTimelineTree.tsx`). Mesmo
 * componente nos dois lugares: "como desenhar um agente" é uma decisão só,
 * não duas que podem divergir com o tempo.
 *
 * O ícone é o do ROSTER (`AGENTS[id].icon`) — a mesma fonte que já
 * identifica "quem está falando" no indicador de streaming da Sessão, e não
 * o ícone por TIPO de evento que cada entrada expandida usa. Sem `id`, ou
 * agente fora do roster, degrada para `ModelIcon`, nunca para uma caixa
 * vazia.
 *
 * A cor (`--msg-color`) não é fixada aqui: quem usa o componente a define no
 * ancestral, porque o mesmo agente pode aparecer ao lado de conteúdo com
 * contexto diferente em cada tela.
 */
export function AvatarDoAgente({ id }: { id: string | undefined }) {
  const Icon = (id ? AGENTS[id as keyof typeof AGENTS]?.icon : undefined) ?? ModelIcon;
  return (
    <span className={styles.avatar}>
      <Icon size={15} />
    </span>
  );
}
