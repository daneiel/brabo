import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { createSession, listActions, transitionSession } from '../lib/api-client';
import { useProjectSessions } from '../lib/hooks';
import {
  resumirAcoes,
  somarResumos,
  type ResumoDeAprovacoes,
} from '../lib/approvals';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { LIMITE_DO_NOME, rotuloDaSessao } from '../lib/session-label';
import { TIPOS_DE_SESSAO } from '../lib/session-kind';
import type { SessionKind, SessionStatus } from '../lib/api-types';
import styles from './ProjectSessionsTab.module.css';

const STATUS_TONE: Record<SessionStatus, 'success' | 'warning' | 'muted' | 'danger'> = {
  created: 'muted',
  active: 'success',
  closing: 'warning',
  closed: 'muted',
  closed_abnormally: 'danger',
};

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
  const [creating, setCreating] = useState(false);
  const [abrindoForm, setAbrindoForm] = useState(false);
  const [nome, setNome] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const copy = ABA_DO_KIND[kind];
  const tipo = TIPOS_DE_SESSAO[kind];

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
      await transitionSession(projectId, session.id, 'active');
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
      navigate({ to: '/projects/$projectId/sessions/$sessionId', params: { projectId, sessionId: session.id } });
    } finally {
      setCreating(false);
    }
  }

  // O filtro pelo tipo GRAVADO. A aba não infere o tipo de evento nenhum: ela
  // lê `sessions.kind`, que é a intenção de criação e não muda (RN-097).
  const sorted = (sessionsQuery.data ?? [])
    .filter((session) => session.kind === kind)
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
        <div className={styles.empty}>{copy.vazio}</div>
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
                <span className={styles.rowId}>
                  {rotuloDaSessao(session.id, session.name)}
                </span>
                <Badge tone={STATUS_TONE[session.status]} dot>
                  {session.status}
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
