import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { emailDaSessao, sair } from '../lib/auth';
import { mensagemDaApi } from '../lib/api-client';
import {
  useActiveExecutionSession,
  useCurrentWorkspace,
  useCurrentWorkspaceWithRole,
  useProjects,
  useProjectsStatus,
  useProjectsSummary,
  useSessionEvents,
} from '../lib/hooks';
import {
  ATIVIDADE_RECENTE_JANELA_MS,
  deriveProjectStatus,
  PROJECT_STATUS_COLOR,
  PROJECT_STATUS_LABEL,
} from '../lib/project-status';
import { ROLE_LABEL } from '../lib/roles';
import { desempateDoProjeto, nomesRepetidos } from '../lib/project-label';
import { AGENTS } from '../lib/agents';
import { agruparPorInstancia, montarArvore, type GrupoDeAgente, type RamoDeAgente } from '../lib/timeline-tree';
import { getAgentLastSeenSeq, setAgentLastSeenSeq } from '../lib/read-state';
import { alternarTema, observarTema, temaAtual, type Tema } from '../lib/tema';
import { useTranslation } from 'react-i18next';
import {
  corDoProjeto,
  gravarAbaAtiva,
  gravarAgentesAbertos,
  gravarColapsado,
  gravarProjetoAtivo,
  gravarProjetosAbertos,
  lerAgentesAbertos,
  lerColapsado,
  lerProjetosAbertos,
} from '../lib/sidebar-state';
import type { ProjectCardSummary } from '../lib/api-types';
import { ABAS_DO_PROJETO, ABA_PADRAO, type ChaveDeAba, type ContagensDeAba } from './project-tabs';
import { Badge } from '../components/ui/Badge';
import {
  ActivityIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LogoMark,
  LogoutIcon,
  MoonIcon,
  PlusIcon,
  SunIcon,
  UserIcon,
} from '../components/ui/icons';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { NewProjectWizard } from './NewProjectWizard';
import styles from './Shell.module.css';

// Iniciais do e-mail (não há campo de nome no JWT nem endpoint de perfil —
// "nomes fictícios" é a divergência já aceita contra o mock, ver ADR do
// dashboard). "fulano.silva@..." -> "FS"; sem separador, as duas primeiras
// letras do local-part.
function iniciaisDoEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const partes = local.split(/[._-]+/).filter(Boolean);
  const letras =
    partes.length >= 2 ? [partes[0]?.[0], partes[1]?.[0]] : [local[0], local[1]];
  return letras.filter((c): c is string => !!c).join('').toUpperCase();
}

// Mesma ideia, para o nome do projeto na trilha recolhida (handoff: "um
// quadrado por projeto com as iniciais"). "core-api" -> "CA"; nome de uma
// palavra só -> as duas primeiras letras.
function iniciaisDoProjeto(nome: string): string {
  const partes = nome.split(/[\s._-]+/).filter(Boolean);
  const letras =
    partes.length >= 2 ? [partes[0]?.[0], partes[1]?.[0]] : [nome[0], nome[1]];
  return letras.filter((c): c is string => !!c).join('').toUpperCase();
}

function rotuloDoAgente(agente: string): string {
  return AGENTS[agente as keyof typeof AGENTS]?.name ?? agente;
}

function corDoAgente(agente: string): string {
  return AGENTS[agente as keyof typeof AGENTS]?.color ?? 'var(--text-muted)';
}

/**
 * Dot de status por projeto (RN-039) — SEM consulta própria: orçamento e
 * última atividade vêm da linha do projeto no resumo do workspace (RN-090), e
 * a contagem de bloqueio de `useProjectsStatus`. Todas são leituras do
 * workspace inteiro.
 *
 * Antes o dot custava duas queries POR PROJETO, e o Shell é montado em TODA
 * rota: a sidebar sozinha pollava o workspace inteiro mesmo numa tela de
 * configurações. Era metade do tráfego que estourava o rate limit.
 *
 * NÃO é a cor de IDENTIDADE do projeto que o handoff pede para a trilha
 * recolhida (`corDoProjeto`, `sidebar-state.ts`) — são dois conceitos
 * diferentes. Este dot muda com orçamento/atividade; o de identidade é
 * estável. A linha expandida mostra só este (o de status é o que dá
 * informação acionável); a trilha recolhida mostra só o de identidade (é
 * borda de um quadrado de iniciais, não cabem os dois). Divergência do
 * handoff, documentada — ver RN-197.
 */
