import { ToggleGroup, ToggleGroupItem } from '@/components/shadcn/toggle-group';

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
 * O controle segmentado do design system (AT-327): um grupo de chips (`ToggleGroup`) em que
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
    <ToggleGroup
      variant="chip"
      size="chip"
      value={[valor]}
      // O grupo aceita `[]` (desmarcar o ligado); aqui sempre há UM ligado.
      onValueChange={(v) => {
        if (v.length > 0) onChange(v[0] as V);
      }}
      className={className}
      aria-label={rotulo}
      data-segmented-control=""
    >
      {opcoes.map((opcao) => (
        <ToggleGroupItem key={opcao.valor} value={opcao.valor}>
          {opcao.rotulo}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
