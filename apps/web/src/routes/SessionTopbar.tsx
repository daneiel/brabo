import {
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getSession,
  getSessionBudget,
  getSessionModelBinding,
  getSessionResponseLanguage,
  listModels,
  setSessionModelBinding,
} from '../lib/api-client';
import { agruparModelos } from '../lib/models';
import { chaveDoIdiomaDaSessao } from '../lib/idioma-da-resposta';
import {
  modoDaBarra,
  useLarguraObservada,
  type ModoDaBarra,
} from '../lib/modo-da-barra-da-sessao';
import { TokenMeter } from '../components/TokenMeter';
import { SessionLanguageIndicator } from './SessionLanguageIndicator';
import { ModelPicker } from '../components/ModelPicker';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LIMITE_DO_NOME } from '../lib/session-label';
import { TIPOS_DE_SESSAO } from '../lib/session-kind';
import {
  ArrowLeftIcon,
  BulbIcon,
  ChevronDownIcon,
  LayoutSidebarIcon,
  ModelIcon,
  StopSquareIcon,
} from '../components/ui/icons';
import { pontoDaSessao } from '../lib/session-timeline';
import { sessaoEhTerminal } from '../lib/sessao-encerrada';
import styles from './SessionPage.module.css';

/**
 * A barra do topo da tela de Sessão: a saída para o projeto, o ponto de
 * estado, o título que se renomeia no lugar (RN-098), o tipo (RN-097), o
 * seletor de modelo da sessão, o idioma das respostas de quem vê (RN-620), o
 * medidor de orçamento, o atalho de ideação,
 * "Encerrar" e o botão do painel lateral.
 *
 * Moveu de `SessionPage.tsx` no PR 3 do programa do ADR 0176, sem mudar uma
 * linha do JSX: o estado e os handlers continuam donos do `SessionPage`, e
 * chegam aqui com os MESMOS nomes que o bloco lia do escopo dele.
 *
 * Desde a AT-317 ela se arruma pela PRÓPRIA largura (`modoDaBarra`): o título
 * é o item que cresce e o último a encolher (reticências, e o nome inteiro no
 * `title`), os botões nunca quebram linha, e abaixo de
 * `LARGURA_DA_BARRA_COMPLETA` modelo, idioma e orçamento viram UM controle que
 * abre um painel com os três inteiros — nada some, só muda de lugar.
 */
export interface SessionTopbarProps {
  projectId: string;
  sessionId: string;
  session: Awaited<ReturnType<typeof getSession>> | undefined;
  rascunhoDoNome: string | null;
  setRascunhoDoNome: Dispatch<SetStateAction<string | null>>;
  handleRename: () => Promise<void>;
  hashtag: string;
  rotulo: string;
  metaDaSessao: string;
  tipo: (typeof TIPOS_DE_SESSAO)[keyof typeof TIPOS_DE_SESSAO] | undefined;
  modelsByCategory: Awaited<ReturnType<typeof listModels>> | undefined;
  resolvedBinding: Awaited<ReturnType<typeof getSessionModelBinding>> | undefined;
  budget: Awaited<ReturnType<typeof getSessionBudget>> | undefined;
  queryClient: QueryClient;
  isActive: boolean;
  sessaoCriativa: boolean;
  criativoActive: boolean;
  conviteVisivel: boolean;
  handleStartIdeation: () => Promise<void>;
  handleClose: () => Promise<void>;
  asideOpen: boolean;
  setAsideOpen: Dispatch<SetStateAction<boolean>>;
}

