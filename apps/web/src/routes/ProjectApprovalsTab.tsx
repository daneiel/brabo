import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { approveAction, approveAlwaysAction, denyAction, getProjectPermissions, setProjectPermissions } from '../lib/api-client';
import { useBacklog, useInfraArtifacts, useLatestSession, usePendingActions, useSessionEvents } from '../lib/hooks';
import type {
  CoverageMatrixRow,
  PermissionListName,
  QaVerdictPayload,
  SecOpsVerdictPayload,
  Task,
} from '../lib/api-types';
import { ApprovalCard } from '../components/ApprovalCard';
import { PrGateTimeline, type GateVerdict } from '../components/PrGateTimeline';
import { getRegistroDeGates } from '../lib/api-client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { AlertCircleIcon, CheckIcon, SearchIcon, TrashIcon } from '../components/ui/icons';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { AGENTS, AREAS } from '../lib/agents';
import type { DelegationEventPayload } from '../lib/api-types';
import styles from './ProjectApprovalsTab.module.css';

/** O mínimo de uma query do TanStack que o bloco abaixo consome. */
interface EstadoDaQuery<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

/**
 * Os três estados da RN-088 em UMA peça, com o ERRO antes do vazio.
 *
 * Cada bloco desta aba tem query própria, e todos colapsavam os três: `data ??
 * []` seguido de `length === 0` fazia a api respondendo 429 dizer "Tudo limpo —
 * nenhuma aprovação pendente", que é a mentira mais cara que esta tela
 * específica pode contar.
 *
 * Só carregando e erro moram aqui. O VAZIO fica com quem chama, porque a frase
 * do vazio é diferente em cada bloco e é ela que explica de onde o dado viria.
 */
function BlocoDeDados<T>({
  query,
  titulo,
  carregando = 'Carregando…',
  children,
}: {
  query: EstadoDaQuery<T>;
  titulo: string;
  carregando?: string;
  children: (dado: T) => ReactNode;
}) {
  if (query.isError) {
    return (
      <ErroDeCarregamento
        titulo={titulo}
        erro={query.error}
        onTentarDeNovo={() => void query.refetch()}
      />
    );
  }
  if (query.data === undefined) {
    return <div className={styles.clean}>{carregando}</div>;
  }
  return <>{children(query.data)}</>;
}

interface PermissionRow {
  pattern: string;
  list: PermissionListName;
}

interface ProjectApprovalsTabProps {
  projectId: string;
}

