import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createSession,
  getMySpend,
  listActions,
  mensagemDaApi,
  renameSession,
  transitionSession,
} from '../lib/api-client';
import { useActiveExecutionSession, useProjectSessions } from '../lib/hooks';
import {
  resumirAcoes,
  somarResumos,
  type ResumoDeAprovacoes,
} from '../lib/approvals';
import { Button } from '../components/ui/Button';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { useToast } from '../components/ui/ToastProvider';
import { PencilIcon } from '../components/ui/icons';
import { LIMITE_DO_NOME, hashtagDaSessao, rotuloDaSessao } from '../lib/session-label';
import { TIPOS_DE_SESSAO } from '../lib/session-kind';
import { Destaque } from '../components/SpendCharts';
import { formatarUsd } from '../components/CredentialSpendSection';
import type { Session, SessionKind, SessionStatus } from '../lib/api-types';
import styles from './ProjectSessionsTab.module.css';

/**
 * O selo de status de uma sessão (RN-227).
 *
 * O handoff pede QUATRO selos (ativa/aguardando/fechada/abortada) para CINCO
 * estados reais da máquina (`created/active/closing/closed/closed_abnormally`
 * — ver Convenções do CLAUDE.md). `closed_abnormally` → abortada e
 * `created` → aguardando são diretos. `closing` NÃO tem selo óbvio, e fingir
 * que é "fechada" mentiria sobre o desfecho: uma sessão em `closing` ainda
 * não sabe se vai terminar `closed` ou `closed_abnormally`. Por isso ela
 * ganha um QUINTO selo próprio ("encerrando", tom `accent` — o único tom que
 * sobra depois de ativa/aguardando/fechada/abortada ocuparem os outros
 * quatro), em vez de ser fundida com "fechada".
 */
const SELO_DO_STATUS: Record<
  SessionStatus,
  { texto: string; tone: BadgeTone; pulse?: boolean }
> = {
  created: { texto: 'aguardando', tone: 'warning' },
  active: { texto: 'ativa', tone: 'success', pulse: true },
  closing: { texto: 'encerrando', tone: 'accent', pulse: true },
  closed: { texto: 'fechada', tone: 'muted' },
  closed_abnormally: { texto: 'abortada', tone: 'danger' },
};

/**
 * Os filtros pill do handoff (`todas/ativas/fechadas/abortadas`) só cobrem
 * QUATRO estados — os mesmos quatro selos, não os cinco reais (RN-228). Os
 * dois estados sem pill própria entram pelo critério de TRAJETÓRIA, não de
 * aparência: `created` (aguardando) ainda não chegou a lugar nenhum, então
 * cai em "ativas" — é o pill de "sessão ainda em jogo". `closing` já está a
 * caminho de fechar sem erro, então cai em "fechadas" — é o pill de "sessão
 * que não abortou". O SELO de cada linha continua o de `SELO_DO_STATUS`
 * acima; o filtro só agrupa, nunca reescreve o que a linha mostra.
 */
type FiltroDeStatus = 'todas' | 'ativas' | 'fechadas' | 'abortadas';

const FILTROS: { chave: FiltroDeStatus; rotulo: string }[] = [
  { chave: 'todas', rotulo: 'Todas' },
  { chave: 'ativas', rotulo: 'Ativas' },
  { chave: 'fechadas', rotulo: 'Fechadas' },
  { chave: 'abortadas', rotulo: 'Abortadas' },
];

function correspondeAoFiltro(status: SessionStatus, filtro: FiltroDeStatus): boolean {
  if (filtro === 'todas') return true;
  if (filtro === 'ativas') return status === 'active' || status === 'created';
  if (filtro === 'fechadas') return status === 'closed' || status === 'closing';
  return status === 'closed_abnormally'; // filtro === 'abortadas'
}

/**
 * A copy de cada aba (FASE 24, RN-104).
 *
 * Uma entrada por `kind`, sem `default`, pelo mesmo motivo de
 * `TIPOS_DE_SESSAO`: tipo novo passa a exigir uma decisão de copy aqui, em vez
 * de aparecer na régua como o slug cru do banco.
 *
 * O que sumiu daqui é tão importante quanto o que entrou: **não há mais
 * escolha de tipo**. Até a FASE 20 a escolha acontecia num `fieldset` no
 * formulário; agora ela aconteceu quando a pessoa clicou na ABA, e perguntar
 * de novo seria oferecer a chance de contradizer o lugar em que ela está.
 */
