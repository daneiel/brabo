import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Tabs, type TabItem } from './Tabs';
import styles from './GroupedTabs.module.css';

/** Uma folha da régua — grupo ou solta, já com o `count` RESOLVIDO (número,
 * não função). Quem resolve contra `ContagensDeAba` é quem monta os
 * `itens`, o mesmo contrato que `Tabs` já tem com `TabItem`. */
export type FolhaDeRegua = TabItem;

export interface GrupoDeRegua {
  tipo: 'grupo';
  chave: string;
  label: string;
  abas: FolhaDeRegua[];
}

export interface AbaSoltaDeRegua {
  tipo: 'aba';
  aba: FolhaDeRegua;
}

export type ItemDeRegua = GrupoDeRegua | AbaSoltaDeRegua;

interface GroupedTabsProps {
  itens: ItemDeRegua[];
  /** A folha selecionada agora — sempre a chave de uma aba de verdade, nunca a de um grupo. */
  active: string;
  onChange: (key: string) => void;
  trailing?: ReactNode;
}

/** Zero pendência não é informação, é ruído — mesma regra do `count` por aba. */
function somarContagens(abas: readonly FolhaDeRegua[]): number | undefined {
  const total = abas.reduce((soma, aba) => soma + (aba.count ?? 0), 0);
  return total > 0 ? total : undefined;
}

/**
 * Navegação por seta dentro de UMA linha (`Home`/`End`/`ArrowLeft`/
 * `ArrowRight`), sem tocar `Tabs.tsx`.
 *
 * `Tabs` não expõe refs nem `data-*` por botão, então a correlação é
 * POSICIONAL: o índice do botão focado dentro do container corresponde ao
 * índice do mesmo item em `itensDaLinha`, porque `Tabs` renderiza
 * `items.map(...)` sem filtrar nem reordenar nada — é essa garantia que
 * permite ler `[role="tab"]` do DOM em vez de duplicar a lista de botões
 * aqui.
 */
function onKeyDownDaLinha(
  e: KeyboardEvent<HTMLDivElement>,
  itensDaLinha: readonly FolhaDeRegua[],
  onSelecionar: (chave: string) => void,
) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  const botoes = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  if (botoes.length === 0) return;

  const atual = botoes.findIndex((b) => b === document.activeElement);
  const base = atual === -1 ? 0 : atual;
  let proximo = base;
  if (e.key === 'Home') proximo = 0;
  else if (e.key === 'End') proximo = botoes.length - 1;
  else proximo = (base + (e.key === 'ArrowRight' ? 1 : -1) + botoes.length) % botoes.length;

  e.preventDefault();
  botoes[proximo]?.focus();
  const alvo = itensDaLinha[proximo];
  if (alvo) onSelecionar(alvo.key);
}

/**
 * Régua de DOIS níveis, por cima de `Tabs.tsx` (composição — o genérico
 * continua flat, sem grupo, e outras telas seguem usando ele como está).
 *
 * A linha de topo mistura grupos e abas soltas, ordenados como
 * `GRUPOS_DO_PROJETO` (`project-tabs.ts`) já entrega. Clicar num GRUPO
 * revela a segunda linha com as abas-filhas e seleciona uma delas — a
 * última visitada NESTE grupo (estado local, `ultimaFilhaPorGrupo`), ou a
 * primeira se nenhuma foi visitada ainda. Clicar numa aba SOLTA ou numa
 * FILHA de dentro do grupo aberto chama `onChange` direto.
 *
 * O grupo "aberto" não é estado à parte: é sempre o que CONTÉM `active` —
 * é isso que faz um deep-link (`?tab=` de uma aba dentro de um grupo)
 * abrir a régua já com o grupo certo expandido, sem plumbing extra: quem
 * escolhe `active` inicial é `ProjectPage`, e este componente só reage.
 */
export function GroupedTabs({ itens, active, onChange, trailing }: GroupedTabsProps) {
  const [ultimaFilhaPorGrupo, setUltimaFilhaPorGrupo] = useState<Record<string, string>>({});

  const grupoAtivo = itens.find(
    (item): item is GrupoDeRegua =>
      item.tipo === 'grupo' && item.abas.some((aba) => aba.key === active),
  );

  // Lembra a filha ativa por grupo — só dispara quando `active` de fato
  // pertence a um grupo; navegar para uma aba SOLTA não apaga a memória do
  // último grupo visitado.
  useEffect(() => {
    if (!grupoAtivo) return;
    setUltimaFilhaPorGrupo((atual) =>
      atual[grupoAtivo.chave] === active
        ? atual
        : { ...atual, [grupoAtivo.chave]: active },
    );
  }, [grupoAtivo, active]);

  const itensDoTopo: FolhaDeRegua[] = itens.map((item) =>
    item.tipo === 'grupo'
      ? { key: item.chave, label: item.label, count: somarContagens(item.abas) }
      : item.aba,
  );

  const chaveSelecionadaNoTopo = grupoAtivo ? grupoAtivo.chave : active;

  function selecionarNoTopo(chave: string) {
    const item = itens.find((i) =>
      i.tipo === 'grupo' ? i.chave === chave : i.aba.key === chave,
    );
    if (item?.tipo === 'grupo') {
      const lembrada = ultimaFilhaPorGrupo[item.chave];
      const alvo = item.abas.find((aba) => aba.key === lembrada)?.key ?? item.abas[0]?.key;
      if (alvo) onChange(alvo);
      return;
    }
    onChange(chave);
  }

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.linhaTopo}
        onKeyDown={(e) => onKeyDownDaLinha(e, itensDoTopo, selecionarNoTopo)}
      >
        <Tabs
          items={itensDoTopo}
          active={chaveSelecionadaNoTopo}
          onChange={selecionarNoTopo}
          trailing={trailing}
        />
      </div>
      {grupoAtivo && (
        <div
          className={styles.linhaFilhos}
          onKeyDown={(e) => onKeyDownDaLinha(e, grupoAtivo.abas, onChange)}
        >
          <Tabs items={grupoAtivo.abas} active={active} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
