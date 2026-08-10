import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRepository } from '../../lib/api-client';
import {
  useArchitecture,
  useHandoffs,
  useLatestSession,
  usePendingActions,
  useSessionEvents,
} from '../../lib/hooks';
import { deriveAgentRoster } from '../../lib/agent-status';
import { BranchIcon, FolderIcon, SearchIcon } from '../../components/ui/icons';
import { CodeExplorer } from './CodeExplorer';
import { CodeSearchPanel } from './CodeSearchPanel';
import { CodeEditor } from './CodeEditor';
import { CodeBottomPanel } from './CodeBottomPanel';
import styles from './CodeShell.module.css';

type RailView = 'explorer' | 'search';

/** Itens do rail SEM dado real por trás — desabilitados, e o tooltip diz por quê. */
const RAIL_DESABILITADO: { rotulo: string; motivo: string }[] = [
  {
    rotulo: 'Controle de versão',
    motivo:
      'A FASE 26b entregou a fundação (GET /projects/:id/code/branches, ' +
      'ahead/behind e PR associada por branch — ver getCodeBranches em ' +
      'api-client.ts), mas nenhuma tela ainda consome. Não há rota de ' +
      'status de working tree; o painel segue desabilitado até a UI vir.',
  },
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
 * O shell da aba Code: rail, explorador/busca, editor e painel inferior — só
 * depois que o gate de `ProjectCodeTab` já confirmou que o container tem
 * imagem decidida.
 */
export function CodeShell({ projectId }: { projectId: string }) {
  const [railView, setRailView] = useState<RailView>('explorer');
  const [ref, setRef] = useState('');
  const [refInput, setRefInput] = useState('');
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [bottomOpen, setBottomOpen] = useState(false);

  const { data: repository } = useQuery({
    queryKey: ['repository', projectId],
    queryFn: () => getRepository(projectId),
  });
  const refEfetiva = ref || repository?.defaultBranch || '';

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
        <input
          className={styles.refInput}
          value={refInput}
          placeholder={refEfetiva || 'branch, tag ou sha'}
          onChange={(e) => setRefInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setRef(refInput.trim());
          }}
          aria-label="Ref a navegar (branch, tag ou sha)"
        />
        <button
          type="button"
          className={styles.refBotao}
          onClick={() => setRef(refInput.trim())}
        >
          Ir
        </button>
        {/* Sem dropdown rico de branches (ahead/behind, badge de PR) AINDA:
            a rota já existe (getCodeBranches, FASE 26b) mas esta tela não a
            consome — trocar o campo de texto por um seletor rico é da onda
            seguinte, e fingir aqui seria pior que um campo simples. */}
        <span className={styles.topoBranch}>
          <BranchIcon size={13} />
          {refEfetiva || 'sem branch padrão'}
        </span>
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

          <div className={styles.bottomToggleRow}>
            <button
              type="button"
              className={styles.bottomToggle}
              onClick={() => setBottomOpen((v) => !v)}
              aria-expanded={bottomOpen}
            >
              {bottomOpen ? 'Fechar painel inferior' : 'Terminal / Diff de PR'}
            </button>
          </div>
          {bottomOpen && <CodeBottomPanel projectId={projectId} />}
        </div>
      </div>

      <div className={styles.statusBar}>
        <span className={styles.statusItem}>
          <BranchIcon size={12} />
          {refEfetiva || '—'}
        </span>
        <span className={styles.statusSpacer} />
        <span className={styles.statusItem}>UTF-8</span>
        <span className={styles.statusItem}>
          <span className={styles.pulso} aria-hidden="true" />
          {agentesAtivos} {agentesAtivos === 1 ? 'agente ativo' : 'agentes ativos'}
        </span>
      </div>
    </div>
  );
}