const ABA_DO_KIND: Record<
  SessionKind,
  { titulo: string; abrir: string; confirmar: string; vazio: string }
> = {
  criativa: {
    titulo: 'Criativo',
    abrir: '+ Nova ideação',
    confirmar: 'Abrir sessão criativa',
    vazio:
      'Nenhuma ideação ainda. Abra uma para o Criativo levantar com você as ' +
      'regras de negócio do produto.',
  },
  consultiva: {
    titulo: 'Chat',
    abrir: '+ Nova conversa',
    confirmar: 'Abrir sessão consultiva',
    vazio:
      'Nenhuma conversa ainda. Abra uma para perguntar e pedir contexto sem ' +
      'ativar agente nenhum.',
  },
};

interface ProjectSessionsTabProps {
  projectId: string;
  /**
   * O tipo que esta aba É. Não é filtro de conveniência: é a identidade do
   * lugar — o que ele lista e o que ele cria.
   */
  kind: SessionKind;
}

/**
 * A lista de sessões de UM tipo (FASE 24, RN-104).
 *
 * Era uma aba só, "Sessões", listando tudo misturado, com a escolha do tipo
 * num formulário. O pedido do usuário foi separar: "deveriam ser duas abas
 * distintas, ou seja uma Criativo/Chat". A separação não é cosmética — ela
 * torna o tipo, que é IMUTÁVEL depois de criado (RN-097), a coordenada de
 * navegação em vez de um campo escondido num passo de criação.
 */
