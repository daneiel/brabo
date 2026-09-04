import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/Badge';
import styles from '../ProjectSettingsTab.module.css';

/**
 * O padrão ÚNICO de "valor herdado" da aba Configurações.
 *
 * ## O problema que este módulo fecha
 *
 * A MESMA ideia — "este ajuste não tem valor próprio, então o que vale vem de
 * outro lugar" — era dita de quatro formas diferentes na mesma aba:
 * `"Sem valor próprio — usa o default (N)"` na Execução, `"Sem teto"` como
 * placeholder no Teto de gasto, `"voltar a herdar"` em Modelos por agente e
 * `"Voltar a herdar"` em Modelo por área. Quatro redações, quatro chaves de
 * i18n independentes, nada impedindo a quinta de nascer diferente das outras
 * quatro. Aqui elas passam a ter UMA fonte.
 *
 * ## Os dois polos, e por que o rótulo não nomeia o mecanismo
 *
 * O vocabulário tem dois polos e nenhum meio-termo: **Sem valor próprio** e
 * **Valor próprio**. O rótulo diz o ESTADO; o `detalhe` (opcional) diz a
 * CONSEQUÊNCIA, e é só ele que muda de seção para seção — porque o mecanismo
 * de fato muda. O circuit breaker cai num default do produto, o teto de gasto
 * simplesmente não existe, e o modelo cai na cascata `workspace → project →
 * area → agent → session` (ADR 0064). Um rótulo que dissesse "Herdado" nos
 * três afirmaria uma cascata onde só existe uma constante — o teto de gasto é
 * declaradamente ADITIVO aos budgets de projeto e sessão, não uma herança
 * deles (ver `BudgetSection`). "Sem valor próprio" é verdade nos três.
 *
 * ## Não é um componente para os quatro lugares
 *
 * `MarcaDeHeranca` só entra onde o CONTROLE não consegue mostrar o estado
 * sozinho. Isso é uma diferença real entre as seções, não uma inconsistência:
 * o campo da Execução vem PRÉ-PREENCHIDO com o default (mostra `3` tendo ou
 * não valor próprio, e portanto não distingue nada), enquanto na tabela de
 * Modelos por agente a coluna Origem já é a marca de estado da linha. Forçar
 * a mesma FORMA nos quatro duplicaria informação onde ela já existe; o que se
 * unifica é o vocabulário. O que a tabela consome daqui é o verbo
 * (`useVoltarAHerdar`), não a marca.
 */
export function MarcaDeHeranca({
  proprio,
  detalhe,
}: {
  /** `true` quando o ajuste TEM valor próprio neste escopo. */
  proprio: boolean;
  /** O que vale no lugar (polo ausente) ou onde o valor foi definido. */
  detalhe?: string;
}) {
  const { t } = useTranslation('settings');
  return (
    <span className={styles.heranca}>
      {/* `success` para o valor próprio e `muted` para a ausência são os
          MESMOS tons que `ORIGIN_TONE` já dá a `agent` (o nível mais
          específico, o que divergiu) e a `workspace` (o mais genérico, o que
          se herda) — a marca não inventa uma segunda semântica de cor. */}
      <Badge square tone={proprio ? 'success' : 'muted'}>
        {proprio ? t('heranca.proprio') : t('heranca.semValorProprio')}
      </Badge>
      {detalhe && <span className={styles.herancaDetalhe}>{detalhe}</span>}
    </span>
  );
}

/**
 * "Voltar a herdar" nos DOIS registros tipográficos em que a aba o usa.
 *
 * `rotulo` é o botão de verdade (`Modelo por área`); `rotuloInline` é o link
 * discreto de 11px em mono dentro da célula da tabela de `Modelos por agente`,
 * onde caixa alta competiria com o `ModelPicker` da linha — a escolha está
 * documentada em `.voltarHerdar`, no CSS. As duas saem da MESMA chave: o
 * registro é typographic, o vocabulário é um só, e não há como uma mudar sem
 * a outra.
 *
 * `toLocaleLowerCase` e não `text-transform: lowercase` porque o rótulo é o
 * NOME ACESSÍVEL do botão: CSS mudaria o pixel e deixaria a tecnologia
 * assistiva (e o teste que consulta por `name`) lendo a outra forma.
 */
export function useVoltarAHerdar() {
  const { t } = useTranslation('settings');
  const rotulo = t('heranca.voltarAHerdar');
  return { rotulo, rotuloInline: rotulo.toLocaleLowerCase() };
}
