import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCodeBranches, getRepository } from '../../lib/api-client';
import {
  useArchitecture,
  useHandoffs,
  useLatestSession,
  usePendingActions,
  useSessionEvents,
} from '../../lib/hooks';
import { deriveAgentRoster } from '../../lib/agent-status';
import { BranchIcon, FolderIcon, SearchIcon } from '../../components/ui/icons';
import { Disclosure } from '../../components/ui/Disclosure';
import { CodeExplorer } from './CodeExplorer';
import { CodeSearchPanel } from './CodeSearchPanel';
import { CodeEditor } from './CodeEditor';
import { CodeBottomPanel } from './CodeBottomPanel';
import { CodeBranchPicker } from './CodeBranchPicker';
import { linguagemPorCaminho } from './highlight';
import styles from './CodeShell.module.css';

type RailView = 'explorer' | 'search';

/** Itens do rail SEM dado real por trás — desabilitados, e o tooltip diz por quê. */
const RAIL_DESABILITADO: { rotulo: string; motivo: string }[] = [
  {
    rotulo: 'Agentes',
    motivo:
      'O rail é sobre CÓDIGO; quem está trabalhando já aparece na Visão geral. ' +
      'Duplicar aqui sem dado próprio seria um segundo lugar para o mesmo fato divergir.',
  },
  {
    rotulo: 'Testes',
    motivo: 'Não há integração de lint/testes na aba Code — pendência declarada da FASE 26.',
  },
];

/**
 * O shell da aba Code: rail, explorador/busca, editor, painel inferior e a
 * status bar de 24px do handoff — só depois que o gate de `ProjectCodeTab`
 * já confirmou que o container tem imagem decidida. A status bar só mostra o
 * que é dado REAL: branch + `↑N ↓M` (`getCodeBranches`, mesma queryKey do
 * `CodeBranchPicker`), linguagem do arquivo ativo (extensão, via
 * `linguagemPorCaminho`), UTF-8 fixo (única codificação que a leitura de
 * código serve hoje) e agentes ativos. Posição do cursor e contagem de
 * erros/testes do mock do handoff ficaram DE FORA — `CodeEditor` não tem
 * seleção rastreável e não há lint/teste integrado (mesma decisão da aba
 * Problemas em `CodeBottomPanel.tsx`).
 */
