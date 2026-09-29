import type { Dispatch, SetStateAction } from 'react';
import { Link } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getSession,
  getSessionBudget,
  getSessionModelBinding,
  listModels,
  setSessionModelBinding,
} from '../lib/api-client';
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
  LayoutSidebarIcon,
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
  return (
    <div className={styles.topbar}>
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
      <div className={styles.spacer} />
      {/* SEM `filtroDeAgentesPadrao`, ao contrário dos seletores de agente e
          de área nas Configurações — e a omissão é decisão, não esquecimento.
          Este picker grava no escopo `session`, e `assertModelFitsBindingScope`
          deixa `session` livre de propósito (RN-040): quem `exigeToolCalling`
          é o TURNO, não o escopo — `RunLlmTurnUseCase` só liga a exigência
          quando há ferramenta na chamada. Marcar o filtro aqui esconderia
          modelo que a api aceita, que é o inverso do defeito que ligá-lo nas
          outras duas telas conserta. */}
      {modelsByCategory && (
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
      )}
      {/* O idioma das respostas de QUEM VÊ (RN-620), ao lado do modelo mas
          em outro escopo: o modelo é da sessão, o idioma é da pessoa — trocar
          aqui é o override POR SESSÃO da RN-618, só dela. */}
      <SessionLanguageIndicator projectId={projectId} sessionId={sessionId} />
      {budget && (
        <TokenMeter
          variant="live"
          unitLabel="USD"
          used={budget.spentMicros / 1_000_000}
          limit={budget.limitMicros / 1_000_000}
          costBRL={0}
          costUSD={budget.spentMicros / 1_000_000}
        />
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
          <span className={styles.iniciarIdeacaoDica}>
            {t('topbar.trazCriativo')}
          </span>
          <Button
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
      <Button variant="danger" onClick={handleClose} disabled={!session || sessaoEhTerminal(session.status)}>
        <StopSquareIcon size={15} />
        {t('topbar.encerrar')}
      </Button>
      <button
        type="button"
        className={[styles.toggleAside, asideOpen && styles.toggleAsideOn]
          .filter(Boolean)
          .join(' ')}
        onClick={() => setAsideOpen((v) => !v)}
        aria-pressed={asideOpen}
        aria-label={t('topbar.alternarPainel')}
      >
        <LayoutSidebarIcon size={17} />
      </button>
    </div>
  );
}
