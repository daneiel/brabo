import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useLayoutMovel } from '../lib/layout-movel';
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

const TECLAS_VERTICAL = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
// Na barra horizontal do layout móvel (RN-643) o eixo gira junto: as setas
// que andam são as do eixo em que os itens estão dispostos.
const TECLAS_HORIZONTAL = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];

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
 *
 * ## Layout móvel (RN-643)
 *
 * Abaixo do breakpoint móvel (`useLayoutMovel`) os 180px de coluna não cabem
 * ao lado do conteúdo num telefone, e o trilho vira BARRA HORIZONTAL rolável
 * acima dele: as mesmas folhas, na mesma ordem, com os cabeçalhos de grupo
 * inline, `aria-orientation="horizontal"` e as setas esquerda/direita. A aba
 * ativa é trazida para dentro da faixa visível ao montar e ao trocar.
 *
 * AT-330 (achado N8): trazer "ao montar" não bastava — os contadores chegam
 * DEPOIS (a consulta de cada fila) e as fontes também, e cada um alarga as
 * abas anteriores e empurra a ativa de volta para fora ("Config…" cortado).
 * A aba ativa é trazida de novo quando o CONTEÚDO do trilho muda e quando as
 * fontes terminam de carregar. E a faixa DIZ que rola: as bordas com conteúdo
 * escondido esmaecem (`data-rola-inicio`/`data-rola-fim`), porque uma barra
 * cortada rente à margem parecia terminar ali.
 */
export function ProjectRail({ itens, active, onChange }: ProjectRailProps) {
  const { t } = useTranslation('nav');
  const refs = useRef(new Map<string, HTMLAnchorElement | null>());
  const navRef = useRef<HTMLElement>(null);
  const horizontal = useLayoutMovel();
  const teclas = horizontal ? TECLAS_HORIZONTAL : TECLAS_VERTICAL;
  const avancar = horizontal ? 'ArrowRight' : 'ArrowDown';

  // A ordem VISUAL achatada — grupo por grupo, aba solta por aba solta. É
  // sobre ela que a seta anda: quem navega por teclado atravessa a fronteira
  // de grupo como atravessa qualquer outro item, porque no trilho não há
  // "linha de fora" e "linha de dentro" para separar.
  const folhas = useMemo<FolhaDoTrilho[]>(
    () => itens.flatMap((item) => (item.tipo === 'grupo' ? item.abas : [item.aba])),
    [itens],
  );
  // O que muda a LARGURA das abas: rótulo e contador. Chave estável para o
  // efeito abaixo — `itens` é um array novo a cada render de quem monta.
  const conteudo = folhas.map((f) => `${f.key}:${f.label}:${f.count ?? ''}`).join('|');

  // Na barra horizontal a aba ativa pode nascer fora da faixa visível (Gastos
  // e Configurações ficam no fim) — ela é rolada para dentro, e de novo quando
  // o conteúdo ou as fontes mudam a largura das anteriores (AT-330).
  // `scrollIntoView` opcional porque o jsdom não o implementa.
  useEffect(() => {
    if (!horizontal) return;
    const trazer = () =>
      refs.current.get(active)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    trazer();
    let vivo = true;
    void document.fonts?.ready?.then(() => {
      if (vivo) trazer();
    });
    return () => {
      vivo = false;
    };
  }, [horizontal, active, conteudo]);

  // Quais bordas da faixa escondem conteúdo — é o que decide o esmaecimento.
  const [bordas, setBordas] = useState({ inicio: false, fim: false });
  useEffect(() => {
    const nav = navRef.current;
    if (!horizontal || !nav) return;
    const medir = () => {
      const excede = nav.scrollWidth - nav.clientWidth > 1;
      const proximas = {
        inicio: excede && nav.scrollLeft > 1,
        fim: excede && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1,
      };
      setBordas((atuais) =>
        atuais.inicio === proximas.inicio && atuais.fim === proximas.fim ? atuais : proximas,
      );
    };
    medir();
    nav.addEventListener('scroll', medir, { passive: true });
    const observador =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    observador?.observe(nav);
    return () => {
      nav.removeEventListener('scroll', medir);
      observador?.disconnect();
    };
  }, [horizontal, conteudo]);

  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (!teclas.includes(e.key)) return;
    if (folhas.length === 0) return;

    const focado = folhas.findIndex((f) => refs.current.get(f.key) === document.activeElement);
    // Sem foco em folha nenhuma (o trilho recebeu a tecla por outro caminho),
    // a âncora é a aba ATIVA — nunca "a primeira", que faria a seta pular
    // para o topo em vez de andar um item.
    const ancora = focado === -1 ? Math.max(0, folhas.findIndex((f) => f.key === active)) : focado;

    let proximo = ancora;
    if (e.key === 'Home') proximo = 0;
    else if (e.key === 'End') proximo = folhas.length - 1;
    else proximo = (ancora + (e.key === avancar ? 1 : -1) + folhas.length) % folhas.length;

    e.preventDefault();
    const alvo = folhas[proximo];
    if (!alvo) return;
    refs.current.get(alvo.key)?.focus();
    onChange(alvo.key);
  }

  function folha(item: FolhaDoTrilho) {
    const ativo = item.key === active;
    return (
      // AT-394: cada aba tem ENDEREÇO (`?tab=<chave>`) — link de verdade, que
      // abre em outra aba com o botão do meio/Ctrl. O clique simples continua
      // trocando no lugar, e o contrato de teclado (ADR 0126) não muda: o
      // `role="tab"` e as setas são os mesmos de quando era `<button>`.
      <a
        key={item.key}
        ref={(el) => {
          refs.current.set(item.key, el);
        }}
        href={`?tab=${encodeURIComponent(item.key)}`}
        role="tab"
        aria-selected={ativo}
        className={[styles.item, ativo && styles.itemAtivo].filter(Boolean).join(' ')}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onChange(item.key);
        }}
      >
        <span className={styles.itemLabel}>{item.label}</span>
        {item.count !== undefined && <span className={styles.contador}>{item.count}</span>}
      </a>
    );
  }

  return (
    // `role="presentation"` nos invólucros: um `tablist` só POSSUI elementos
    // `tab`, e é o que mantém os 12 botões filhos diretos da lista para a
    // tecnologia assistiva mesmo agrupados visualmente. O cabeçalho do grupo
    // continua sendo texto lido — ele diz de que grupo a próxima leva de abas
    // é —, só não é alvo de seleção.
    <nav
      ref={navRef}
      className={[styles.trilho, horizontal && styles.trilhoHorizontal].filter(Boolean).join(' ')}
      data-rola-inicio={horizontal && bordas.inicio ? '' : undefined}
      data-rola-fim={horizontal && bordas.fim ? '' : undefined}
      role="tablist"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
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
