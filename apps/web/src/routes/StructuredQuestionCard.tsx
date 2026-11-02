import { useState } from 'react';
import { SEM_AUTOFILL } from '../lib/conversa-comecou';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { answerStructuredQuestion, mensagemDaApi } from '../lib/api-client';
import { ehRecusaDeSessaoEncerrada } from '../lib/sessao-encerrada';
import { chaveDoIdiomaDaSessao } from '../lib/idioma-da-resposta';
import type { StructuredQuestion } from '../lib/api-types';
import { useToast } from '../components/ui/ToastProvider';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { Card } from '../components/ui/Card';
import { Textarea } from '../components/shadcn/textarea';
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '../components/shadcn/questionnaire';
import { MarkdownInline } from '../components/ui/MarkdownMessage';
import { textoPlanoDoMarkdown } from '../lib/texto-plano';
import { corDoAgente, nomeDoAgente } from '../lib/agents';
import { ChatIcon } from '../components/ui/icons';
import styles from './SessionPage.module.css';

/** RN-171: `select` aceita resposta fora da lista, e ausente vale `true` —
 *  evento gravado antes da regra não tem a chave, e a leitura permissiva é a
 *  mesma escolha que o engine faz ao normalizar. */
function permiteOutra(q: StructuredQuestion): boolean {
  return q.type === 'select' && q.allowOther !== false;
}

/**
 * Card de `chat.structured_question` (RN-162) — o formulário que o Criativo
 * (e o PO, RN-164) pede quando faz VÁRIAS perguntas de uma vez, em vez de
 * texto livre que o usuário responderia item por item. `type` decide o input:
 * `text`→`Input`, `textarea`→`Textarea`, `select`→`Select` com `options`.
 *
 * RN-171 — duas coisas mudaram depois do uso real:
 *
 * 1. **O card é uma FALA do agente.** Antes ele nascia encostado à esquerda,
 *    sem avatar e com teto de 480px, enquanto as bolhas começam 45px adentro
 *    e o `ApprovalCard` no fio centraliza com teto de 560px — resultado: a
 *    pergunta ficava torta em relação a tudo à volta. Agora ela é centralizada
 *    com o MESMO teto de 560px do card de aprovação (é a mesma natureza: uma
 *    caixa que pede algo ao usuário) e carrega o avatar e a cor do agente, que
 *    é o que a faz ler como fala de alguém e não como um formulário avulso.
 * 2. **`select` tem saída por texto livre.** O relato foi literal — "sempre dê
 *    a opção de input do usuário quando ele seleciona Escreva": o modelo
 *    ofereceu uma opção do tipo "Escreva você mesmo" e não havia onde
 *    escrever. Escolher "Outra (escrever)" troca o `Select` por um `Input`, e
 *    o que viaja é o TEXTO — o sentinela nunca sai daqui.
 *
 * `completo` continua exigindo TODAS as perguntas, e não por conservadorismo:
 * `AnswerStructuredQuestionUseCase` recusa com 400 listando o que falta, então
 * um botão habilitado com campo vazio só produziria um erro do servidor. O que
 * mudou é que estar em "Outra" com o texto ainda vazio NÃO conta como
 * preenchido.
 *
 * Depois de enviado, o card vira SOMENTE LEITURA (`respondida`, derivado de
 * existir um `chat.structured_question_answered` posterior com o mesmo
 * `questionSetId` — o mesmo padrão de "resolvida" que o card de promoção de
 * história já usa) — reenviar não é possível, nem tentando de novo: o
 * backend recusa com 409 (`AnswerStructuredQuestionUseCase`), e aqui o
 * formulário nem chega a aparecer.
 */