export function ProjectApprovalsTab({ projectId }: ProjectApprovalsTabProps) {
  const sessionsQuery = useLatestSession(projectId);
  const latestSession = sessionsQuery.latest;
  const actionsQuery = usePendingActions(projectId, latestSession?.id);
  const eventsQuery = useSessionEvents(projectId, latestSession?.id);
  const backlogQuery = useBacklog(projectId);
  const infraQuery = useInfraArtifacts(projectId);
  const epics = backlogQuery.data;
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const allActions = actionsQuery.data?.items ?? [];
  const events = eventsQuery.data?.items ?? [];

  // Tasks que já entraram no fluxo de gate (Fase 4a) — bloqueadas ou com
  // gateStatus setado (mesmo já tendo chegado a awaiting_user).
  const gateTasks: Task[] = (epics ?? []).flatMap((epic) =>
    epic.stories.flatMap((story) =>
      story.tasks.filter((t) => t.gateStatus !== null || t.blocked),
    ),
  );

  function prActionFor(taskId: string) {
    return allActions
      .filter(
        (a) =>
          a.actionType === 'pr_open' &&
          (a.payload as { storyTaskId?: string }).storyTaskId === taskId,
      )
      .sort((a, b) => b.seq - a.seq)[0];
  }

  // Rótulo pro sub-parecer/dispensa dentro do card expandido — nome
  // reconhecido (AGENTS) quando o subagente é um dos conhecidos, senão o
  // id cru (mesma degradação graciosa do resto da UI pra agente
  // desconhecido).
  function labelFor(agentId: string): string {
    return AGENTS[agentId as keyof typeof AGENTS]?.name ?? agentId;
  }

  // Pareceres INTERNOS dos subagentes de QA (Fase 8b/8d) — mesmo `taskId`
  // do parecer consolidado, mas `actor.id` é a subespecialidade
  // (`qa-automacao`/`qa-performance-seguranca`), nunca `qa`. Ver `AREAS.qa.
  // members`.
  function subVerdictsFor(taskId: string): NonNullable<GateVerdict['subVerdicts']> {
    const membros: string[] = AREAS.qa.members;
    return events
      .filter((e) => e.type === 'artifact.qa_verdict' && membros.includes(e.actor.id))
      .filter((e) => (e.payload as { taskId?: string }).taskId === taskId)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        const payload = e.payload as QaVerdictPayload;
        return {
          agentId: e.actor.id,
          label: labelFor(e.actor.id),
          veredito: payload.veredito,
          resumo: payload.resumo,
          itens: payload.itens,
        };
      });
  }

  // Delegações DISPENSADAS da área de QA pra esta task (Fase 8b) — a
  // subespecialidade de Performance/Segurança quando a story não tem RNF
  // pertinente, sempre com justificativa (nunca silêncio).
  function dispensedFor(taskId: string): NonNullable<GateVerdict['dispensed']> {
    return events
      .filter((e) => e.type === 'delegation.dispensed')
      .filter((e) => {
        const payload = e.payload as DelegationEventPayload;
        return payload.area === 'qa' && payload.taskId === taskId;
      })
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        const payload = e.payload as DelegationEventPayload;
        return {
          agentId: payload.subagent,
          label: labelFor(payload.subagent),
          justification: payload.justification ?? '',
        };
      });
  }

  // O card PRINCIPAL da timeline é só o parecer CONSOLIDADO — `actor.id ===
  // 'qa'`/`'secops'`. Antes do 8d isto filtrava só por tipo+taskId, e o
  // parecer INTERNO de cada subespecialidade (mesmo taskId, actor.id
  // diferente) vazava como um card "QA" a mais, indistinguível do
  // consolidado, numa story com RNF de performance (Fase 8b). Os internos
  // agora só aparecem dentro do expand (`subVerdictsFor`/`dispensedFor`).
  function verdictsFor(taskId: string): GateVerdict[] {
    return events
      .filter(
        (e) =>
          (e.type === 'artifact.qa_verdict' && e.actor.id === 'qa') ||
          (e.type === 'artifact.secops_verdict' && e.actor.id === 'secops'),
      )
      .filter((e) => {
        const payload = e.payload as { taskId?: string };
        return payload.taskId === taskId;
      })
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        if (e.type === 'artifact.qa_verdict') {
          const payload = e.payload as QaVerdictPayload;
          return {
            seq: e.seq,
            gate: 'qa' as const,
            veredito: payload.veredito,
            resumo: payload.resumo,
            itens: payload.itens,
            coverageMatrix: payload.coverageMatrix as CoverageMatrixRow[] | undefined,
            subVerdicts: subVerdictsFor(taskId),
            dispensed: dispensedFor(taskId),
          };
        }
        const payload = e.payload as SecOpsVerdictPayload;
        return {
          seq: e.seq,
          gate: 'secops' as const,
          veredito: payload.veredito,
          resumo: payload.resumo,
          itens: payload.itens,
        };
      });
  }

  // PRs de infra (Fase 4a — InfraAgent), mesmo espírito de prActionFor/
  // verdictsFor mas chaveado por `prActionId` direto (o artefato de infra
  // já guarda o id da proposed_action, sem busca por payload).
  function infraPrActionFor(prActionId: string) {
    return allActions.find((a) => a.id === prActionId);
  }

  function infraVerdictsFor(prActionId: string): GateVerdict[] {
    return events
      .filter((e) => e.type === 'artifact.qa_verdict' || e.type === 'artifact.secops_verdict')
      .filter((e) => (e.payload as { prActionId?: string }).prActionId === prActionId)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        if (e.type === 'artifact.qa_verdict') {
          const payload = e.payload as QaVerdictPayload;
          return {
            seq: e.seq,
            gate: 'qa' as const,
            veredito: payload.veredito,
            resumo: payload.resumo,
            itens: payload.itens,
          };
        }
        const payload = e.payload as SecOpsVerdictPayload;
        return {
          seq: e.seq,
          gate: 'secops' as const,
          veredito: payload.veredito,
          resumo: payload.resumo,
          itens: payload.itens,
        };
      });
  }

  const permissionsQuery = useQuery({
    queryKey: ['permissions', projectId],
    queryFn: () => getProjectPermissions(projectId),
  });

  // O registro de gates (ADR 0054) — FASE 15b. SEM `projectId` na chave: o
  // registro é fato do produto, e cachear por projeto criaria N cópias do
  // mesmo. `staleTime` alto pelo mesmo motivo: ele muda quando o produto
  // muda, não durante a sessão de alguém.
  const gatesQuery = useQuery({
    queryKey: ['registro-de-gates'],
    queryFn: getRegistroDeGates,
    staleTime: 60 * 60 * 1000,
  });

  const pending = (actionsQuery.data?.items ?? []).filter((a) => a.status === 'pending');

  function invalidateActions() {
    queryClient.invalidateQueries({ queryKey: ['session-actions', projectId, latestSession?.id] });
  }

  async function handleApprove(actionId: string) {
    if (!latestSession) return;
    await approveAction(projectId, latestSession.id, actionId);
    invalidateActions();
  }
  async function handleDeny(actionId: string) {
    if (!latestSession) return;
    await denyAction(projectId, latestSession.id, actionId);
    invalidateActions();
  }
  async function handleAlwaysAllow(actionId: string) {
    if (!latestSession) return;
    await approveAlwaysAction(projectId, latestSession.id, actionId);
    invalidateActions();
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approveSelected() {
    if (!latestSession) return;
    await Promise.all(Array.from(selected).map((id) => approveAction(projectId, latestSession.id, id)));
    setSelected(new Set());
    invalidateActions();
  }

  async function revokeRule(row: PermissionRow) {
    if (!permissionsQuery.data) return;
    const updated = {
      ...permissionsQuery.data,
      [row.list]: permissionsQuery.data[row.list].filter((p) => p !== row.pattern),
    };
    await setProjectPermissions(projectId, updated);
    queryClient.invalidateQueries({ queryKey: ['permissions', projectId] });
  }

  const rows: PermissionRow[] = permissionsQuery.data
    ? (['allow', 'deny', 'ask'] as PermissionListName[]).flatMap((list) =>
        permissionsQuery.data![list].map((pattern) => ({ pattern, list })),
      )
    : [];
  const filteredRows = rows.filter((r) => r.pattern.toLowerCase().includes(search.toLowerCase()) || r.list.includes(search.toLowerCase()));

  const columns: TableColumn<PermissionRow>[] = [
    { key: 'pattern', label: 'Padrão', width: '2.4fr', render: (r) => <span className={styles.pattern}>{r.pattern}</span> },
    {
      key: 'type',
      label: 'Tipo',
      width: '0.9fr',
      render: (r) => (
        <Badge square tone={r.list === 'deny' ? 'danger' : r.list === 'allow' ? 'success' : 'warning'}>
          {r.list}
        </Badge>
      ),
    },
    {
      key: 'action',
      label: 'Ação',
      width: '64px',
      // Botão QUADRADO só de ícone, como no desenho — o rótulo "revogar" ao
      // lado do ícone comia a largura de uma coluna inteira. O nome acessível
      // carrega o padrão porque "Revogar" sozinho, repetido por linha, não diz
      // revogar o quê.
      render: (r) => (
        <button
          type="button"
          className={styles.revoke}
          title="Revogar"
          aria-label={`Revogar ${r.pattern}`}
          onClick={() => revokeRule(r)}
        >
          <TrashIcon size={14} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>Pendentes</h2>
          <span className={styles.eyebrow}>ordenadas por urgência</span>
          <span className={styles.espacador} />
          {selected.size > 0 && (
            <div className={styles.selectionBar}>
              <span className={styles.selectionCount}>{selected.size} selecionadas</span>
              <Button variant="success" onClick={approveSelected}>
                <CheckIcon size={15} />
                Aprovar selecionados
              </Button>
              <Button variant="secondary" onClick={() => setSelected(new Set())}>
                Limpar
              </Button>
            </div>
          )}
        </div>

        <BlocoDeDados
          query={sessionsQuery}
          titulo="Não foi possível abrir as sessões do projeto."
          carregando="Procurando a sessão do projeto…"
        >
          {() =>
            !latestSession ? (
              <div className={styles.clean}>
                Nenhuma sessão ainda — as aprovações nascem do que os agentes propõem numa sessão.
              </div>
            ) : (
              <BlocoDeDados
                query={actionsQuery}
                titulo="Não foi possível carregar a fila de aprovações."
                carregando="Carregando a fila…"
              >
                {() =>
                  pending.length === 0 ? (
                    <div className={styles.vazioCard}>
                      <span className={styles.vazioIcone}>
                        <CheckIcon size={24} />
                      </span>
                      <p className={styles.vazioTexto}>
                        Nenhuma aprovação pendente. O time está fluindo.
                      </p>
                    </div>
                  ) : (
                    <div className={styles.queue}>
                      {pending.map((action) => (
                        <ApprovalCard
                          key={action.id}
                          action={action}
                          variant="queue"
                          selectable
                          selected={selected.has(action.id)}
                          onToggleSelect={() => toggleSelect(action.id)}
                          onApprove={() => handleApprove(action.id)}
                          onDeny={() => handleDeny(action.id)}
                          onAlwaysAllow={() => handleAlwaysAllow(action.id)}
                        />
                      ))}
                    </div>
                  )
                }
              </BlocoDeDados>
            )
          }
        </BlocoDeDados>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>PRs em revisão</h2>
          <span className={styles.eyebrow}>
            {gateTasks.length} de dev agents nos gates de QA/SecOps
          </span>
        </div>

        <BlocoDeDados
          query={backlogQuery}
          titulo="Não foi possível carregar o backlog."
          carregando="Carregando as PRs em revisão…"
        >
          {() =>
            gateTasks.length === 0 ? (
              <div className={styles.clean}>Nenhuma PR de dev agent em revisão ainda.</div>
            ) : (
              <div className={styles.queue}>
                {gateTasks.map((task) => (
                  <PrGateTimeline
                    key={task.id}
                    task={task}
                    prAction={prActionFor(task.id)}
                    verdicts={verdictsFor(task.id)}
                    registro={gatesQuery.data}
                  />
                ))}
              </div>
            )
          }
        </BlocoDeDados>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>PRs de infra em revisão</h2>
          <span className={styles.eyebrow}>
            {(infraQuery.data ?? []).length} de infra nos gates de QA/SecOps
          </span>
        </div>

        <BlocoDeDados
          query={infraQuery}
          titulo="Não foi possível carregar as PRs de infra."
          carregando="Carregando as PRs de infra…"
        >
          {(infraArtifacts) =>
            infraArtifacts.length === 0 ? (
              <div className={styles.clean}>Nenhuma PR de infra em revisão ainda.</div>
            ) : (
              <div className={styles.queue}>
                {infraArtifacts.map((artifact) => (
                  <PrGateTimeline
                    key={artifact.id}
                    task={artifact}
                    prAction={infraPrActionFor(artifact.prActionId)}
                    verdicts={infraVerdictsFor(artifact.prActionId)}
                  />
                ))}
              </div>
            )
          }
        </BlocoDeDados>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.title}>Permissões do projeto</h2>
          <span className={styles.eyebrow}>.brabo/permissions.json</span>
        </div>
        <p className={styles.subtitle}>
          Regras aplicadas antes de cada ação dos agentes. Revogue por linha.
        </p>
        <div className={styles.banner}>
          <AlertCircleIcon size={15} className={styles.bannerIcone} />
          <span>
            Ordem de avaliação: <b className={styles.deny}>deny</b> sempre vence{' '}
            <b className={styles.allow}>allow</b>, independente da ordem no arquivo.
          </span>
        </div>
        <div className={styles.searchRow}>
          <Input
            mono
            placeholder="Buscar regra ou padrão…"
            icon={<SearchIcon size={15} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <BlocoDeDados
          query={permissionsQuery}
          titulo="Não foi possível carregar as permissões do projeto."
          carregando="Lendo o permissions.json…"
        >
          {() => (
            <Table
              columns={columns}
              rows={filteredRows}
              rowKey={(r) => `${r.list}:${r.pattern}`}
              emptyMessage={
                rows.length === 0
                  ? 'Nenhuma regra configurada ainda.'
                  : 'Nenhuma regra corresponde à busca.'
              }
            />
          )}
        </BlocoDeDados>
      </div>
    </div>
  );
}