function NavStatusDot({
  summary,
  blockedTaskCount,
}: {
  summary: ProjectCardSummary | undefined;
  blockedTaskCount: number;
}) {
  const budget = summary?.budget ?? null;
  const budgetPct =
    budget && budget.limitMicros > 0
      ? (budget.spentMicros / budget.limitMicros) * 100
      : 0;
  const hasRecentActivity = summary?.lastEvent
    ? Date.now() - new Date(summary.lastEvent.createdAt).getTime() <
      ATIVIDADE_RECENTE_JANELA_MS
    : false;
  const status = deriveProjectStatus({ budgetPct, blockedTaskCount, hasRecentActivity });

  return (
    <span
      className={styles.navDot}
      style={{ ['--dot-color' as string]: PROJECT_STATUS_COLOR[status] } as CSSProperties}
      title={PROJECT_STATUS_LABEL[status]}
    />
  );
}

/** Botão de tema do rodapé (RN-199) — funcional recolhido ou expandido. */
function BotaoDeTema({ colapsado }: { colapsado: boolean }) {
  const { t } = useTranslation('shell');
  const [tema, setTema] = useState<Tema>(temaAtual);
  useEffect(() => observarTema(setTema), []);
  const claro = tema === 'light';
  const rotulo = claro ? t('sidebar.theme.light') : t('sidebar.theme.dark');
  return (
    <button
      type="button"
      className={styles.footerButton}
      onClick={() => setTema(alternarTema())}
      title={rotulo}
      aria-label={rotulo}
    >
      {claro ? <SunIcon size={15} /> : <MoonIcon size={15} />}
      {!colapsado && <span>{rotulo}</span>}
    </button>
  );
}

/**
 * Link para a conta do rodapé (fundação de i18n, Onda 6a) — mesmo lugar do
 * botão de tema, mesmo tratamento visual. É a única entrada da tela de
 * `/account`, onde mora a preferência de idioma.
 */
function LinkDeConta({ colapsado }: { colapsado: boolean }) {
  const { t } = useTranslation();
  const rotulo = t('sidebar.account');
  return (
    <Link to="/account" className={styles.footerButton} title={rotulo} aria-label={rotulo}>
      <UserIcon size={15} />
      {!colapsado && <span>{rotulo}</span>}
    </Link>
  );
}

/** Uma aba do projeto, dentro da linha expandida (RN-196). */
function LinhaDeAba({
  projectId,
  chave,
  rotulo,
  contagem,
}: {
  projectId: string;
  chave: ChaveDeAba;
  rotulo: string;
  contagem: number | undefined;
}) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId }}
      search={{ tab: chave }}
      className={styles.abaItem}
      onClick={() => {
        gravarProjetoAtivo(projectId);
        gravarAbaAtiva(chave);
      }}
    >
      <span className={styles.abaRotulo}>{rotulo}</span>
      {contagem !== undefined && contagem > 0 && (
        <Badge tone="accent" square>
          {contagem}
        </Badge>
      )}
    </Link>
  );
}