export function StructuredQuestionCard({
  projectId,
  sessionId,
  agent,
  questionSetId,
  questions,
  respondida,
  respostasExistentes,
  onTurnoIniciado,
  onTurnoAceito,
  onTurnoTerminado,
}: {
  projectId: string;
  sessionId: string;
  agent: string;
  questionSetId: string;
  questions: StructuredQuestion[];
  respondida: boolean;
  respostasExistentes: Record<string, string> | undefined;
  /**
   * RN-174 — responder o formulário INICIA um turno de agente
   * (`AnswerStructuredQuestionUseCase` reusa `SendAgentMessageUseCase`), e
   * quem sabe disso é o card. Sem avisar a página, nada no fio dizia que
   * alguém estava trabalhando: o indicador de "pensando" depende de
   * `streaming`/`statusAgent`, e este caminho não ligava nenhum dos dois.
   */
  onTurnoIniciado: () => void;
  /**
   * ADR 0163 (RN-578) — a api ACEITOU as respostas e o turno segue no engine.
   * A chamada resolve no aceite, não no fim do turno; quem sabe acompanhar o
   * fim (canal + leitura do log) é a página.
   */
  onTurnoAceito: () => void;
  /** A chamada falhou ou foi recusada: desfaz o arme de `onTurnoIniciado`. */
  onTurnoTerminado: () => void;
}) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  if (respondida) {
    return (
      <Card radius="md" className={styles.structuredQuestionCard} style={corDoAgente(agent)}>
        <span className={styles.structuredQuestionCabecalho}>
          <AvatarDoAgente id={agent} />
          <span className={styles.handoffPill}>
            <ChatIcon size={13} />
            {t('perguntas.respondidas', { agente: nomeDoAgente(agent) })}
          </span>
        </span>
        <dl className={styles.structuredQuestionAnswers}>
          {questions.map((q) => (
            <div key={q.id} className={styles.structuredQuestionAnswerRow}>
              <dt><MarkdownInline text={q.label} /></dt>
              <dd>{respostasExistentes?.[q.id] ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  }

  // `respostas[q.id]` guarda SEMPRE a resposta final — inclusive no modo
  // "Outra", em que ela é o texto digitado. Por isso a regra não precisa
  // conhecer o sentinela: pergunta em "Outra" com texto vazio simplesmente
  // não está preenchida, que é o resultado certo.
  const completo = questions.every((q) => (respostas[q.id] ?? '').trim() !== '');

  async function handleSubmit() {
    if (enviando || !completo) return;
    setEnviando(true);
    // RN-174: o turno começa AQUI, antes do `await` — o indicador precisa
    // estar de pé quando o `agent.status` do canal chegar.
    onTurnoIniciado();
    try {
      await answerStructuredQuestion(projectId, sessionId, agent, questionSetId, respostas);
      // ADR 0163 (RN-578): resolver é o ACEITE. Até lá a chamada segurava o
      // turno inteiro (97,3 s medidos numa instalação real) e o `finally`
      // tratava "resolveu" como "o turno acabou".
      onTurnoAceito();
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      // RN-624: as respostas são evidência do idioma de quem respondeu.
      void queryClient.invalidateQueries({ queryKey: chaveDoIdiomaDaSessao(projectId, sessionId) });
      showToast({ title: t('perguntas.respostasEnviadas'), tone: 'success' });
    } catch (erro) {
      onTurnoTerminado();
      // AT-154 (RN-581): a sessão fechou. As respostas continuam nos campos
      // (o estado é deste card); a tela diz por quê e refaz a leitura da sessão.
      if (ehRecusaDeSessaoEncerrada(erro)) {
        showToast({ title: t('toasts.sessaoEncerrada'), tone: 'danger' });
        queryClient.invalidateQueries({ queryKey: ['session', projectId, sessionId] });
        queryClient.invalidateQueries({ queryKey: ['sessions', projectId] });
        return;
      }
      showToast({
        title: mensagemDaApi(erro, t('perguntas.erroEnviar')),
        tone: 'danger',
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card radius="md" className={styles.structuredQuestionCard} style={corDoAgente(agent)}>
      <span className={styles.structuredQuestionCabecalho}>
        <AvatarDoAgente id={agent} />
        <span className={styles.handoffPill}>
          <ChatIcon size={13} />
          {t('perguntas.titulo', { agente: nomeDoAgente(agent) })}
        </span>
      </span>
      {/* AT-653 (RN-968): um passo por pergunta. O estado segue controlado aqui
          (`respostas`), nunca por FormData: é ele que mantém as respostas na
          tela no 409 `sessao_encerrada` e garante o mesmo payload. */}
      <Questionnaire
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        onKeyDown={(e) => {
          // RN-830: Enter que confirma a composição do IME não avança nem envia.
          if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
        }}
      >
        <QuestionnaireProgress
          aria-label={t('perguntas.progressoRotulo')}
          render={(props, state) => (
            <div
              {...props}
              aria-valuetext={t('perguntas.progresso', { atual: state.current, total: state.total })}
            >
              {t('perguntas.progresso', { atual: state.current, total: state.total })}
            </div>
          )}
        />
        {questions.map((q) => {
          const value = respostas[q.id] ?? '';
          const atualizar = (v: string) => setRespostas((atual) => ({ ...atual, [q.id]: v }));
          const titulo = (
            <QuestionnaireTitle>
              <MarkdownInline text={q.label} />
            </QuestionnaireTitle>
          );

          if (q.type === 'select') {
            const daLista = q.options.includes(value);
            return (
              <QuestionnaireItem key={q.id} name={q.id} required disabled={enviando}>
                {titulo}
                <QuestionnaireChoices>
                  {q.options.map((opcao) => (
                    <QuestionnaireChoice
                      key={opcao}
                      value={opcao}
                      checked={value === opcao}
                      onChange={() => atualizar(opcao)}
                    >
                      {opcao}
                    </QuestionnaireChoice>
                  ))}
                  {/* RN-171: a saída por texto livre é um campo ao lado das
                      opções; escrever nele é a resposta. */}
                  {permiteOutra(q) && (
                    <QuestionnaireInput
                      aria-label={t('perguntas.suaResposta', { pergunta: textoPlanoDoMarkdown(q.label) })}
                      value={daLista ? '' : value}
                      {...SEM_AUTOFILL}
                      onChange={(e) => atualizar(e.target.value)}
                    />
                  )}
                </QuestionnaireChoices>
              </QuestionnaireItem>
            );
          }

          return (
            <QuestionnaireItem key={q.id} name={q.id} required disabled={enviando}>
              {titulo}
              <QuestionnaireInput
                value={value}
                {...SEM_AUTOFILL}
                onChange={(e) => atualizar(e.target.value)}
                {...(q.type === 'textarea' ? { render: <Textarea /> } : {})}
              />
            </QuestionnaireItem>
          );
        })}
        <QuestionnaireActions>
          <QuestionnairePrevious>{t('perguntas.anterior')}</QuestionnairePrevious>
          <QuestionnaireNext>{t('perguntas.proxima')}</QuestionnaireNext>
          <QuestionnaireSubmit variant="success" disabled={!completo || enviando}>
            {t('perguntas.enviarRespostas')}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </Card>
  );
}