export function SessionTopbar({
  projectId,
  sessionId,
  session,
  rascunhoDoNome,
  setRascunhoDoNome,
  handleRename,
  hashtag,
  rotulo,
  metaDaSessao,
  tipo,
  modelsByCategory,
  resolvedBinding,
  budget,
  queryClient,
  isActive,
  sessaoCriativa,
  criativoActive,
  conviteVisivel,
  handleStartIdeation,
  handleClose,
  asideOpen,
  setAsideOpen,
}: SessionTopbarProps) {
  const { t } = useTranslation('sessionPage');
  const barraRef = useRef<HTMLDivElement>(null);
  const modo = modoDaBarra(useLarguraObservada(barraRef));
  const emLinha = modo === 'completa';

  const seletorDeModelo = modelsByCategory && (
    <ModelPicker
      variant="topbar"
      models={modelsByCategory}
      selectedModelId={resolvedBinding?.modelId}
      onSelect={(model) =>
        setSessionModelBinding(projectId, sessionId, model.id).then(() =>
          queryClient.invalidateQueries({ queryKey: ['session-model-binding', projectId, sessionId] }),
        )
      }
    />
  );
  const medidor = budget && (
    <TokenMeter
      variant="live"
      unitLabel="USD"
      used={budget.spentMicros / 1_000_000}
      limit={budget.limitMicros / 1_000_000}
      costBRL={0}
      costUSD={budget.spentMicros / 1_000_000}
    />
  );

  return (
    <div className={styles.topbar} ref={barraRef} data-modo={modo}>
      {/* A SAÍDA da tela (FASE 20). Até aqui `SessionPage` não importava
          `Link` nem `useNavigate`: entrar numa sessão era um beco, e o único
          caminho de volta era o botão do navegador. É `Link`, e não um
          `onClick` que navega, porque voltar ao PROJETO é um destino —
          abrir em outra aba e ver o alvo na barra de status são de graça.
          Volta ao PROJETO, não ao dashboard raiz: a sessão sempre nasce
          dentro de um projeto, e é lá que quem sai dela quer estar. */}
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        className={styles.voltar}
        aria-label={t('topbar.voltarAoProjeto')}
        title={t('topbar.voltarAoProjeto')}
      >
        <ArrowLeftIcon size={17} />
      </Link>
      {/* O ponto DIZ o estado da sessão. Era verde sempre — só o pulso
          mudava —, então uma sessão encerrada exibia o mesmo sinal de "ao
          vivo" de uma em curso. E era mudo para quem não vê cor: agora tem
          rótulo. */}
      <span
        className={[styles.statusDot, styles[pontoDaSessao(session?.status).classe]]
          .filter(Boolean)
          .join(' ')}
        role="status"
        aria-label={t('status.ariaLabel', { status: t(pontoDaSessao(session?.status).rotuloKey) })}
      />
      {/* Título e metadados em UMA linha cada, como o desenho — e por isso
          com reticências quando a barra aperta. `title` porque texto
          truncado sem forma de ler o resto é informação perdida. */}
      <div className={styles.titleBlock}>
        {rascunhoDoNome !== null ? (
          /* Renomear no LUGAR do título, e não num diálogo: o campo ocupa a
             posição exata do texto que ele muda. Enter confirma, Esc
             desiste — as duas teclas que já valem no composer logo abaixo. */
          <input
            className={styles.tituloEditavel}
            value={rascunhoDoNome}
            autoFocus
            maxLength={LIMITE_DO_NOME}
            aria-label={t('topbar.nomeDaSessao')}
            placeholder={t('topbar.semNomeFicaHashtag', { hashtag })}
            onChange={(e) => setRascunhoDoNome(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setRascunhoDoNome(null);
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.title}
            title={t('topbar.tituloRenomear', { rotulo })}
            onClick={() => setRascunhoDoNome(session?.name ?? '')}
            disabled={!session}
          >
            {t('topbar.tituloSessao', { rotulo })}
          </button>
        )}
        <div className={styles.meta} title={metaDaSessao}>
          {metaDaSessao}
        </div>
      </div>
      {/* O tipo, VISÍVEL e imutável (RN-097). É ele que diz por que esta
          sessão tem — ou não tem — o botão de iniciar a ideação. */}
      {tipo && (
        <Badge tone={tipo.tom} title={tipo.explicacao}>
          {tipo.rotulo}
        </Badge>
      )}
      {/* SEM `filtroDeAgentesPadrao`, ao contrário dos seletores de agente e
          de área nas Configurações — e a omissão é decisão, não esquecimento.
          Este picker grava no escopo `session`, e `assertModelFitsBindingScope`
          deixa `session` livre de propósito (RN-040): quem `exigeToolCalling`
          é o TURNO, não o escopo — `RunLlmTurnUseCase` só liga a exigência
          quando há ferramenta na chamada. Marcar o filtro aqui esconderia
          modelo que a api aceita, que é o inverso do defeito que ligá-lo nas
          outras duas telas conserta. */}
      {emLinha ? (
        <div className={styles.ajustesEmLinha}>
          {seletorDeModelo}
          {/* O idioma das respostas de QUEM VÊ (RN-620), ao lado do modelo mas
              em outro escopo: o modelo é da sessão, o idioma é da pessoa —
              trocar aqui é o override POR SESSÃO da RN-618, só dela. */}
          <SessionLanguageIndicator projectId={projectId} sessionId={sessionId} />
          {medidor}
        </div>
      ) : (
        /* Barra estreita (AT-317): os três no painel de UM controle, e o
           controle mostra o resumo — nome do modelo e código do idioma. A
           ORIGEM do idioma (RN-620) e a pergunta da detecção (RN-624) moram no
           painel, inteiras; a pergunta pendente marca o controle. */
        <AjustesAgrupados
          modo={modo}
          projectId={projectId}
          sessionId={sessionId}
          nomeDoModelo={
            modelsByCategory && resolvedBinding?.modelId
              ? agruparModelos(modelsByCategory)
                  .flatMap((g) => g.modelos)
                  .find((m) => m.id === resolvedBinding.modelId)?.displayName
              : undefined
          }
        >
          {seletorDeModelo}
          <SessionLanguageIndicator projectId={projectId} sessionId={sessionId} modo="painel" />
          {medidor}
        </AjustesAgrupados>
      )}
      {/* O botão existe SÓ na sessão criativa (RN-097). Antes ele aparecia em
          qualquer sessão, e era a única maneira de chegar ao Criativo —
          descobrir isso depois de a sessão existir foi o que o usuário
          relatou como pouco claro. Agora a escolha aconteceu na criação, e a
          sessão consultiva não oferece o que ela não faz.

          FASE 24: e ele some da topbar enquanto o CONVITE está na tela, onde
          a mesma ação agora é oferecida (RN-104). O convite antes APONTAVA
          para cá — "use Iniciar ideação, no alto da tela" —, que é a versão
          literal do problema que originou a FASE 20: a ação num lugar e a
          explicação em outro. Uma ação, um lugar de cada vez; a topbar segue
          sendo a saída para quem já digitou algo e nunca chamou o Criativo,
          que é o caso em que o convite não está mais lá.

          E quando chega aqui SEM o convite ter aparecido nunca — quem
          manda uma mensagem antes de clicar em "Iniciar ideação" nunca vê
          o texto do convite, porque `conviteVisivel` depende de
          `!conversaComecou`, que não volta a `false` — o botão sozinho não
          dizia o que fazia. A pista (ícone + nota do Criativo, mesma cor
          da bolha dele no fio, e `title` pro hover) fica ao lado dele. */}
      {isActive && sessaoCriativa && !criativoActive && !conviteVisivel && (
        <span className={styles.iniciarIdeacaoComPista}>
          <BulbIcon
            size={14}
            className={styles.iniciarIdeacaoIcone}
            aria-hidden="true"
          />
          {/* Na barra estreita a pista sai da LINHA, não da tela: o `title`
              do botão diz o mesmo, por extenso (AT-317). */}
          {emLinha && (
            <span className={styles.iniciarIdeacaoDica}>
              {t('topbar.trazCriativo')}
            </span>
          )}
          <Button
            className={styles.acaoDaBarra}
            onClick={handleStartIdeation}
            title={t('topbar.iniciarIdeacaoTitulo')}
          >
            {t('topbar.iniciarIdeacao')}
          </Button>
        </span>
      )}
      {/* O botão de aceitar handoff SAIU daqui (RN-125): mora dentro do
          fio agora, embutido no PRÓPRIO card que já anunciava "X passou o
          bastão ao Y" — contextual, no lugar onde a passagem aconteceu, em
          vez de um botão solto na topbar sem relação visual com o evento
          que o originou. Manter os dois puxaria dois botões com o MESMO
          texto visíveis ao mesmo tempo na tela. */}
      {/* Encerrar é destrutivo e o desenho o marca como tal: contorno em
          `danger`, não um botão fantasma indistinguível dos outros. */}
      <Button
        variant="danger"
        className={styles.acaoDaBarra}
        onClick={handleClose}
        disabled={!session || sessaoEhTerminal(session.status)}
        // Na barra mínima o botão fica só com o ícone; o nome acessível e o
        // `title` devolvem o verbo, que é o que um botão destrutivo deve dizer.
        aria-label={modo === 'minima' ? t('topbar.encerrarSessao') : undefined}
        title={modo === 'minima' ? t('topbar.encerrarSessao') : undefined}
      >
        <StopSquareIcon size={15} />
        {modo !== 'minima' && t('topbar.encerrar')}
      </Button>
      {/* Aberto é `secondary` (fundo e borda), fechado é `ghost`: o controle diz
          se o painel está aberto — antes ele tinha uma aparência só. */}
      <Button
        type="button"
        icon
        variant={asideOpen ? 'secondary' : 'ghost'}
        className={styles.toggleAside}
        onClick={() => setAsideOpen((v) => !v)}
        aria-pressed={asideOpen}
        aria-label={t('topbar.alternarPainel')}
      >
        <LayoutSidebarIcon size={17} />
      </Button>
    </div>
  );
}

/**
 * Modelo, idioma das respostas e orçamento num controle só, para a barra que
 * não os comporta em linha (AT-317). O gatilho mostra o RESUMO (nome do modelo
 * e código do idioma; na barra mínima, só o ícone com nome acessível), e o
 * painel traz os três controles inteiros — o seletor de modelo de sempre, o
 * idioma com a ORIGEM por extenso (RN-620) e o medidor.
 *
 * A pergunta da detecção (RN-624) mora no painel; enquanto ela existe, o
 * gatilho ganha uma marca, senão a pergunta ficaria escondida atrás de um
 * clique que ninguém sabe que precisa dar.
 */
function AjustesAgrupados({
  modo,
  projectId,
  sessionId,
  nomeDoModelo,
  children,
}: {
  modo: Exclude<ModoDaBarra, 'completa'>;
  projectId: string;
  sessionId: string;
  nomeDoModelo: string | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation('sessionPage');
  const [aberto, setAberto] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const idDoPainel = useId();
  // A MESMA chave do indicador: o react-query deduplica, então o gatilho lê o
  // que o indicador já busca, sem requisição a mais.
  const { data: idioma } = useQuery({
    queryKey: chaveDoIdiomaDaSessao(projectId, sessionId),
    queryFn: () => getSessionResponseLanguage(projectId, sessionId),
  });
  const perguntaPendente = Boolean(idioma?.detectionQuestion);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (raizRef.current && !raizRef.current.contains(e.target as Node)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAberto(false);
        gatilhoRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  const resumo = [nomeDoModelo ?? t('topbar.ajustes'), idioma?.language]
    .filter(Boolean)
    .join(' · ');
  const nomeAcessivel = [
    t('topbar.ajustesAria'),
    resumo,
    perguntaPendente ? t('topbar.perguntaDeIdiomaPendente') : null,
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <div className={styles.ajustesAgrupados} ref={raizRef}>
      <button
        type="button"
        ref={gatilhoRef}
        className={styles.gatilhoDosAjustes}
        aria-expanded={aberto}
        aria-haspopup="dialog"
        aria-controls={aberto ? idDoPainel : undefined}
        aria-label={nomeAcessivel}
        title={nomeAcessivel}
        data-testid="ajustes-da-sessao"
        onClick={() => setAberto((v) => !v)}
      >
        <ModelIcon size={14} />
        {modo === 'compacta' && <span className={styles.resumoDosAjustes}>{resumo}</span>}
        {perguntaPendente && (
          <span
            className={styles.marcaDePergunta}
            aria-hidden="true"
            data-testid="marca-pergunta-de-idioma"
          />
        )}
        <ChevronDownIcon size={13} />
      </button>
      {aberto && (
        <div
          id={idDoPainel}
          role="dialog"
          aria-label={t('topbar.ajustesAria')}
          className={styles.painelDosAjustes}
          data-testid="painel-dos-ajustes"
        >
          {children}
        </div>
      )}
    </div>
  );
}
