import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { answerStructuredQuestion, mensagemDaApi } from '../lib/api-client';
import type { StructuredQuestion } from '../lib/api-types';
import { useToast } from '../components/ui/ToastProvider';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Textarea } from '../components/ui/Textarea';
import { corDoAgente, nomeDoAgente } from '../lib/agents';
import { ChatIcon } from '../components/ui/icons';
import styles from './SessionPage.module.css';

/**
 * O valor que marca "quero escrever a minha própria resposta" no `Select`
 * (RN-171). É um SENTINELA de interface, nunca uma resposta: quem escolhe
 * troca o campo por um de texto, e o que viaja pro backend é o texto digitado.
 *
 * O prefixo `__` e o nome em português existem para nunca colidir com uma
 * `option` de verdade vinda do modelo — e, se colidisse, o efeito seria
 * abrir o campo de texto, não gravar o sentinela.
 */
const OUTRA_RESPOSTA = '__outra__';

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
  onTurnoTerminado: () => void;
}) {
  const { t } = useTranslation('sessionPage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  /**
   * Quais `select` estão em modo "texto livre" (RN-171). Estado SEPARADO de
   * `respostas` de propósito: `respostas` é o que vai pro backend, e o
   * sentinela nunca deve chegar lá — misturar os dois seria a única forma de
   * ele vazar.
   */
  const [modoOutra, setModoOutra] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState(false);

  if (respondida) {
    return (
      <div className={styles.structuredQuestionCard} style={corDoAgente(agent)}>
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
              <dt>{q.label}</dt>
              <dd>{respostasExistentes?.[q.id] ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </div>
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
    // RN-174: o turno começa AQUI, antes do `await` — a chamada é síncrona no
    // engine (o mesmo `SendAgentMessageUseCase` de `handleSend`) e pode levar
    // dezenas de segundos. Armar depois de ela resolver seria armar quando o
    // turno já acabou.
    onTurnoIniciado();
    try {
      await answerStructuredQuestion(projectId, sessionId, agent, questionSetId, respostas);
      await queryClient.invalidateQueries({ queryKey: ['session-events', projectId, sessionId] });
      showToast({ title: t('perguntas.respostasEnviadas'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('perguntas.erroEnviar')),
        tone: 'danger',
      });
    } finally {
      setEnviando(false);
      // Mesma rede de segurança de `handleSend`/`handleReadiness`: resolver
      // esta chamada é sinal de fim de turno tão confiável quanto o
      // `agent.done` do canal, e `finalizarTurnoDoAgente` é idempotente.
      onTurnoTerminado();
    }
  }

  return (
    <div className={styles.structuredQuestionCard} style={corDoAgente(agent)}>
      <span className={styles.structuredQuestionCabecalho}>
        <AvatarDoAgente id={agent} />
        <span className={styles.handoffPill}>
          <ChatIcon size={13} />
          {t('perguntas.titulo', { agente: nomeDoAgente(agent) })}
        </span>
      </span>
      <div className={styles.structuredQuestionForm}>
        {questions.map((q) => {
          const value = respostas[q.id] ?? '';
          const atualizar = (v: string) =>
            setRespostas((atual) => ({ ...atual, [q.id]: v }));

          if (q.type === 'textarea') {
            return (
              <Textarea
                key={q.id}
                label={q.label}
                value={value}
                disabled={enviando}
                onChange={(e) => atualizar(e.target.value)}
              />
            );
          }

          if (q.type === 'select') {
            // `htmlFor`/`id` explícitos: `Select` (design system) não tem a
            // prop `label` que `Input`/`Textarea` têm — sem a associação, um
            // leitor de tela não liga a pergunta ao campo.
            const selectId = `sq-${questionSetId}-${q.id}`;
            const emOutra = modoOutra[q.id] === true;
            // O que o `Select` MOSTRA. No modo "Outra" ele mostra o sentinela;
            // fora dele, a resposta — que só é uma das `options`, porque
            // qualquer outro caminho de escrita passa pelo modo "Outra".
            const selecionado = emOutra ? OUTRA_RESPOSTA : value;
            return (
              <div key={q.id} className={styles.structuredQuestionField}>
                <label className={styles.structuredQuestionFieldLabel} htmlFor={selectId}>
                  {q.label}
                </label>
                <Select
                  id={selectId}
                  value={selecionado}
                  disabled={enviando}
                  onChange={(e) => {
                    const escolha = e.target.value;
                    const outra = escolha === OUTRA_RESPOSTA;
                    setModoOutra((atual) => ({ ...atual, [q.id]: outra }));
                    // Entrar em "Outra" ZERA a resposta: o sentinela não é uma
                    // resposta, e deixar a opção anterior gravada faria o botão
                    // habilitar sem nada digitado.
                    atualizar(outra ? '' : escolha);
                  }}
                >
                  <option value="" disabled>
                    {t('perguntas.selecione')}
                  </option>
                  {q.options.map((opcao) => (
                    <option key={opcao} value={opcao}>
                      {opcao}
                    </option>
                  ))}
                  {/* RN-171: a saída por texto livre. Fica no FIM da lista, e
                      só existe quando a pergunta a permite (default do
                      engine: sim, para `select`). */}
                  {permiteOutra(q) && (
                    <option value={OUTRA_RESPOSTA}>{t('perguntas.outraEscrever')}</option>
                  )}
                </Select>
                {emOutra && (
                  // O rótulo repete a pergunta porque um formulário com dois
                  // `select` abertos teria dois campos chamados "Sua
                  // resposta" — indistinguíveis para quem usa leitor de tela.
                  <Input
                    label={t('perguntas.suaResposta', { pergunta: q.label })}
                    value={value}
                    disabled={enviando}
                    autoFocus
                    onChange={(e) => atualizar(e.target.value)}
                  />
                )}
              </div>
            );
          }

          return (
            <Input
              key={q.id}
              label={q.label}
              value={value}
              disabled={enviando}
              onChange={(e) => atualizar(e.target.value)}
            />
          );
        })}
      </div>
      <Button
        variant="success"
        loading={enviando}
        disabled={!completo || enviando}
        onClick={handleSubmit}
      >
        {t('perguntas.enviarRespostas')}
      </Button>
    </div>
  );
}