export function ProjectSessionsTab({ projectId, kind }: ProjectSessionsTabProps) {
  const sessionsQuery = useProjectSessions(projectId);
  // A sessão de execução VIGENTE (RN-144) — só buscada na aba Criativo, que é
  // onde ela nasce (RN-097: `execution.activated` exige `kind: 'criativa'`).
  // `useActiveExecutionSession(undefined)` fica `enabled: false` na aba Chat,
  // então não dispara requisição nenhuma ali.
  const executionSessionQuery = useActiveExecutionSession(
    kind === 'criativa' ? projectId : undefined,
  );
  const [creating, setCreating] = useState(false);
  const [abrindoForm, setAbrindoForm] = useState(false);
  const [nome, setNome] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const copy = ABA_DO_KIND[kind];
  const tipo = TIPOS_DE_SESSAO[kind];

  // Renomear DIRETO da lista, sem abrir a sessão (RN-098 já existia só dentro
  // dela). Mesmo mecanismo de `SessionPage.tsx`: rascunho por id, Enter
  // confirma, Esc desiste, blur confirma. `rascunho` guarda QUAL linha está em
  // edição — a lista tem várias, a sessão só tem uma.
  const [rascunho, setRascunho] = useState<{ id: string; valor: string } | null>(null);

  // O filtro pill (RN-228) só existe na aba Criativo — a Chat continua sem
  // segmentação por status, e o valor parado em 'todas' faz `sorted` abaixo
  // se comportar exatamente como antes para ela.
  const [filtro, setFiltro] = useState<FiltroDeStatus>('todas');

  async function handleRenomear(sessionId: string) {
    if (!rascunho || rascunho.id !== sessionId) return;
    // Em branco APAGA o nome, mesma regra de `SessionPage` (RN-098).
    const nomeNovo = rascunho.valor.trim() || null;
    setRascunho(null);
    try {
      await renameSession(projectId, sessionId, nomeNovo);
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível renomear a sessão', tone: 'danger' });
    }
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const session = await createSession(projectId, {
        // O `kind` vem da ABA, não de um controle na tela: é isto que fecha o
        // item 3 da fase — o CTA cria o tipo do lugar, sem perguntar de novo.
        kind,
        // Nome em branco não vai no corpo: ausência é `null` no banco, e a
        // tela degrada para a hashtag sozinha (RN-098).
        name: nome.trim() || undefined,
      });

      // Os DOIS passos têm desfecho próprio de propósito. Antes eram um `try`
      // com `finally` só, e uma ativação que falhava (a api sem alcançar o
      // engine devolve 500) deixava a tela EXATAMENTE como estava: nenhum
      // toast, nenhuma navegação, a sessão criada e invisível. O botão parecia
      // não fazer nada, e a cada clique nascia outra sessão `created`.
      //
      // Falhar em ativar não desfaz a criação — a sessão existe —, então a
      // navegação acontece de todo modo: é lá que mora o "Ativar sessão", que
      // é o segundo caminho para o mesmo passo.
      try {
        await transitionSession(projectId, session.id, 'active');
      } catch (erro) {
        showToast({
          title: mensagemDaApi(erro, 'A sessão foi criada, mas não ativou'),
          message: 'Abra a sessão e tente "Ativar sessão".',
          tone: 'danger',
        });
      }

      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      navigate({ to: '/projects/$projectId/sessions/$sessionId', params: { projectId, sessionId: session.id } });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, 'Não foi possível abrir a sessão'),
        tone: 'danger',
      });
    } finally {
      setCreating(false);
    }
  }

  // O filtro pelo tipo GRAVADO. A aba não infere o tipo de evento nenhum: ela
  // lê `sessions.kind`, que é a intenção de criação e não muda (RN-097).
  //
  // A VIGENTE fica de fora da lista (RN-144): ela nasce `kind: 'criativa'`
  // (RN-097) mas o que ela CONTÉM é a timeline de tool-call de dev agent, não
  // uma ideação — misturada na lista, uma sessão com 35+ eventos de execução
  // parecia "o dev escrevendo no chat do Criativo". `useActiveExecutionSession`
  // é `undefined` na aba Chat (query desligada), então o filtro é um no-op lá.
  //
  // `doKind` é a base para os KPIs (contam TODOS os estados, não só os que o
  // pill selecionado mostra); `sorted` é o que a lista renderiza.
  const doKind = (sessionsQuery.data ?? [])
    .filter((session) => session.kind === kind)
    .filter((session) => session.id !== executionSessionQuery.session?.id);

  const sorted = doKind
    .filter((session) => kind !== 'criativa' || correspondeAoFiltro(session.status, filtro))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Aprovações POR SESSÃO (achado #16 do primeiro dogfooding). Tudo o que
  // existia estava preso à sessão mais recente — `usePendingActions` exige um
  // `sessionId` e os três chamadores passavam o da última —, então uma decisão
  // esquecida numa sessão anterior ficava invisível para sempre.
  //
  // A rota de ações é escopada por sessão, e continua assim: a soma é feita
  // aqui, uma consulta por linha já listada. Sessões de um projeto são poucas,
  // e o TanStack Query as cacheia junto com as da aba de aprovações.
  //
  // O hook roda SEMPRE, mesmo em erro ou carregamento: com a lista vazia ele
  // não dispara consulta nenhuma, e é o que permite os três estados abaixo
  // serem render condicional em vez de `return` antecipado — `return` antes de
  // um hook muda a ordem dos hooks entre renders.
  const acoesPorSessao = useQueries({
    queries: sorted.map((session) => ({
      queryKey: ['session-actions', projectId, session.id],
      queryFn: () => listActions(projectId, session.id, { limit: 200 }),
    })),
  });
  const resumoDe = (indice: number): ResumoDeAprovacoes =>
    resumirAcoes(acoesPorSessao[indice]?.data?.items);
  const totalDaAba = somarResumos(
    acoesPorSessao.map((q) => resumirAcoes(q.data?.items)),
  );

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.headerTexto}>
          <span className={styles.title}>{copy.titulo}</span>
          {/* A explicação do tipo mora AQUI agora, permanente. Antes ela só
              existia dentro do rádio do formulário — visível no instante da
              escolha e nunca mais. */}
          <span className={styles.subtitleTipo}>{tipo.explicacao}</span>
        </div>
        <Button
          onClick={() => setAbrindoForm((v) => !v)}
          variant={abrindoForm ? 'ghost' : 'primary'}
          aria-expanded={abrindoForm}
        >
          {abrindoForm ? 'Cancelar' : copy.abrir}
        </Button>
      </div>

      {abrindoForm && (
        <div className={styles.novaSessao}>
          <Input
            label="Nome (opcional)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={LIMITE_DO_NOME}
            placeholder="Checkout do carrinho"
            hint="A hashtag do id continua aparecendo — o nome só se soma a ela."
          />

          <div className={styles.novaSessaoAcoes}>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Abrindo…' : copy.confirmar}
            </Button>
          </div>
        </div>
      )}

      {/* KPIs e filtros pill só existem na aba Criativo (handoff, RN-227/228)
          — a Chat/consultiva não tem o dado de custo por sessão e a RN-104
          já fechou a discussão sobre segmentos novos nesta tela. */}
      {kind === 'criativa' && sessionsQuery.data && (
        <CriativoKpis projectId={projectId} sessoes={doKind} />
      )}

      {kind === 'criativa' && sessionsQuery.data && doKind.length > 0 && (
        <div className={styles.filtros} role="group" aria-label="Filtrar sessões por status">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              type="button"
              className={
                filtro === f.chave
                  ? `${styles.pill} ${styles.pillAtivo}`
                  : styles.pill
              }
              aria-pressed={filtro === f.chave}
              onClick={() => setFiltro(f.chave)}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      )}

      {totalDaAba.total > 0 && (
        <div className={styles.subtitle}>
          {totalDaAba.total} ação(ões) proposta(s) nestas sessões ·{' '}
          {totalDaAba.decididasPorVoce} decidida(s) por você ·{' '}
          {totalDaAba.autoAprovadas} auto-aprovada(s) pela política ·{' '}
          {totalDaAba.pendentes} aguardando
        </div>
      )}

      {/* Os TRÊS estados, com ERRO antes de vazio (RN-088). A ordem é a regra:
          `sorted.length === 0` também é verdade quando a api recusou, e uma
          aba que dissesse "nenhuma ideação ainda" depois de um 429 estaria
          mentindo — a pessoa tem sessões, o que não chegou foi a lista. */}
      {sessionsQuery.isError ? (
        <ErroDeCarregamento
          titulo="Não foi possível carregar as sessões deste projeto."
          erro={sessionsQuery.error}
          onTentarDeNovo={() => void sessionsQuery.refetch()}
        />
      ) : sessionsQuery.isPending ? (
        <div className={styles.list} aria-busy="true">
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : sorted.length === 0 ? (
        <div className={styles.empty}>
          {/* Vazio por FILTRO (há sessões, nenhuma no pill escolhido) é uma
              frase diferente de vazio por AUSÊNCIA — dizer "nenhuma ideação
              ainda" com sessões fechadas escondidas atrás do pill "Ativas"
              seria a mesma mentira que a RN-088 já corrigiu para erro. */}
          {kind === 'criativa' && filtro !== 'todas' && doKind.length > 0
            ? 'Nenhuma sessão neste filtro.'
            : copy.vazio}
        </div>
      ) : (
        <div className={styles.list}>
          {sorted.map((session, indice) => {
            const resumo = resumoDe(indice);
            return (
              <div
                key={session.id}
                className={styles.row}
                onClick={() => navigate({ to: '/projects/$projectId/sessions/$sessionId', params: { projectId, sessionId: session.id } })}
              >
                {rascunho?.id === session.id ? (
                  // O campo ocupa o LUGAR do rótulo, mesma ideia da
                  // `SessionPage`. `stopPropagation` no clique é o que
                  // impede o clique de posicionar o cursor e navegar pra
                  // dentro da sessão ao mesmo tempo.
                  <input
                    className={styles.rowIdEditavel}
                    value={rascunho.valor}
                    autoFocus
                    maxLength={LIMITE_DO_NOME}
                    aria-label="Nome da sessão"
                    placeholder={`Sem nome — a sessão fica ${hashtagDaSessao(session.id)}`}
                    onClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
                    onChange={(e) => setRascunho({ id: session.id, valor: e.target.value })}
                    onBlur={() => handleRenomear(session.id)}
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') handleRenomear(session.id);
                      if (e.key === 'Escape') setRascunho(null);
                    }}
                  />
                ) : (
                  // Botão, não `span`: clicar no nome (ou no lápis) abre a
                  // edição SEM navegar — `stopPropagation` impede o clique
                  // de também disparar o `onClick` da linha, que abre a
                  // sessão. Só clicar fora deste controle navega.
                  <button
                    type="button"
                    className={styles.rowId}
                    title={`Sessão ${rotuloDaSessao(session.id, session.name)} — clique para renomear`}
                    onClick={(e: MouseEvent<HTMLButtonElement>) => {
                      e.stopPropagation();
                      setRascunho({ id: session.id, valor: session.name ?? '' });
                    }}
                  >
                    <span className={styles.rowIdTexto}>
                      {rotuloDaSessao(session.id, session.name)}
                    </span>
                    <PencilIcon size={12} className={styles.rowIdPencil} />
                  </button>
                )}
                <Badge
                  tone={SELO_DO_STATUS[session.status].tone}
                  dot
                  pulse={SELO_DO_STATUS[session.status].pulse}
                >
                  {SELO_DO_STATUS[session.status].texto}
                </Badge>
                {resumo.total > 0 && (
                  <span
                    className={
                      resumo.pendentes > 0
                        ? `${styles.rowApprovals} ${styles.rowApprovalsPending}`
                        : styles.rowApprovals
                    }
                  >
                    {resumo.pendentes > 0
                      ? `${resumo.pendentes} aguardando · ${resumo.decididasPorVoce} decidida(s) por você`
                      : `${resumo.decididasPorVoce} decidida(s) por você · ${resumo.autoAprovadas} auto`}
                  </span>
                )}
                <span className={styles.rowDate}>{new Date(session.createdAt).toLocaleString('pt-BR')}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Os 4 KPIs da aba Criativo (handoff, RN-227/229/230).
 *
 * Dois são contagem direta sobre as sessões que o pai já carregou (sem
 * requisição própria). Os outros dois são onde o handoff pede um dado que o
 * produto não tem hoje, e cada um resolveu diferente:
 *
 * - "Custo do mês" REAPROVEITA `getMySpend` — a MESMA `queryKey` que a aba
 *   Gastos usa para a visão do membro (RN-101/ADR 0063), nunca uma
 *   agregação nova. É o consumo do ATOR autenticado NESTE projeto, não o
 *   total do projeto somando todo mundo: esse total é dado do OWNER
 *   (`porProjeto` em `getWorkspaceSpendReport`), e a aba Criativo é vista
 *   por qualquer membro — mostrar aqui o total geral vazaria gasto alheio
 *   para quem a RN-060/101 não autoriza a ver.
 * - "Taxa ideação → commit" é DECLARADA ausente (RN-230): não existe, em
 *   lugar nenhum do produto, vínculo entre uma sessão criativa e o commit
 *   que ela produziu. Inventar o cálculo aqui seria a mesma classe de erro
 *   que o ADR 0042 já recusa para nota de modelo — um número que parece
 *   medido e não é.
 */
function CriativoKpis({
  projectId,
  sessoes,
}: {
  projectId: string;
  sessoes: Session[];
}) {
  const ativasAgora = sessoes.filter((session) => session.status === 'active').length;

  // Mesma `queryKey` de `ProjectSpendTab.tsx#MeuConsumo` (`['my-spend',
  // projectId, DIAS]`, `DIAS = 30`): o TanStack Query dedupe se as duas
  // telas estiverem montadas, e uma delas nunca refaz a consulta que a
  // outra já fez.
  const custo = useQuery({
    queryKey: ['my-spend', projectId, 30],
    queryFn: () => getMySpend(projectId, 30),
  });

  return (
    <div className={styles.kpis}>
      <Destaque
        rotulo="Sessões no projeto"
        valor={String(sessoes.length)}
        detalhe="todas as ideações, em qualquer status"
      />
      <Destaque
        rotulo="Ativas agora"
        valor={String(ativasAgora)}
        detalhe={`de ${sessoes.length} no total`}
      />
      <Destaque
        rotulo="Taxa ideação → commit"
        valor="—"
        detalhe="não medido: sessão não é vinculada a commit hoje"
      />
      <Destaque
        rotulo="Custo do mês"
        valor={
          custo.data
            ? formatarUsd(custo.data.totalMicros)
            : custo.isError
              ? '—'
              : '…'
        }
        detalhe={
          custo.isError
            ? 'não foi possível carregar'
            : 'seu consumo neste projeto, 30 dias'
        }
      />
    </div>
  );
}

/**
 * As duas abas que o registro monta.
 *
 * Existem porque `AbaDoProjeto.component` recebe UM prop (`projectId`) — a
 * moldura não sabe, nem deve saber, que estas duas se distinguem por um
 * segundo. O `kind` fica preso aqui, e não numa prop opcional com default:
 * default significaria que uma aba mal-registrada lista o tipo errado em
 * silêncio.
 */
export function ProjectCriativoTab({ projectId }: { projectId: string }) {
  return <ProjectSessionsTab projectId={projectId} kind="criativa" />;
}

export function ProjectChatTab({ projectId }: { projectId: string }) {
  return <ProjectSessionsTab projectId={projectId} kind="consultiva" />;
}
