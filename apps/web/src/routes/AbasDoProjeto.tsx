import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GRUPOS_DO_PROJETO, type AbaDoProjeto, type ContagensDeAba } from './project-tabs';
import styles from './AbasDoProjeto.module.css';

/** Uma folha da lista — sempre uma ABA de verdade, nunca um grupo, e já com
 * o `count` RESOLVIDO (número, não função). */
export interface FolhaDaLista {
  key: string;
  label: string;
  count?: number;
}

export interface GrupoDaLista {
  tipo: 'grupo';
  chave: string;
  label: string;
  abas: FolhaDaLista[];
}

export interface AbaSoltaDaLista {
  tipo: 'aba';
  aba: FolhaDaLista;
}

export type ItemDaLista = GrupoDaLista | AbaSoltaDaLista;

/**
 * A estrutura sai de `GRUPOS_DO_PROJETO`; o `count` é resolvido contra as
 * cinco contagens. Sem `contagens` (um projeto que NÃO é o aberto), nenhuma
 * aba ganha selo — buscar as cinco filas de cada projeto da lista seria o
 * N+1 que a RN-090/091 fechou.
 */
export function itensDasAbas(contagens: ContagensDeAba | undefined): ItemDaLista[] {
  const folha = (aba: AbaDoProjeto): FolhaDaLista => ({
    key: aba.key,
    label: aba.label,
    count: contagens ? aba.count?.(contagens) : undefined,
  });
  return GRUPOS_DO_PROJETO.map((item) =>
    item.tipo === 'grupo'
      ? { tipo: 'grupo' as const, chave: item.chave, label: item.label, abas: item.abas.map(folha) }
      : { tipo: 'aba' as const, aba: folha(item.aba) },
  );
}

interface AbasDoProjetoProps {
  projectId: string;
  /** Nomeia a lista para a tecnologia assistiva — há uma por projeto aberto. */
  nomeDoProjeto: string;
  itens: ItemDaLista[];
  /** A aba selecionada agora, ou `undefined` quando este projeto não está aberto. */
  active: string | undefined;
  onChange: (key: string) => void;
}

const TECLAS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

/**
 * As abas do projeto na SIDEBAR — a única navegação do projeto desde o ADR
 * 0210, que tirou o trilho vertical (ADR 0126) e trouxe para cá tudo o que só
 * ele tinha: os três grupos abertos, a aba ativa marcada, os cinco contadores
 * (Insights, PRs, Aprovações, Backlog, Arquitetura) SEPARADOS — o cabeçalho do
 * grupo nunca soma as filhas —, e o teclado.
 *
 * ## Teclado
 *
 * `ArrowDown`/`ArrowUp`/`Home`/`End` com volta (wrap), atravessando a
 * fronteira de grupo: a mesma régua do trilho. A seta MOVE o foco e troca de
 * aba, como a seleção automática de um `tablist`.
 *
 * ## Endereço
 *
 * Cada aba é link de verdade (`/projects/<id>?tab=<chave>`, AT-394): o botão
 * do meio/Ctrl abre noutra aba do navegador; o clique simples chama
 * `onChange`, que navega no lugar.
 */
export function AbasDoProjeto({ projectId, nomeDoProjeto, itens, active, onChange }: AbasDoProjetoProps) {
  const { t } = useTranslation('shell');
  const refs = useRef(new Map<string, HTMLAnchorElement | null>());

  const folhas = useMemo<FolhaDaLista[]>(
    () => itens.flatMap((item) => (item.tipo === 'grupo' ? item.abas : [item.aba])),
    [itens],
  );

  // A ativa é trazida para dentro da área visível da sidebar — a lista de
  // projetos rola, e a aba aberta pode nascer abaixo da dobra.
  // `scrollIntoView` opcional porque o jsdom não o implementa.
  useEffect(() => {
    if (!active) return;
    refs.current.get(active)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (!TECLAS.includes(e.key) || folhas.length === 0) return;
    const focado = folhas.findIndex((f) => refs.current.get(f.key) === document.activeElement);
    const ancora =
      focado === -1 ? Math.max(0, folhas.findIndex((f) => f.key === active)) : focado;
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

  function folha(item: FolhaDaLista) {
    const ativo = item.key === active;
    return (
      <a
        key={item.key}
        ref={(el) => {
          refs.current.set(item.key, el);
        }}
        href={`/projects/${encodeURIComponent(projectId)}?tab=${encodeURIComponent(item.key)}`}
        role="tab"
        aria-selected={ativo}
        // Roving tabindex: um ponto de parada por lista no Tab, e as setas
        // andam dentro dela. Sem ativa (projeto fechado), a primeira recebe.
        tabIndex={ativo || (!active && item.key === folhas[0]?.key) ? 0 : -1}
        className={[styles.item, ativo && styles.itemAtivo].filter(Boolean).join(' ')}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          onChange(item.key);
        }}
      >
        <span className={styles.itemLabel}>{item.label}</span>
        {item.count !== undefined && item.count > 0 && (
          <span className={styles.contador}>{item.count}</span>
        )}
      </a>
    );
  }

  return (
    // `role="presentation"` nos invólucros: um `tablist` só POSSUI `tab`s, e é
    // o que mantém as 12 abas filhas diretas da lista para a tecnologia
    // assistiva mesmo agrupadas visualmente.
    <div
      className={styles.lista}
      role="tablist"
      aria-orientation="vertical"
      aria-label={t('sidebar.projects.tabsAriaLabel', { name: nomeDoProjeto })}
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
    </div>
  );
}