/** As instâncias/eventos de UM grupo de agente, dentro de Atividades (RN-198). */
function InstanciaDeAgente({
  projectId,
  ramo,
  aberta,
  onAlternar,
}: {
  projectId: string;
  ramo: RamoDeAgente;
  aberta: boolean;
  onAlternar: () => void;
}) {
  const { t } = useTranslation('shell');
  const naoVistos = aberta
    ? 0
    : ramo.marcos.filter((m) => m.seq > getAgentLastSeenSeq(projectId, ramo.agente)).length;

  useEffect(() => {
    if (aberta) setAgentLastSeenSeq(projectId, ramo.agente, ramo.ultimoSeq);
  }, [aberta, projectId, ramo.agente, ramo.ultimoSeq]);

  return (
    <div className={styles.instancia}>
      <button
        type="button"
        className={styles.instanciaCabecalho}
        aria-expanded={aberta}
        onClick={onAlternar}
      >
        <span className={styles.chevronPequeno} aria-hidden="true">
          {aberta ? <ChevronDownIcon size={11} /> : <ChevronRightIcon size={11} />}
        </span>
        <span className={styles.instanciaNome}>{ramo.agente}</span>
        <span className={[styles.contagem, naoVistos > 0 && styles.contagemNova].filter(Boolean).join(' ')}>
          {naoVistos > 0 ? `+${naoVistos}` : ramo.marcos.length}
        </span>
      </button>
      {aberta && (
        <ol className={styles.marcos}>
          {ramo.marcos.length === 0 && (
            <li className={styles.marcoVazio}>{t('sidebar.activities.noMarksYet')}</li>
          )}
          {ramo.marcos.map((m) => (
            <li key={m.eventId} className={styles.marco}>
              <span className={styles.bolinha} />
              <span className={styles.marcoRotulo}>{m.rotulo}</span>
              {m.detalhe && <span className={styles.marcoDetalhe}>{m.detalhe}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Um grupo de agente (1 ou 2 instâncias) na seção Atividades (RN-198). */
function GrupoDeAtividade({
  projectId,
  grupo,
  agentesAbertos,
  onAlternar,
}: {
  projectId: string;
  grupo: GrupoDeAgente;
  agentesAbertos: Set<string>;
  onAlternar: (chave: string) => void;
}) {
  const { t } = useTranslation('shell');
  const multiplasInstancias = grupo.instancias.length > 1;
  const abertoNoGrupo = agentesAbertos.has(grupo.agenteBase);
  const totalInteracoes = grupo.instancias.reduce((soma, r) => soma + r.marcos.length, 0);
  const totalNaoVistos = grupo.instancias.reduce((soma, r) => {
    if (agentesAbertos.has(`${grupo.agenteBase}/${r.agente}`) || (!multiplasInstancias && abertoNoGrupo)) {
      return soma;
    }
    return soma + r.marcos.filter((m) => m.seq > getAgentLastSeenSeq(projectId, r.agente)).length;
  }, 0);

  return (
    <div className={styles.grupoAgente}>
      <button
        type="button"
        className={styles.grupoCabecalho}
        aria-expanded={abertoNoGrupo}
        data-testid={`atividades-grupo-${grupo.agenteBase}`}
        onClick={() => onAlternar(grupo.agenteBase)}
        style={{ ['--msg-color' as string]: corDoAgente(grupo.agenteBase) } as CSSProperties}
      >
        <span className={styles.chevronPequeno} aria-hidden="true">
          {abertoNoGrupo ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
        <AvatarDoAgente id={grupo.agenteBase} />
        <span className={styles.grupoNome}>{rotuloDoAgente(grupo.agenteBase)}</span>
        {multiplasInstancias && (
          <Badge
            tone="muted"
            square
            title={t('sidebar.activities.instancesCount', { count: grupo.instancias.length })}
          >
            {grupo.instancias.length}×
          </Badge>
        )}
        <span
          className={[styles.contagem, totalNaoVistos > 0 && styles.contagemNova].filter(Boolean).join(' ')}
        >
          {totalNaoVistos > 0 ? `+${totalNaoVistos}` : totalInteracoes}
        </span>
      </button>

      {abertoNoGrupo && !multiplasInstancias && (
        <InstanciaDeAgente
          projectId={projectId}
          ramo={grupo.instancias[0]}
          aberta
          onAlternar={() => onAlternar(grupo.agenteBase)}
        />
      )}

      {abertoNoGrupo && multiplasInstancias && (
        <div className={styles.instancias}>
          {grupo.instancias.map((ramo) => {
            const chaveInstancia = `${grupo.agenteBase}/${ramo.agente}`;
            return (
              <InstanciaDeAgente
                key={ramo.agente}
                projectId={projectId}
                ramo={ramo}
                aberta={agentesAbertos.has(chaveInstancia)}
                onAlternar={() => onAlternar(chaveInstancia)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { t } = useTranslation('shell');
  const navigate = useNavigate();
  const { data: workspace } = useCurrentWorkspace();
  const { data: workspaceWithRole } = useCurrentWorkspaceWithRole();
  // Só a sidebar: dentro de um projeto não havia NENHUM jeito de criar outro
  // sem voltar ao dashboard primeiro. O Dashboard mantém o próprio botão —
  // dois "Novo projeto" na mesma tela (topbar + sidebar) é aceitável porque
  // moram em regiões visuais distintas, e esconder o daqui só quando
  // `pathname === '/'` trocaria uma redundância pequena por um botão que
  // muda de lugar conforme a rota.
  const [wizardOpen, setWizardOpen] = useState(false);
  const projectsQuery = useProjects(workspace?.id);
  const projects = projectsQuery.data;
  // MESMA queryKey do Dashboard: montados juntos, o React Query deduplica e o
  // resumo é buscado uma vez só (RN-090).
  const { data: cards } = useProjectsSummary(workspace?.id);
  const { data: projectsStatus } = useProjectsStatus(workspace?.id);
  const repetidos = nomesRepetidos(projects);
  const blockedByProject = new Map(
    (projectsStatus ?? []).map((p) => [p.projectId, p.blockedTaskCount]),
  );
  const cardPorProjeto = new Map((cards ?? []).map((c) => [c.projectId, c]));
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const email = emailDaSessao();

  // --- Colapso (RN-195) ---------------------------------------------------
  // Só o colapso MANUAL desde o ADR 0126 — o sinal automático da aba de
  // Código (`autoColapsado`, RN-201) saiu junto com `AutoCollapseContext`.
  const [colapsadoManual, setColapsadoManual] = useState(lerColapsado);
  const colapsado = colapsadoManual;

  function alternarColapso() {
    setColapsadoManual((atual) => {
      const proximo = !atual;
      gravarColapsado(proximo);
      return proximo;
    });
  }

  // --- Projetos expansíveis (RN-196) --------------------------------------
  const [projetosAbertos, setProjetosAbertos] = useState(lerProjetosAbertos);
  function alternarProjeto(id: string) {
    setProjetosAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      gravarProjetosAbertos(proximo);
      return proximo;
    });
  }

  const currentProject = (projects ?? []).find((p) => pathname.startsWith(`/projects/${p.id}`));
  // O projeto da rota atual sempre aparece expandido — sem isso ele nasce
  // fechado toda vez que a sidebar remonta, mesmo com você OLHANDO as abas
  // dele na tela principal. Só entra na persistência quando o CHEVRON é
  // clicado; abrir "de graça" pela rota não grava nada.
  const projetosAbertosEfetivo = useMemo(() => {
    if (!currentProject) return projetosAbertos;
    if (projetosAbertos.has(currentProject.id)) return projetosAbertos;
    return new Set(projetosAbertos).add(currentProject.id);
  }, [projetosAbertos, currentProject]);

  // --- Atividades (RN-198) — escopada ao projeto ATUAL --------------------
  // O handoff não diz se "Atividades" agrega TODOS os projetos ou só o
  // aberto; agregar todos exigiria uma consulta de eventos POR projeto — a
  // mesma classe de N+1 que a RN-090/091 fechou no dashboard. Decisão: fica
  // escopada ao projeto da rota atual, reusando o MESMO par de hooks
  // (`useActiveExecutionSession` + `useSessionEvents`) que
  // `AgentTimelineTree` já usa em `SessionPage` — mesma `queryKey`, sem
  // requisição nova quando as duas telas estão montadas juntas.
  const { session: execSession } = useActiveExecutionSession(currentProject?.id);
  const { data: eventsPage } = useSessionEvents(currentProject?.id, execSession?.id);
  const events = useMemo(() => eventsPage?.items ?? [], [eventsPage]);
  const { ramos } = useMemo(() => montarArvore(events), [events]);
  const grupos = useMemo(() => agruparPorInstancia(ramos), [ramos]);

  const [agentesAbertos, setAgentesAbertos] = useState(lerAgentesAbertos);
  function alternarAgente(chave: string) {
    setAgentesAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      gravarAgentesAbertos(proximo);
      return proximo;
    });
  }

  return (
    <div className={[styles.layout, colapsado && styles.colapsado].filter(Boolean).join(' ')}>
      <aside className={styles.sidebar}>
        {/* O monograma B no ladrilho terracota — a MESMA marca das telas de
            auth, e a única que o handoff reconhece. Até a FASE 17a aqui morava
            o `BrandIcon`, um cubo isométrico sem parentesco nenhum com ela: o
            app tinha duas marcas, e quem entrava pelo login via a segunda
            trocar pela primeira. */}
        <Link to="/" className={styles.brand} aria-label={t('sidebar.brand.dashboardLink')}>
          <span className={styles.brandTile} aria-hidden="true">
            <LogoMark size={18} />
          </span>
          {!colapsado && <span className={styles.brandName}>Brabo</span>}
        </Link>

        {colapsado ? (
          <nav className={styles.trilha} aria-label={t('sidebar.nav.trilhaAriaLabel')}>
            {(projects ?? []).map((project) => (
              <button
                key={project.id}
                type="button"
                className={styles.trilhaItem}
                style={{ ['--identidade' as string]: corDoProjeto(project.id) } as CSSProperties}
                title={project.name}
                aria-label={project.name}
                onClick={() => {
                  setColapsadoManual(false);
                  gravarColapsado(false);
                  alternarProjeto(project.id);
                  gravarProjetoAtivo(project.id);
                  void navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
                }}
              >
                {iniciaisDoProjeto(project.name)}
              </button>
            ))}
            <button
              type="button"
              className={styles.trilhaItemAtividades}
              title={t('sidebar.activities.label')}
              aria-label={t('sidebar.activities.label')}
              onClick={() => {
                setColapsadoManual(false);
                gravarColapsado(false);
              }}
            >
              <ActivityIcon size={16} />
            </button>
          </nav>
        ) : (
          <div className={styles.corpo}>
            <div className={styles.navLabelRow}>
              <span className={styles.navLabel}>{t('sidebar.nav.projectsLabel')}</span>
              <button
                type="button"
                className={styles.newProjectButton}
                onClick={() => setWizardOpen(true)}
                title={t('sidebar.nav.newProject')}
                aria-label={t('sidebar.nav.newProject')}
              >
                <PlusIcon size={16} />
              </button>
            </div>
            <nav className={styles.nav}>
              {/* A lista falhou: a sidebar DIZ, em vez de ficar vazia como se o
                  workspace não tivesse projeto nenhum (RN-088). Aqui não cabe o
                  `ErroDeCarregamento` inteiro — são 264px —, mas cabe o
                  essencial: o que houve e como tentar de novo. */}
              {projectsQuery.isError && (
                <div className={styles.navErro} role="alert">
                  <span>{mensagemDaApi(projectsQuery.error, t('sidebar.projects.loadError'))}</span>
                  <button
                    type="button"
                    className={styles.navErroBotao}
                    onClick={() => void projectsQuery.refetch()}
                  >
                    {t('sidebar.projects.retry')}
                  </button>
                </div>
              )}
              {(projects ?? []).map((project) => {
                // Aprovações pendentes do projeto INTEIRO (RN-151) — não
                // atividade não lida. Antes este badge vinha de `latestSeq -
                // seen`, que contava QUALQUER evento novo; um projeto com
                // centenas de eventos de execução mas zero decisão pendente
                // mostrava um número que não correspondia a nada acionável.
                //
                // O handoff pede "badge com o total de últimas iterações" —
                // divergência DOCUMENTADA, não resolvida: RN-151 é
                // comportamento deliberado e mais recente que o handoff (ver
                // comentário no topo do arquivo).
                const summary = cardPorProjeto.get(project.id);
                const pendingApprovalsCount = summary?.pendingApprovalsCount ?? 0;
                const aberto = projetosAbertosEfetivo.has(project.id);
                return (
                  <div key={project.id} className={styles.projetoBloco}>
                    <div
                      className={[styles.navItem, pathname.startsWith(`/projects/${project.id}`) && styles.active]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
                        type="button"
                        className={styles.chevronBotao}
                        aria-expanded={aberto}
                        aria-label={
                          aberto
                            ? t('sidebar.projects.collapse', { name: project.name })
                            : t('sidebar.projects.expand', { name: project.name })
                        }
                        onClick={() => alternarProjeto(project.id)}
                      >
                        {aberto ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
                      </button>
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.id }}
                        className={styles.navLink}
                        onClick={() => {
                          gravarProjetoAtivo(project.id);
                          gravarAbaAtiva(ABA_PADRAO);
                        }}
                      >
                        <NavStatusDot
                          summary={summary}
                          blockedTaskCount={blockedByProject.get(project.id) ?? 0}
                        />
                        <span className={styles.navText}>
                          <span className={styles.navName}>{project.name}</span>
                          {/* Só quando o nome se repete — ver `project-label.ts`. */}
                          {repetidos.has(project.name) && (
                            <span className={styles.navDesempate}>
                              {desempateDoProjeto(project)}
                            </span>
                          )}
                        </span>
                      </Link>
                      {pendingApprovalsCount > 0 && (
                        <Badge tone="accent" square>
                          {pendingApprovalsCount}
                        </Badge>
                      )}
                    </div>

                    {aberto && (
                      <div className={styles.abasDoProjeto}>
                        {ABAS_DO_PROJETO.map((aba) => {
                          // Só a contagem de Aprovações vem de graça (já está
                          // no resumo do dashboard). As outras duas
                          // (promoções/hipóteses) exigiriam uma query NOVA
                          // por projeto ABERTO na sidebar — o mesmo risco de
                          // N+1 que a Atividades evitou de propósito (ver
                          // comentário acima). Ficam de fora aqui; continuam
                          // visíveis na régua de dentro do projeto.
                          const contagens: ContagensDeAba = {
                            promocoesPendentes: 0,
                            aprovacoesPendentes: pendingApprovalsCount,
                            hipotesesPendentes: 0,
                            prsPendentes: 0,
                            arquiteturaPendente: 0,
                          };
                          return (
                            <LinhaDeAba
                              key={aba.key}
                              projectId={project.id}
                              // `aba.key` sai de `ABAS_DO_PROJETO` (tipo
                              // largo de propósito, ver project-tabs.ts) —
                              // o cast é seguro porque o valor SEMPRE veio
                              // do próprio registro que define `ChaveDeAba`.
                              chave={aba.key as ChaveDeAba}
                              rotulo={aba.label}
                              contagem={aba.count?.(contagens)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>

            <div className={styles.atividadesSecao}>
              <div className={styles.navLabelRow}>
                <span className={styles.navLabel}>{t('sidebar.activities.label')}</span>
              </div>
              {!currentProject && (
                <p className={styles.atividadesVazio}>{t('sidebar.activities.openProjectHint')}</p>
              )}
              {currentProject && grupos.length === 0 && (
                <p className={styles.atividadesVazio}>{t('sidebar.activities.empty')}</p>
              )}
              {currentProject &&
                grupos.map((grupo) => (
                  <GrupoDeAtividade
                    key={grupo.agenteBase}
                    projectId={currentProject.id}
                    grupo={grupo}
                    agentesAbertos={agentesAbertos}
                    onAlternar={alternarAgente}
                  />
                ))}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <BotaoDeTema colapsado={colapsado} />
          <LinkDeConta colapsado={colapsado} />
          <button
            type="button"
            className={styles.footerButton}
            aria-expanded={!colapsado}
            title={
              colapsado
                ? t('sidebar.collapseButton.expand')
                : t('sidebar.collapseButton.collapse')
            }
            aria-label={
              colapsado
                ? t('sidebar.collapseButton.expand')
                : t('sidebar.collapseButton.collapse')
            }
            onClick={alternarColapso}
          >
            {colapsado ? <ChevronRightIcon size={15} /> : <ChevronLeftIcon size={15} />}
            {!colapsado && <span>{t('sidebar.collapseButton.collapse')}</span>}
          </button>

          <div className={styles.userCard}>
            <span className={styles.avatar}>{email ? iniciaisDoEmail(email) : '?'}</span>
            {!colapsado && (
              <div className={styles.userInfo}>
                <span className={styles.userName}>{email ?? t('sidebar.footer.accountFallback')}</span>
                {workspaceWithRole && (
                  <span className={styles.userRole}>{ROLE_LABEL[workspaceWithRole.role]}</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className={styles.logout}
            title={t('sidebar.footer.logout')}
            aria-label={t('sidebar.footer.logout')}
            onClick={() => void sair().then(() => navigate({ to: '/login' }))}
          >
            <LogoutIcon size={14} />
            {!colapsado && <span>{t('sidebar.footer.logout')}</span>}
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>

      {wizardOpen && workspace && (
        <NewProjectWizard workspaceId={workspace.id} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}
