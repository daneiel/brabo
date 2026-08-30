import { useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ProjectRail.module.css';

/** Uma folha do trilho — sempre uma ABA de verdade, nunca um grupo, e já com
 * o `count` RESOLVIDO (número, não função). Quem resolve contra
 * `ContagensDeAba` é quem monta os `itens` — `ProjectPage.tsx` —, a mesma
 * divisão de responsabilidade que a régua anterior já tinha. */
export interface FolhaDoTrilho {
  key: string;
  label: string;
  count?: number;
}

export interface GrupoDoTrilho {
  tipo: 'grupo';
  chave: string;
  label: string;
  abas: FolhaDoTrilho[];
}

export interface AbaSoltaDoTrilho {
  tipo: 'aba';
  aba: FolhaDoTrilho;
}

export type ItemDoTrilho = GrupoDoTrilho | AbaSoltaDoTrilho;

interface ProjectRailProps {
  itens: ItemDoTrilho[];
  /** A aba selecionada agora — sempre a chave de uma folha, nunca a de um grupo. */
  active: string;
  onChange: (key: string) => void;
}

const TECLAS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/**
 * O trilho vertical de navegação do projeto (ADR 0126).
 *
 * Substitui a régua horizontal de dois níveis (`components/ui/GroupedTabs`,
 * removida na mesma mudança): 12 abas em 3 grupos não cabem numa barra
 * desenhada para meia dúzia de itens. Num trilho, os TRÊS grupos ficam
 * abertos ao mesmo tempo — é isso que a mudança compra, e é por isso que o
 * grupo deixou de ser um botão selecionável para virar um CABEÇALHO.
 *
 * ## Contadores
 *
 * Os cinco contadores (Insights, PRs, Aprovações, Backlog, Arquitetura)
 * continuam SEPARADOS, um por aba, e o grupo NÃO soma os filhos — com todos
 * eles visíveis ao mesmo tempo, a soma não teria o que resumir e apagaria
 * qual fila está pedindo atenção (a mesma decisão de produto que
 * `ContagensDeAba` já registra). Zero pendência continua não virando selo.
 *
 * ## Teclado
 *
 * `ArrowDown`/`ArrowUp`/`Home`/`End` com volta (wrap), portados do
 * `onKeyDownDaLinha` da régua anterior — trocando o eixo horizontal pelo
 * vertical. Apagar navegação por teclado que já tinha teste seria regressão
 * de acessibilidade, não refatoração. A diferença de implementação: a régua
 * antiga correlacionava por POSIÇÃO, lendo `[role="tab"]` do DOM, porque a
 * primitiva `Tabs` não expunha refs; aqui os botões são deste componente, e
 * um `Map` de refs por chave dá a correlação sem consultar o documento.
 */
export function ProjectRail({ itens, active, onChange }: ProjectRailProps) {
  const { t } = useTranslation('nav');
  const refs = useRef(new Map<string, HTMLButtonElement | null>());

  // A ordem VISUAL achatada — grupo por grupo, aba solta por aba solta. É
  // sobre ela que a seta anda: quem navega por teclado atravessa a fronteira
  // de grupo como atravessa qualquer outro item, porque no trilho não há
  // "linha de fora" e "linha de dentro" para separar.
  const folhas = useMemo<FolhaDoTrilho[]>(
    () => itens.flatMap((item) => (item.tipo === 'grupo' ? item.abas : [item.aba])),
    [itens],
  );

  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (!TECLAS.includes(e.key)) return;
    if (folhas.length === 0) return;

    const focado = folhas.findIndex((f) => refs.current.get(f.key) === document.activeElement);
    // Sem foco em folha nenhuma (o trilho recebeu a tecla por outro caminho),
    // a âncora é a aba ATIVA — nunca "a primeira", que faria a seta pular
    // para o topo em vez de andar um item.
    const ancora = focado === -1 ? Math.max(0, folhas.findIndex((f) => f.key === active)) : focado;

    let proximo = ancora;
    if (e.key === 'Home') proximo = 0;
    else if (e.key === 'End') proximo = folhas.length - 1;
    else proximo = (ancora + (e.key === 'ArrowDown' ? 1 : -1) + folhas.length) % folhas.length;

    e.preventDefault();
    const alvo = folhas[proximo];
    if (!alvo) return;
    refs.current.get(alvo.key)?.focus();
    onChange(alvo.key);
  }

  function folha(item: FolhaDoTrilho) {
    const ativo = item.key === active;
    return (
      <button
        key={item.key}
        ref={(el) => {
          refs.current.set(item.key, el);
        }}
        type="button"
        role="tab"
        aria-selected={ativo}
        className={[styles.item, ativo && styles.itemAtivo].filter(Boolean).join(' ')}
        onClick={() => onChange(item.key)}
      >
        <span className={styles.itemLabel}>{item.label}</span>
        {item.count !== undefined && <span className={styles.contador}>{item.count}</span>}
      </button>
    );
  }

  return (
    // `role="presentation"` nos invólucros: um `tablist` só POSSUI elementos
    // `tab`, e é o que mantém os 12 botões filhos diretos da lista para a
    // tecnologia assistiva mesmo agrupados visualmente. O cabeçalho do grupo
    // continua sendo texto lido — ele diz de que grupo a próxima leva de abas
    // é —, só não é alvo de seleção.
    <nav
      className={styles.trilho}
      role="tablist"
      aria-orientation="vertical"
      aria-label={t('rail.ariaLabel')}
      onKeyDown={aoTeclar}
    >
      {itens.map((item) =>
        item.tipo === 'grupo' ? (
          <div key={`grupo:${item.chave}`} className={styles.grupo} role="presentation">
            <span className={styles.grupoLabel} role="presentation">
              {item.label}
            </span>
            {item.abas.map(folha)}
          </div>
        ) : (
          <div key={`aba:${item.aba.key}`} className={styles.solta} role="presentation">
            {folha(item.aba)}
          </div>
        ),
      )}
    </nav>
  );
}
