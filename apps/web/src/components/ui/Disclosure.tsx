import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from './icons';
import styles from './Disclosure.module.css';

interface DisclosureProps {
  /** O que o cabeçalho diz. É o nome acessível do botão. */
  titulo: ReactNode;
  children: ReactNode;
  /**
   * Estado, quando quem chama já o mantém (um `Set` de grupos abertos, por
   * exemplo). Passar isto torna o componente CONTROLADO: ele não guarda estado
   * próprio e só avisa a intenção pelo `onAlternar`.
   */
  aberto?: boolean;
  /** Estado inicial no modo não controlado. Ignorado quando `aberto` é passado. */
  padraoAberto?: boolean;
  /** Recebe o estado PRETENDIDO — não o atual. */
  onAlternar?: (aberto: boolean) => void;
  /**
   * Conteúdo à direita do título, dentro do botão: contagem, selo de
   * "N marcados", o que for. Fica dentro do alvo de clique de propósito — a
   * linha inteira alterna, não só o chevron.
   */
  trailing?: ReactNode;
  className?: string;
  /** Classe extra do cabeçalho, para quem precisa de tipografia própria. */
  classNameCabecalho?: string;
}

/**
 * Colapso com a semântica de disclosure do WAI-ARIA.
 *
 * Não existia no design system, e existiam SEIS implementações ad-hoc espalhadas
 * pelas telas — cada uma com um pedaço da semântica. A mais completa é a de
 * `ModelCatalogSection` (grupos, subgrupos, `aria-expanded`, "minimizar tudo"), e
 * é dela que sai o comportamento aqui: cabeçalho é `button` de verdade, a linha
 * inteira alterna, e o chevron é decorativo.
 *
 * **Nenhum dos seis call sites migra nesta entrega**, de propósito: os arquivos
 * onde eles moram (`SessionPage`, `ProjectOverviewTab`, `ApprovalCard`,
 * `ModelCatalogSection`) são os mais disputados do programa, e migrá-los aqui
 * colocaria esta mudança na mesma onda de quem os está reescrevendo. Cada fase
 * migra o seu.
 *
 * Três decisões que valem registro:
 *
 * - **A região existe mesmo fechada.** `aria-controls` precisa apontar para um
 *   elemento que está no DOM; um id que não resolve é pior que não ter o
 *   atributo, porque o leitor de tela anuncia o botão como se controlasse algo.
 * - **Os filhos, não.** Fechado, a região fica vazia e `hidden`. É o que permite
 *   colapsar listas caras (o catálogo do OpenRouter tem 338 modelos) sem montar
 *   o que ninguém está vendo.
 * - **Alvo de 24px** no cabeçalho, mínimo do WCAG 2.2 AA (2.5.8 Target Size), a
 *   mesma régua que `scripts/dev/validacao-visual.js` aplica no navegador.
 */
export function Disclosure({
  titulo,
  children,
  aberto,
  padraoAberto = false,
  onAlternar,
  trailing,
  className,
  classNameCabecalho,
}: DisclosureProps) {
  const base = useId();
  const idBotao = `${base}-cabecalho`;
  const idRegiao = `${base}-regiao`;

  const [internoAberto, setInternoAberto] = useState(padraoAberto);
  const controlado = aberto !== undefined;
  const estaAberto = controlado ? aberto : internoAberto;

  function alternar() {
    const proximo = !estaAberto;
    if (!controlado) setInternoAberto(proximo);
    onAlternar?.(proximo);
  }

  return (
    <div className={[styles.bloco, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        id={idBotao}
        className={[styles.cabecalho, classNameCabecalho].filter(Boolean).join(' ')}
        aria-expanded={estaAberto}
        aria-controls={idRegiao}
        onClick={alternar}
      >
        {/* Decorativo: o estado já é anunciado pelo `aria-expanded`. Repeti-lo
            no nome acessível seria ouvir "expandido" duas vezes. */}
        <span className={styles.chevron} aria-hidden="true">
          {estaAberto ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
        <span className={styles.titulo}>{titulo}</span>
        {trailing !== undefined && <span className={styles.trailing}>{trailing}</span>}
      </button>

      <div
        id={idRegiao}
        role="region"
        aria-labelledby={idBotao}
        hidden={!estaAberto}
        className={styles.regiao}
      >
        {estaAberto ? children : null}
      </div>
    </div>
  );
}
