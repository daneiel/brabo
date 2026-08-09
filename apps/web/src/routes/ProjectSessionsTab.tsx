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
import { LIMITE_DO_NOME, rotuloDaSessao } from '../lib/session-label';
import {
  KINDS_DE_SESSAO,
  KIND_PRE_SELECIONADO,
  TIPOS_DE_SESSAO,
} from '../lib/session-kind';
import type { SessionKind, SessionStatus } from '../lib/api-types';
import styles from './ProjectSessionsTab.module.css';

const STATUS_TONE: Record<SessionStatus, 'success' | 'warning' | 'muted' | 'danger'> = {
  created: 'muted',
  active: 'success',
  closing: 'warning',
  closed: 'muted',
  closed_abnormally: 'danger',
};

interface ProjectSessionsTabProps {
  projectId: string;
}

export function ProjectSessionsTab({ projectId }: ProjectSessionsTabProps) {
  const { data: sessions } = useProjectSessions(projectId);
  const [creating, setCreating] = useState(false);
  // O formulário é um PASSO, não um atalho: até a FASE 20 o botão abria a
  // sessão direto e o tipo não existia — quem quisesse o Criativo tinha de
  // descobrir um botão na barra de topo DEPOIS, que é o que o usuário relatou
  // como pouco claro. A escolha agora acontece antes, com as duas explicações
  // à vista.
  const [abrindoForm, setAbrindoForm] = useState(false);
  const [kind, setKind] = useState<SessionKind>(KIND_PRE_SELECIONADO);
  const [nome, setNome] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleCreate() {
    setCreating(true);
    try {
      const session = await createSession(projectId, {
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

  const sorted = [...(sessions ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Aprovações POR SESSÃO (achado #16 do primeiro dogfooding). Tudo o que
  // existia estava preso à sessão mais recente — `usePendingActions` exige um
  // `sessionId` e os três chamadores passavam o da última —, então uma decisão
  // esquecida numa sessão anterior ficava invisível para sempre.
  //
  // A rota de ações é escopada por sessão, e continua assim: a soma é feita
  // aqui, uma consulta por linha já listada. Sessões de um projeto são poucas,
  // e o TanStack Query as cacheia junto com as da aba de aprovações.
  const acoesPorSessao = useQueries({
    queries: sorted.map((session) => ({
      queryKey: ['session-actions', projectId, session.id],
      queryFn: () => listActions(projectId, session.id, { limit: 200 }),
    })),
  });
  const resumoDe = (indice: number): ResumoDeAprovacoes =>
    resumirAcoes(acoesPorSessao[indice]?.data?.items);
  const totalDoProjeto = somarResumos(
    acoesPorSessao.map((q) => resumirAcoes(q.data?.items)),
  );

  return (
    <div>
      <div className={styles.header}>
        <span className={styles.title}>Sessões</span>
        <Button
          onClick={() => setAbrindoForm((v) => !v)}
          variant={abrindoForm ? 'ghost' : 'primary'}
          aria-expanded={abrindoForm}
        >
          {abrindoForm ? 'Cancelar' : '+ Nova sessão'}
        </Button>
      </div>

      {abrindoForm && (
        <div className={styles.novaSessao}>
          {/* `fieldset` + rádios NATIVOS, e não dois botões que parecem
              selecionáveis: a escolha é entre alternativas exclusivas, e só
              assim o leitor de tela anuncia "1 de 2" e as setas navegam entre
              elas. A explicação vive DENTRO do `label`, então é lida junto com
              a opção — é ela que a fase existe para tornar visível. */}
          <fieldset className={styles.tipos}>
            <legend className={styles.tiposLegenda}>Tipo da sessão</legend>
            {KINDS_DE_SESSAO.map((opcao) => {
              const tipo = TIPOS_DE_SESSAO[opcao];
              const marcado = kind === opcao;
              return (
                <label
                  key={opcao}
                  className={[styles.tipo, marcado && styles.tipoMarcado]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <input
                    type="radio"
                    name="session-kind"
                    value={opcao}
                    checked={marcado}
                    onChange={() => setKind(opcao)}
                    className={styles.tipoRadio}
                  />
                  <span className={styles.tipoTexto}>
                    <span className={styles.tipoRotulo}>{tipo.rotulo}</span>
                    <span className={styles.tipoExplicacao}>{tipo.explicacao}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

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
              {creating ? 'Abrindo…' : `Abrir sessão ${TIPOS_DE_SESSAO[kind].rotulo.toLowerCase()}`}
            </Button>
          </div>
        </div>
      )}

      {totalDoProjeto.total > 0 && (
        <div className={styles.subtitle}>
          {totalDoProjeto.total} ação(ões) proposta(s) no projeto ·{' '}
          {totalDoProjeto.decididasPorVoce} decidida(s) por você ·{' '}
          {totalDoProjeto.autoAprovadas} auto-aprovada(s) pela política ·{' '}
          {totalDoProjeto.pendentes} aguardando
        </div>
      )}

      {sorted.length === 0 ? (
        <div className={styles.empty}>Nenhuma sessão ainda. Crie uma pra começar a conversar com um modelo.</div>
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
                {/* O tipo é visível na LISTA, e não só dentro da sessão: é
                    aqui que se escolhe qual retomar. */}
                <Badge tone={TIPOS_DE_SESSAO[session.kind].tom}>
                  {TIPOS_DE_SESSAO[session.kind].rotulo}
                </Badge>
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
