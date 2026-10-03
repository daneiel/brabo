import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
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
  useLatestSession,
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
import { useLayoutMovel } from '../lib/layout-movel';
import { INTERVALO_DO_PROJETO_MS } from '../lib/canal-vivo';
import { alternarTema, observarTema, temaAtual, type Tema } from '../lib/tema';
import { pedirAba, useAbaPublicada, useContagensDoProjeto } from '../lib/contagens-do-projeto';
import { AbasDoProjeto, itensDasAbas } from './AbasDoProjeto';
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
import { ABA_PADRAO, type ContagensDeAba } from './project-tabs';
import { Badge } from '../components/ui/Badge';
import {
  ActivityIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LogoMark,
  LogoutIcon,
  MenuIcon,
  MoonIcon,
  PlusIcon,
  ServerIcon,
  SunIcon,
  UserIcon,
  XIcon,
} from '../components/ui/icons';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { Button } from '../components/ui/Button';
// O assistente de novo projeto é um chunk próprio (AT-300): ele só abre por
// clique, e trazia para o bundle inicial o navegador de pastas inteiro.
const NewProjectWizard = lazy(() =>
  import('./NewProjectWizard').then((m) => ({ default: m.NewProjectWizard })),
);
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

/** O que recebe foco dentro da gaveta móvel (RN-643) — para o foco inicial e o
 * laço do Tab. `disabled` e `tabindex="-1"` ficam de fora. */
const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

/**
 * Link para a página global de containers (ADR 0136, RN-495) — mesmo lugar e
 * mesmo tratamento de `LinkDeConta`: é GLOBAL (cross-projeto), mesmo nível
 * hierárquico de `/account`, não uma aba dentro de um projeto.
 */
function LinkDeContainers({ colapsado }: { colapsado: boolean }) {
  const { t } = useTranslation();
  const rotulo = t('sidebar.containers');
  return (
    <Link to="/containers" className={styles.footerButton} title={rotulo} aria-label={rotulo}>
      <ServerIcon size={15} />
      {!colapsado && <span>{rotulo}</span>}
    </Link>
  );
}