export function CodeShell({ projectId }: { projectId: string }) {
  const [railView, setRailView] = useState<RailView>('explorer');
  const [ref, setRef] = useState('');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [bottomOpen, setBottomOpen] = useState(false);

  const { data: repository } = useQuery({
    queryKey: ['repository', projectId],
    queryFn: () => getRepository(projectId),
  });
  const refEfetiva = ref || repository?.defaultBranch || '';

  // MESMA queryKey do `CodeBranchPicker` — dedup pelo React Query, zero
  // requisição a mais (RN-090/091). ahead/behind da ref atual, para a status
  // bar do handoff (`↑1 ↓0`); ref fora da lista de branches (tag/sha) não
  // tem entrada, e o item simplesmente não aparece.
  const branchesQuery = useQuery({
    queryKey: ['code-branches', projectId],
    queryFn: () => getCodeBranches(projectId),
  });
  const branchAtual = branchesQuery.data?.items.find((b) => b.name === refEfetiva);
  const aheadBehind = formatarAheadBehind(branchAtual?.ahead, branchAtual?.behind);

  function abrirArquivo(path: string) {
    setOpenTabs((abas) => (abas.includes(path) ? abas : [...abas, path]));
    setActivePath(path);
  }

  function fecharAba(path: string) {
    setOpenTabs((abas) => {
      const resto = abas.filter((p) => p !== path);
      if (activePath === path) {
        setActivePath(resto[resto.length - 1] ?? null);
      }
      return resto;
    });
  }

  // "N agentes ativos" na status bar (item 3 do escopo): a MESMA derivação
  // que a Visão geral usa, e não um número inventado — se `architecture` ou
  // `handoffs` ainda não chegaram, a roster nasce menor, nunca falsa.
  const { latest: latestSession } = useLatestSession(projectId);
  const sessionId = latestSession?.id;
  const eventsQuery = useSessionEvents(projectId, sessionId);
  const events = eventsQuery.data?.items ?? [];
  const { data: architecture } = useArchitecture(projectId);
  const handoffsQuery = useHandoffs(projectId, sessionId);
  const actionsQuery = usePendingActions(projectId, sessionId);
  const pendingActionAgentIds = new Set(
    (actionsQuery.data?.items ?? [])
      .filter((a) => a.status === 'pending')
      .map((a) => a.actor.id),
  );
  const executionActivated = events.some((e) => e.type === 'execution.activated');
  const roster = deriveAgentRoster(
    events,
    architecture?.moduleMap,
    executionActivated,
    handoffsQuery.data ?? [],
    pendingActionAgentIds,
  );
  const agentesAtivos = roster.filter((r) => r.status === 'trabalhando').length;

  return (
    <div className={styles.shell}>
      <div className={styles.topo}>
        <span className={styles.topoRotulo}>ref</span>
        <CodeBranchPicker projectId={projectId} currentRef={refEfetiva} onSelect={setRef} />
      </div>

      <div className={styles.corpo}>
        <div className={styles.rail} role="tablist" aria-label="Painel do explorador">
          <button
            type="button"
            role="tab"
            aria-selected={railView === 'explorer'}
            className={[styles.railItem, railView === 'explorer' && styles.railItemAtivo]
              .filter(Boolean)
              .join(' ')}
            title="Explorador"
            onClick={() => setRailView('explorer')}
          >
            <FolderIcon size={18} />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={railView === 'search'}
            className={[styles.railItem, railView === 'search' && styles.railItemAtivo]
              .filter(Boolean)
              .join(' ')}
            title="Buscar"
            onClick={() => setRailView('search')}
          >
            <SearchIcon size={18} />
          </button>
          {RAIL_DESABILITADO.map((item) => (
            <button
              key={item.rotulo}
              type="button"
              disabled
              className={styles.railItemDesabilitado}
              title={`${item.rotulo}: ${item.motivo}`}
              aria-label={`${item.rotulo} (indisponível)`}
            >
              <span className={styles.railItemDesabilitadoLetra} aria-hidden="true">
                {item.rotulo[0]}
              </span>
            </button>
          ))}
        </div>

        <div className={styles.painelLateral}>
          {railView === 'explorer' ? (
            <CodeExplorer
              projectId={projectId}
              gitRef={refEfetiva}
              activePath={activePath}
              onOpenFile={abrirArquivo}
            />
          ) : (
            <CodeSearchPanel
              projectId={projectId}
              gitRef={refEfetiva}
              onOpenFile={abrirArquivo}
            />
          )}
        </div>

        <div className={styles.editorArea}>
          <CodeEditor
            projectId={projectId}
            gitRef={refEfetiva}
            openTabs={openTabs}
            activePath={activePath}
            onSelectTab={setActivePath}
            onCloseTab={fecharAba}
          />

          {/* Migrado para o `Disclosure` do design system (Onda 4/frente H4)
              — o texto do botão continua trocando de verbo ("Painel
              inferior" ↔ "Fechar painel inferior", é o que os testes já
              fixam), só ganhou `aria-controls`/região nomeada que faltavam
              antes. `className={styles.bottomToggleRow}` no wrapper mantém
              a borda/fundo da faixa no MESMO lugar — `CodeBottomPanel` já
              tem fundo próprio idêntico, então cobrir o corpo inteiro não
              muda nada visível. */}
          <Disclosure
            aberto={bottomOpen}
            onAlternar={() => setBottomOpen((v) => !v)}
            className={styles.bottomToggleRow}
            classNameCabecalho={styles.bottomToggle}
            titulo={bottomOpen ? 'Fechar painel inferior' : 'Painel inferior'}
          >
            <CodeBottomPanel projectId={projectId} />
          </Disclosure>
        </div>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.statusItem}>
          <BranchIcon size={12} />
          {refEfetiva || '—'}
          {aheadBehind && <span className={styles.statusAheadBehind}>{aheadBehind}</span>}
        </span>
        <span className={styles.statusSpacer} />
        {activePath && linguagemPorCaminho(activePath) && (
          <span className={styles.statusItem}>{linguagemPorCaminho(activePath)}</span>
        )}
        <span className={styles.statusItem}>UTF-8</span>
        <span className={styles.statusItem}>
          <span className={styles.pulso} aria-hidden="true" />
          {agentesAtivos} {agentesAtivos === 1 ? 'agente ativo' : 'agentes ativos'}
        </span>
      </div>
    </div>
  );
}

/**
 * `↑N ↓M` de commits (item 26b/RN-112, `CodeBranchDetail.ahead/behind`) —
 * `null` é "não computável" e ZERO em ambos não vira texto (nada a dizer).
 * Posição do cursor do handoff NÃO entra: `CodeEditor` renderiza `<pre>`
 * estático, sem seleção/caret rastreável — inventar uma posição seria o
 * mesmo erro que a contagem de testes/lint da aba Problemas.
 */
function formatarAheadBehind(ahead: number | null | undefined, behind: number | null | undefined) {
  if (ahead == null && behind == null) return null;
  const a = ahead ?? 0;
  const b = behind ?? 0;
  if (a === 0 && b === 0) return null;
  const partes: string[] = [];
  if (a > 0) partes.push(`↑${a}`);
  if (b > 0) partes.push(`↓${b}`);
  return partes.join(' ');
}
