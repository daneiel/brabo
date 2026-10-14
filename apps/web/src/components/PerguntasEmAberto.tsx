import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { answerOpenQuestion, mensagemDaApi } from '../lib/api-client';
import type { OpenQuestion, Story, Task } from '../lib/api-types';
import { motivoDeCorrecaoInerte } from '../lib/correcao-de-historia';
import { nomeDoAgente } from '../lib/agents';
import { userIdDaSessao } from '../lib/auth';
import {
  ID_DA_FILA_DE_PERGUNTAS,
  rolarAteAsPerguntas,
  usePerguntasEmAberto,
} from '../lib/perguntas-em-aberto';
import { formatRelativeTime } from '../lib/time';
import { Button } from './ui/Button';
import styles from './PendenciasDeOutrasSessoes.module.css';

const TETO_DA_RESPOSTA = 2000;

interface PerguntasEmAbertoProps {
  projectId: string;
  perguntas: readonly OpenQuestion[];
  /** Total da api (a lista vem com teto de 50, RN-180). */
  total: number;
  /** As tarefas do backlog, para nomear a tarefa que espera a resposta. */
  tarefas?: readonly Task[];
  /**
   * RN-884 (AT-538): as perguntas que ESTA tela respondeu, guardadas por quem
   * monta a fila (a releitura as tira da lista da api), e as histórias do
   * backlog, para saber se a afetada ainda é corrigível.
   */
  respondidas?: readonly OpenQuestion[];
  aoResponder?: (pergunta: OpenQuestion) => void;
  aoDispensar?: (questionId: string) => void;
  historias?: readonly Story[];
  /** `developer` no endpoint de correção (RN-727, RN-102). */
  podeCorrigir?: boolean;
}

/**
 * RN-861 (AT-521): a fila "Perguntas em aberto" — título e contagem PRÓPRIOS
 * (RN-467). Só o AUTOR da sessão de origem responde (RN-858); os outros veem o
 * cartão com o controle inerte e o motivo em TEXTO (ADR 0064). A tarefa que
 * o gate de QA estacionou por esta pergunta aparece aqui como "esperando sua
 * resposta" (RN-860).
 */
export function PerguntasEmAberto({
  projectId,
  perguntas,
  total,
  tarefas,
  respondidas = [],
  aoResponder,
  aoDispensar,
  historias,
  podeCorrigir = false,
}: PerguntasEmAbertoProps) {
  const { t } = useTranslation('sessionPage');
  const abertas = new Set(perguntas.map((p) => p.questionId));
  const jaRespondidas = respondidas.filter((p) => !abertas.has(p.questionId));
  if (perguntas.length === 0 && jaRespondidas.length === 0) return null;
  return (
    <section
      id={ID_DA_FILA_DE_PERGUNTAS}
      className={styles.fila}
      aria-label={t('pendencias.filas.perguntas')}
      data-testid="fila-perguntas-em-aberto"
    >
      <h4 className={styles.filaTitulo}>
        {t('pendencias.filas.perguntas')}
        <span className={styles.contagem}>{total}</span>
      </h4>
      {perguntas.map((p) => (
        <CartaoDaPergunta
          key={p.questionId}
          projectId={projectId}
          pergunta={p}
          tarefas={tarefas}
          aoResponder={aoResponder}
        />
      ))}
      {jaRespondidas.map((p) => (
        <CartaoRespondido
          key={p.questionId}
          projectId={projectId}
          pergunta={p}
          historias={historias}
          podeCorrigir={podeCorrigir}
          aoDispensar={aoDispensar}
        />
      ))}
      {total > perguntas.length && (
        <p className={styles.recorte}>
          {t('pendencias.perguntas.recorte', { mostradas: perguntas.length, total })}
        </p>
      )}
    </section>
  );
}

