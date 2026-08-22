import { alturasRelativas, diaCurto, tituloDoDia, type SpendPorDia } from '../lib/spend';
import { formatarUsd } from './CredentialSpendSection';
import styles from './SpendCharts.module.css';

/**
 * Os gráficos do relatório de gasto, em SVG inline (FASE 22).
 *
 * Sem biblioteca: são duas formas, uma série cada, e nenhuma delas precisa de
 * escala calculada, eixo negociado ou paleta categórica — instalar uma
 * dependência de gráficos aqui seria pagar peso de runtime por `<rect>`.
 *
 * Uma série só, então não há legenda: o título já a nomeia. A cor é o `--accent`
 * do design system, e o texto usa tokens de TEXTO — nunca a cor da série.
 *
 * `BarrasPorDia` NÃO ganhou modo empilhado por provider (PROGRAMA 28, Onda 3,
 * frente D1). Não é esquecimento: a quebra por provider virou `Ranking` (ver
 * `ProjectSpendTab.tsx`), e o porquê — paleta categórica que não passa na
 * validação da skill de dataviz, mais a ausência de agregação cruzada
 * dia×provider no backend — está em `lib/spend.ts`, no bloco "Gasto por
 * PROVIDER na tela" (RN-211).
 */

/**
 * A série diária, em barras.
 *
 * Barras e não linha: o dado é uma soma por dia (magnitude discreta), e uma
 * linha entre dois dias sugeriria gasto contínuo no meio, que não existe.
 *
 * O `viewBox` faz a escala; a largura vem do CSS. Assim a mesma sparkline serve
 * o card estreito do membro e a faixa larga do owner sem recalcular nada.
 */
export function BarrasPorDia({
  serie,
  titulo,
}: {
  serie: SpendPorDia[];
  titulo: string;
}) {
  const alturas = alturasRelativas(serie.map((p) => p.costMicros));
  const largura = Math.max(serie.length, 1) * 10;
  const semGasto = alturas.every((a) => a === 0);

  return (
    <figure className={styles.figura}>
      <figcaption className={styles.legenda}>{titulo}</figcaption>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${largura} 40`}
        preserveAspectRatio="none"
        role="img"
        aria-label={titulo}
      >
        {serie.map((ponto, i) => {
          // Piso de 1 unidade em dia COM gasto: uma barra de altura zero seria
          // indistinguível de um dia sem nenhuma chamada.
          const altura = alturas[i] === 0 ? 0 : Math.max(1, alturas[i] * 36);
          return (
            <rect
              key={ponto.dia}
              x={i * 10 + 1.5}
              // Ancorada na linha de base, que é onde o zero mora.
              y={40 - altura}
              width={7}
              height={altura}
              // Sem `rx`: com `preserveAspectRatio="none"` os eixos escalam em
              // fatores diferentes, e um raio uniforme sai como elipse achatada
              // no topo de cada barra. Canto quadrado é melhor que canto errado.
              className={styles.barra}
            >
              <title>{tituloDoDia(ponto, formatarUsd(ponto.costMicros))}</title>
            </rect>
          );
        })}
      </svg>
      <div className={styles.eixo}>
        <span>{serie.length > 0 ? diaCurto(serie[0].dia) : ''}</span>
        <span>{serie.length > 0 ? diaCurto(serie[serie.length - 1].dia) : ''}</span>
      </div>
      {semGasto && (
        <div className={styles.eixoVazio}>Nenhum gasto nesta janela.</div>
      )}
    </figure>
  );
}

export interface LinhaDeRanking {
  chave: string;
  rotulo: string;
  costMicros: number;
  detalhe: string;
}

/**
 * O ranking, em barras horizontais.
 *
 * Barra horizontal e não pizza: a pergunta é "qual é o maior" e depois "quanto
 * maior", e comparar comprimento é a única leitura que as pessoas fazem bem.
 * A escala é relativa ao PRIMEIRO da lista, que já vem ordenado pela api.
 *
 * O valor aparece como número ao lado, sempre: barra sem número obriga a
 * estimar, e este relatório existe para dizer quanto.
 */
export function Ranking({
  titulo,
  linhas,
  vazio,
}: {
  titulo: string;
  linhas: LinhaDeRanking[];
  vazio: string;
}) {
  const alturas = alturasRelativas(linhas.map((l) => l.costMicros));

  return (
    <section className={styles.ranking}>
      <h3 className={styles.rankingTitulo}>{titulo}</h3>
      {linhas.length === 0 ? (
        <div className={styles.rankingVazio}>{vazio}</div>
      ) : (
        <ul className={styles.rankingLista}>
          {linhas.map((linha, i) => (
            <li key={linha.chave} className={styles.rankingItem}>
              {/* Sem `title`: o rótulo quebra em vez de truncar, então um
                  tooltip repetiria o texto visível — ruído para leitor de tela. */}
              <span className={styles.rankingRotulo}>{linha.rotulo}</span>
              <span className={styles.rankingTrilho}>
                <span
                  className={styles.rankingBarra}
                  style={{ width: `${Math.max(alturas[i] * 100, linha.costMicros > 0 ? 2 : 0)}%` }}
                />
              </span>
              <span className={styles.rankingDetalhe}>{linha.detalhe}</span>
              <span className={styles.rankingValor}>
                {formatarUsd(linha.costMicros)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** O número-herói: um valor grande, sem gráfico, porque é uma leitura só. */
export function Destaque({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  detalhe: string;
}) {
  return (
    <div className={styles.destaque}>
      <span className={styles.destaqueRotulo}>{rotulo}</span>
      <span className={styles.destaqueValor}>{valor}</span>
      <span className={styles.destaqueDetalhe}>{detalhe}</span>
    </div>
  );
}
