import type {
  SessionEvent,
  StructuredQuestionAnsweredPayload,
  StructuredQuestionPayload,
} from './api-types';

/**
 * RN-712: ao responder um formulário estruturado, a api grava
 * `chat.structured_question_answered` E reenvia as respostas ao agente como
 * `chat.message` do usuário, no texto `"<n>. <rótulo>: <resposta>"` por linha
 * (`answer-structured-question.use-case.ts`). O card respondido já mostra as
 * respostas — este é o conjunto de ids dessas mensagens-eco, para o fio não
 * mostrar a mesma resposta duas vezes. O casamento é EXATO (mesmo texto que a
 * api monta, primeira `chat.message` de usuário depois da resposta): mensagem
 * digitada que por acaso pareça uma lista continua no fio.
 */
export function ecosDeRespostaEstruturada(events: SessionEvent[]): Set<string> {
  const ecos = new Set<string>();
  for (const resposta of events) {
    if (resposta.type !== 'chat.structured_question_answered') continue;
    const { questionSetId, answers } =
      (resposta.payload as StructuredQuestionAnsweredPayload) ?? {};
    const pergunta = events.find((e) => e.id === questionSetId);
    const questions = (pergunta?.payload as StructuredQuestionPayload | undefined)?.questions;
    if (!Array.isArray(questions) || !answers) continue;
    const texto = questions
      .map((q, i) => `${i + 1}. ${q.label}: ${answers[q.id]}`)
      .join('\n');
    const eco = events.find(
      (e) =>
        e.seq > resposta.seq &&
        e.type === 'chat.message' &&
        e.actor.kind === 'user' &&
        (e.payload as { text?: unknown })?.text === texto,
    );
    if (eco) ecos.add(eco.id);
  }
  return ecos;
}