/** Projeto FECHADO: só Aprovações tem número, do resumo do dashboard. */
function contagensDoResumo(aprovacoesPendentes: number): ContagensDeAba {
  return {
    promocoesPendentes: 0,
    aprovacoesPendentes,
    hipotesesPendentes: 0,
    prsPendentes: 0,
    arquiteturaPendente: 0,
  };
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
  const {
    t,
    i18n: { language },
  } = useTranslation('shell');
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
  // --- Layout móvel (RN-643) ----------------------------------------------
  // Abaixo do breakpoint a sidebar vira GAVETA: some da página, abre por cima
  // do conteúdo pelo botão de menu da barra do topo e fecha ao navegar, no Esc,
  // no X e no fundo. Na gaveta ela é sempre EXPANDIDA — o colapso manual
  // (RN-195) é preferência do desktop, gravada e intocada aqui, e volta a
  // valer quando a janela cruza o corte de novo.
  const movel = useLayoutMovel();
  const colapsado = !movel && colapsadoManual;
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const idDaGaveta = useId();
  const gavetaRef = useRef<HTMLElement>(null);
  const botaoDeMenuRef = useRef<HTMLButtonElement>(null);

  function fecharGaveta({ devolverFoco }: { devolverFoco: boolean }) {
    setGavetaAberta(false);
    if (devolverFoco) botaoDeMenuRef.current?.focus();
  }

  // Fecha ao navegar — inclusive navegação que não veio de clique na gaveta
  // (o `navigate` do wizard, o botão voltar do navegador).
  useEffect(() => {
    setGavetaAberta(false);
  }, [pathname]);

  // Voltar ao desktop com a gaveta aberta não pode deixá-la "aberta" guardada
  // para a próxima vez que a janela encolher.
  useEffect(() => {
    if (!movel) setGavetaAberta(false);
  }, [movel]);

  // Aberta, o foco ENTRA na gaveta (é um diálogo modal) e o Esc a fecha
  // devolvendo o foco ao botão que a abriu — de qualquer lugar da página.
  useEffect(() => {
    if (!movel || !gavetaAberta) return;
    gavetaRef.current?.querySelector<HTMLElement>(SELETOR_FOCAVEL)?.focus();
    function aoTeclar(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setGavetaAberta(false);
      botaoDeMenuRef.current?.focus();
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [movel, gavetaAberta]);

  // Tab não escapa da gaveta aberta (`aria-modal`): do último volta ao
  // primeiro, e vice-versa.
  function prenderFoco(e: KeyboardEvent<HTMLElement>) {
    if (!movel || !gavetaAberta || e.key !== 'Tab') return;
    const focaveis = Array.from(
      gavetaRef.current?.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL) ?? [],
    );
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (!primeiro || !ultimo) return;
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }

  // Clicar num LINK da gaveta fecha — mesmo quando ele não troca o pathname
  // (as abas do projeto mudam só o `?tab=`).
  function fecharAoSeguirLink(e: MouseEvent<HTMLElement>) {
    if (!movel) return;
    if ((e.target as Element).closest('a')) setGavetaAberta(false);
  }

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
  // --- Abas do projeto (RN-196, ADR 0211) ---------------------------------
  // A sidebar é a ÚNICA navegação do projeto desde o ADR 0211: o trilho
  // vertical (ADR 0126) saiu, e tudo o que só ele tinha mora aqui. Os cinco
  // contadores do projeto ABERTO saem do MESMO hook da moldura (mesmas
  // `queryKey`s, deduplicadas — nenhuma requisição nova); os projetos
  // fechados mostram só o de Aprovações, que vem de graça no resumo do
  // dashboard (buscar as cinco filas de cada um seria o N+1 da RN-090/091).
  //
  // Só enquanto a MOLDURA do projeto está montada (ela publica a aba que
  // mostra): era só nela que o trilho existia, e é ela que já polla as cinco
  // filas. Na tela de Sessão, por exemplo, a sidebar não liga poll nenhum e
  // fica com o número do resumo, como num projeto fechado.
  const abaPublicada = useAbaPublicada();
  const { contagens: contagensDaMoldura } = useContagensDoProjeto(abaPublicada?.projectId);
  const abaAtivaDoAtual =
    currentProject && abaPublicada?.projectId === currentProject.id
      ? abaPublicada.tab
      : currentProject
        ? ABA_PADRAO
        : undefined;
  function irParaAba(projectId: string, chave: string) {
    gravarProjetoAtivo(projectId);
    gravarAbaAtiva(chave);
    setFlyoutAberto(false);
    // Pede ANTES de navegar: o clique na aba que a URL já tem (depois de um
    // salto pelo painel "precisa de você") ainda troca a moldura.
    pedirAba({ projectId, tab: chave });
    void navigate({
      to: '/projects/$projectId',
      params: { projectId },
      search: { tab: chave } as never,
    });
  }
  // Recolhida, o projeto aberto abre um FLYOUT com as mesmas abas — sem ele,
  // recolher a sidebar tiraria a navegação do projeto inteira.
  const [flyoutAberto, setFlyoutAberto] = useState(false);
  const [posicaoDoFlyout, setPosicaoDoFlyout] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (!colapsado) setFlyoutAberto(false);
  }, [colapsado]);
  useEffect(() => {
    if (!flyoutAberto) return;
    function aoTeclar(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setFlyoutAberto(false);
    }
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [flyoutAberto]);

  const projetosAbertosEfetivo = useMemo(() => {
    if (!currentProject) return projetosAbertos;
    if (projetosAbertos.has(currentProject.id)) return projetosAbertos;
    return new Set(projetosAbertos).add(currentProject.id);
  }, [projetosAbertos, currentProject]);

  // --- Atividades (RN-198) — escopada ao projeto ATUAL --------------------
  // O handoff não diz se "Atividades" agrega TODOS os projetos ou só o
  // aberto; agregar todos exigiria uma consulta de eventos POR projeto — a
  // mesma classe de N+1 que a RN-090/091 fechou no dashboard. Decisão: fica
  // escopada ao projeto da rota atual.
  //
  // QUAL sessão (RN-648, AT-325): a de EXECUÇÃO vigente quando existe — é ela
  // que tem os dev agents e as instâncias `-2` que o agrupamento da RN-198
  // existe para mostrar, com a MESMA `queryKey` da aba Executores —, e,
  // quando NÃO existe execução, a MESMA sessão da Visão geral e do card do
  // Dashboard (a mais recente de trabalho, `useLatestSession`). Antes a
  // segunda metade não existia: num projeto só com sessões de conversa a
  // sessão lida era `null`, e a sidebar dizia "nenhum agente entrou em ação"
  // ao lado de uma Visão geral com o Criativo aguardando. A lista de sessões
  // só é pedida nesse caso, e com o frescor de um ciclo de projeto: quando a
  // sidebar a habilita, a moldura do projeto já a trouxe.
  const execucao = useActiveExecutionSession(currentProject?.id);
  const semExecucao = !!currentProject && execucao.session === null;
  const sessoes = useLatestSession(
    semExecucao ? currentProject.id : undefined,
    INTERVALO_DO_PROJETO_MS,
    INTERVALO_DO_PROJETO_MS,
  );
  const sessaoDaAtividade = execucao.session ?? (semExecucao ? sessoes.latest : undefined);
  const origemDaAtividade: 'execucao' | 'recente' = execucao.session ? 'execucao' : 'recente';
  const eventosDaAtividade = useSessionEvents(currentProject?.id, sessaoDaAtividade?.id);
  const eventsPage = eventosDaAtividade.data;
  const events = useMemo(() => eventsPage?.items ?? [], [eventsPage]);
  // Os estados que antes caíam todos em "nenhum agente" (RN-470): lendo,
  // falhou, projeto sem sessão, e — só então — a sessão lida sem agente, com
  // o texto dizendo QUAL sessão foi lida.
  const estadoDaAtividade: 'carregando' | 'erro' | 'sem-sessao' | 'pronto' =
    execucao.isError || (semExecucao && sessoes.isError) || eventosDaAtividade.isError
      ? 'erro'
      : execucao.isPending || (semExecucao && sessoes.isPending)
        ? 'carregando'
        : !sessaoDaAtividade
          ? 'sem-sessao'
          : eventosDaAtividade.isPending
            ? 'carregando'
            : 'pronto';
  // `language` na dependência: os rótulos da árvore saem traduzidos de
  // `montarArvore` (AT-134), e trocar o idioma tem de refazê-los.
  const { ramos } = useMemo(() => montarArvore(events, language), [events, language]);
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
    <div
      className={[styles.layout, colapsado && styles.colapsado, movel && styles.movel]
        .filter(Boolean)
        .join(' ')}
    >
      {movel && (
        <header className={styles.barraMovel}>
          <button
            ref={botaoDeMenuRef}
            type="button"
            className={styles.botaoDeMenu}
            aria-expanded={gavetaAberta}
            aria-controls={idDaGaveta}
            aria-label={t('sidebar.mobile.openMenu')}
            onClick={() => setGavetaAberta(true)}
          >
            <MenuIcon size={20} />
          </button>
          <Link to="/" className={styles.brand} aria-label={t('sidebar.brand.dashboardLink')}>
            <span className={styles.brandTile} aria-hidden="true">
              <LogoMark size={18} />
            </span>
            <span className={styles.brandName}>Brabo</span>
          </Link>
        </header>
      )}

      {movel && gavetaAberta && (
        <div
          className={styles.fundoDaGaveta}
          data-testid="fundo-da-gaveta"
          aria-hidden="true"
          onClick={() => fecharGaveta({ devolverFoco: true })}
        />
      )}

      <aside
        id={idDaGaveta}
        ref={gavetaRef}
        className={styles.sidebar}
        hidden={movel && !gavetaAberta}
        {...(movel
          ? { role: 'dialog', 'aria-modal': true, 'aria-label': t('sidebar.mobile.drawerLabel') }
          : {})}
        onKeyDown={prenderFoco}
        onClick={fecharAoSeguirLink}
      >
        {movel && (
          <button
            type="button"
            className={styles.fecharGaveta}
            aria-label={t('sidebar.mobile.closeMenu')}
            onClick={() => fecharGaveta({ devolverFoco: true })}
          >
            <XIcon size={18} />
          </button>
        )}
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
                aria-expanded={project.id === currentProject?.id ? flyoutAberto : undefined}
                onClick={(e) => {
                  if (project.id === currentProject?.id) {
                    const caixa = e.currentTarget.getBoundingClientRect();
                    setPosicaoDoFlyout({ top: caixa.top, left: caixa.right + 8 });
                    setFlyoutAberto((aberto) => !aberto);
                    return;
                  }
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
            {flyoutAberto && currentProject && (
              <div
                className={styles.flyout}
                data-testid="flyout-do-projeto"
                style={{ top: posicaoDoFlyout.top, left: posicaoDoFlyout.left }}
              >
                <span className={styles.flyoutTitulo}>{currentProject.name}</span>
                <AbasDoProjeto
                  projectId={currentProject.id}
                  nomeDoProjeto={currentProject.name}
                  itens={itensDasAbas(
                    currentProject.id === abaPublicada?.projectId
                      ? contagensDaMoldura
                      : contagensDoResumo(
                          cardPorProjeto.get(currentProject.id)?.pendingApprovalsCount ?? 0,
                        ),
                  )}
                  active={abaAtivaDoAtual}
                  onChange={(chave) => irParaAba(currentProject.id, chave)}
                />
              </div>
            )}
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
              <Button
                type="button"
                icon
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGavetaAberta(false);
                  setWizardOpen(true);
                }}
                title={t('sidebar.nav.newProject')}
                aria-label={t('sidebar.nav.newProject')}
              >
                <PlusIcon size={16} />
              </Button>
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
                      <AbasDoProjeto
                        projectId={project.id}
                        nomeDoProjeto={project.name}
                        itens={itensDasAbas(
                          project.id === abaPublicada?.projectId
                            ? contagensDaMoldura
                            : contagensDoResumo(pendingApprovalsCount),
                        )}
                        active={project.id === currentProject?.id ? abaAtivaDoAtual : undefined}
                        onChange={(chave) => irParaAba(project.id, chave)}
                      />
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
              {currentProject && estadoDaAtividade === 'erro' && (
                <p className={styles.atividadesVazio} data-testid="atividades-erro">
                  {t('sidebar.activities.loadError')}
                </p>
              )}
              {currentProject && estadoDaAtividade === 'sem-sessao' && (
                <p className={styles.atividadesVazio}>{t('sidebar.activities.noSession')}</p>
              )}
              {currentProject && estadoDaAtividade === 'pronto' && grupos.length === 0 && (
                <p className={styles.atividadesVazio}>
                  {origemDaAtividade === 'execucao'
                    ? t('sidebar.activities.emptyExecution')
                    : t('sidebar.activities.empty')}
                </p>
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
          <LinkDeContainers colapsado={colapsado} />
          <LinkDeConta colapsado={colapsado} />
          {/* Na gaveta não há o que recolher — ela já some inteira. */}
          {!movel && (
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
          )}

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
        // Fallback nulo: o assistente é um modal por cima da tela, e o clique
        // que o abre já é a resposta visível; um esqueleto no meio do layout
        // piscaria no lugar errado.
        <Suspense fallback={null}>
          <NewProjectWizard workspaceId={workspace.id} onClose={() => setWizardOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