function CartaoDaPergunta({
  projectId,
  pergunta,
  tarefas,
  aoResponder,
}: {
  projectId: string;
  pergunta: OpenQuestion;
  tarefas?: readonly Task[];
  aoResponder?: (pergunta: OpenQuestion) => void;
}) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState<'resposta' | 'sugestao' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const eAutor = pergunta.autorDaSessao !== null && pergunta.autorDaSessao === userIdDaSessao();

  const afeta = [
    pergunta.afeta.regras.length > 0 &&
      t('pendencias.perguntas.afetaRegras', { count: pergunta.afeta.regras.length }),
    pergunta.afeta.historias.length > 0 &&
      t('pendencias.perguntas.afetaHistorias', { count: pergunta.afeta.historias.length }),
    pergunta.afeta.tarefas.length > 0 &&
      t('pendencias.perguntas.afetaTarefas', { count: pergunta.afeta.tarefas.length }),
  ].filter(Boolean);
  const esperando = pergunta.afeta.tarefas
    .map((id) => tarefas?.find((task) => task.id === id))
    .filter((task): task is Task => !!task);

  async function responder(corpo: { resposta: string } | { aceitarSugestao: true }) {
    setEnviando('resposta' in corpo ? 'resposta' : 'sugestao');
    setErro(null);
    try {
      await answerOpenQuestion(projectId, pergunta.questionId, corpo);
      aoResponder?.(pergunta);
      // Sucesso: a releitura tira a pergunta da fila.
      void queryClient.invalidateQueries({ queryKey: ['open-questions', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['backlog', projectId] });
    } catch (e) {
      setErro(mensagemDaApi(e, t('pendencias.perguntas.erro')));
      // 409 (já respondida): a fila se refaz e diz a verdade.
      void queryClient.invalidateQueries({ queryKey: ['open-questions', projectId] });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className={styles.grupo} data-testid="pergunta-em-aberto">
      <div className={styles.origem}>
        {t('pendencias.perguntas.origem', {
          agente: nomeDoAgente(pergunta.autor),
          tempo: formatRelativeTime(pergunta.criadaEm),
        })}
      </div>
      <p>{pergunta.pergunta}</p>
      {afeta.length > 0 && (
        <p className={styles.nota}>
          {t('pendencias.perguntas.afeta')} {afeta.join(' · ')}
        </p>
      )}
      {esperando.map((task) => (
        <p key={task.id} className={styles.nota} data-testid="tarefa-esperando-resposta">
          {t('pendencias.perguntas.esperando', { tarefa: task.title })}
        </p>
      ))}
      {pergunta.sugestao && (
        <p className={styles.nota}>
          {t('pendencias.perguntas.sugestao')} {pergunta.sugestao}
        </p>
      )}
      <div className={styles.acoesDaLinha}>
        {pergunta.sugestao && (
          <Button
            variant="secondary"
            disabled={!eAutor || enviando !== null}
            loading={enviando === 'sugestao'}
            onClick={() => void responder({ aceitarSugestao: true })}
          >
            {t('pendencias.perguntas.aceitar')}
          </Button>
        )}
        <input
          type="text"
          className={styles.campo}
          value={texto}
          maxLength={TETO_DA_RESPOSTA}
          disabled={!eAutor || enviando !== null}
          aria-label={t('pendencias.perguntas.campo')}
          placeholder={t('pendencias.perguntas.campo')}
          autoComplete="off"
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button
          variant="primary"
          disabled={!eAutor || enviando !== null || texto.trim() === ''}
          loading={enviando === 'resposta'}
          onClick={() => void responder({ resposta: texto.trim() })}
        >
          {t('pendencias.perguntas.responder')}
        </Button>
      </div>
      {!eAutor && <p className={styles.nota}>{t('pendencias.perguntas.soOAutor')}</p>}
      {erro && (
        <p className={styles.erro} role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * RN-884 (AT-538, decisão do dono de 14/10): a pergunta respondida AQUI fica
 * na fila como cartão respondido, e cada história afetada que ainda é
 * corrigível (`draft`, sem tarefa em execução — a régua da RN-727) ganha
 * "Corrigir a história", que leva à aba Histórias com ela aberta. NÃO aciona
 * o PO. Não corrigível: o botão não existe e o motivo é dito em TEXTO
 * (RN-102). História que o backlog não traz não é nomeada nem oferecida.
 */
export function CartaoRespondido({
  projectId,
  pergunta,
  historias,
  podeCorrigir,
  aoDispensar,
}: {
  projectId: string;
  pergunta: OpenQuestion;
  historias?: readonly Story[];
  podeCorrigir: boolean;
  aoDispensar?: (questionId: string) => void;
}) {
  const { t } = useTranslation('sessionPage');
  const { t: tBacklog } = useTranslation('backlog');
  const afetadas = pergunta.afeta.historias
    .map((id) => historias?.find((s) => s.id === id))
    .filter((s): s is Story => !!s);
  return (
    <div className={styles.grupo} data-testid="pergunta-respondida">
      <p>{pergunta.pergunta}</p>
      <p className={styles.nota}>{t('pendencias.perguntas.respondida')}</p>
      {afetadas.map((story) => {
        const inerte = motivoDeCorrecaoInerte(story, podeCorrigir);
        return (
          <div key={story.id} className={styles.acoesDaLinha}>
            <span className={styles.nota}>
              {t('pendencias.perguntas.corrigirHistoria', { titulo: story.title })}
            </span>
            {inerte ? (
              <span className={styles.nota} data-testid="corrigir-historia-inerte">
                {tBacklog(inerte.chave, { count: inerte.count })}
              </span>
            ) : (
              <a
                href={`/projects/${projectId}?tab=backlog&historia=${encodeURIComponent(story.id)}`}
                data-testid="corrigir-historia"
              >
                {t('pendencias.perguntas.corrigir')}
              </a>
            )}
          </div>
        );
      })}
      {aoDispensar && (
        <div className={styles.acoesDaLinha}>
          <Button variant="ghost" onClick={() => aoDispensar(pergunta.questionId)}>
            {t('pendencias.perguntas.dispensar')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * RN-861: o aviso junto de "Estou pronto" e "Confirmar arquitetura pronta".
 * Lê a MESMA query da fila (cache compartilhado, sem poll) e só AVISA — os
 * botões de prontidão seguem habilitados (decisão do dono, ADR 0214).
 */
export function AvisoDePerguntasEmAberto({
  projectId,
  classeDaLinha,
  classeDoTexto,
}: {
  projectId: string | undefined;
  classeDaLinha?: string;
  classeDoTexto?: string;
}) {
  const { t } = useTranslation('sessionPage');
  const n = usePerguntasEmAberto(projectId).data?.total ?? 0;
  if (n === 0) return null;
  return (
    <div className={classeDaLinha} data-testid="aviso-perguntas-em-aberto">
      <span className={classeDoTexto}>{t('composer.perguntasEmAberto', { count: n })}</span>
      <Button variant="secondary" onClick={rolarAteAsPerguntas}>
        {t('composer.responderPerguntas')}
      </Button>
    </div>
  );
}
