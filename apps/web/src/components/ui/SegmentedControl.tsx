import { Chip } from './Chip';
import styles from './SegmentedControl.module.css';

export interface OpcaoSegmentada<V extends string> {
  valor: V;
  rotulo: string;
}

interface SegmentedControlProps<V extends string> {
  opcoes: readonly OpcaoSegmentada<V>[];
  valor: V;
  onChange: (valor: V) => void;
  /** O nome do grupo para o leitor de tela ("Filtrar por estado"). */
  rotulo: string;
  className?: string;
}

/**
 * O controle segmentado do design system (AT-327): um grupo de `Chip`s em que
 * UM está ligado por vez. Serve tanto a filtro de lista (Criativo, PRs) quanto
 * a troca de painel (Chat: Conversar/Buscar) — nos dois casos a pergunta é a
 * mesma, "qual destes", e a resposta visual passa a ser uma só.
 *
 * Antes eram três estilos: pílulas mono nas abas Criativo e Chat, e abas
 * retangulares em sans nas PRs, com `role="tab"` sem painel nenhum para
 * controlar. A semântica escolhida é a do `Chip` — botão de alternar com
 * `aria-pressed` dentro de um `role="group"` rotulado —, porque é filtro, não
 * navegação: `tablist` promete um `tabpanel` que nenhuma das três telas tem.
 */
export function SegmentedControl<V extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
  className,
}: SegmentedControlProps<V>) {
  return (
    <div
      className={[styles.grupo, className].filter(Boolean).join(' ')}
      role="group"
      aria-label={rotulo}
      data-segmented-control=""
    >
      {opcoes.map((opcao) => (
        <Chip key={opcao.valor} pressed={opcao.valor === valor} onClick={() => onChange(opcao.valor)}>
          {opcao.rotulo}
        </Chip>
      ))}
    </div>
  );
}
