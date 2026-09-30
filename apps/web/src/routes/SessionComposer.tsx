import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { getSession } from '../lib/api-client';
import { addressableAgents, nomeDoAgente } from '../lib/agents';
import type { Handoff } from '../lib/api-types';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { sessaoEhTerminal } from '../lib/sessao-encerrada';
import styles from './SessionPage.module.css';

/**
 * A faixa de baixo da coluna de chat da Sessão, que não rola: o card do
 * handoff da Infra (RN-499), o handoff manual a agente à escolha (ADR
 * 0109/RN-440) e o composer com os botões de prontidão (RN-160/RN-161,
 * RN-406) — ou, com a sessão fora de `active`, o convite a ativá-la.
 *
 * Moveu de `SessionPage.tsx` no PR 5 do programa do ADR 0176, sem mudar uma
 * linha do JSX: o rascunho, os handlers e as derivações continuam donos do
 * `SessionPage`, e chegam aqui com os MESMOS nomes que o bloco lia do escopo
 * dele.
 */
export interface SessionComposerProps {
  isActive: boolean;
  handoffDaInfraOferecido: Handoff | undefined;
  handleAcceptHandoff: (handoffId: string, toAgent: string) => Promise<void>;
  /** RN-631: a quem a mensagem pode ir, e a quem vai. */
  opcoesDeDestinatario: string[];
  destinatario: string | null;
  precisaEscolherDestinatario: boolean;
  escolherDestinatario: (agente: string) => void;
  manualHandoffTarget: string;
  setManualHandoffTarget: Dispatch<SetStateAction<string>>;
  enviandoHandoffManual: boolean;
  activeFor: (agent: string) => boolean;
  handleRequestManualHandoff: () => Promise<void>;
  session: Awaited<ReturnType<typeof getSession>> | undefined;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  handleComposerKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  streaming: boolean;
  handleSend: () => Promise<void>;
  handleCancel: () => Promise<void>;
  criativoActive: boolean;
  prontidaoJaDeclarada: boolean;
  handleReadiness: () => Promise<void>;
  hasBusinessRule: boolean;
  arquitetoActive: boolean;
  arquiteturaJaDeclarada: boolean;
  handleArchitectureReadiness: () => Promise<void>;
  hasPromotedStory: boolean;
  necessidadeJaValidada: boolean;
  validandoNecessidade: boolean;
  handleValidateNecessity: () => Promise<void>;
  hasProductBrief: boolean;
  handleActivate: () => Promise<void>;
}

export function SessionComposer({
  isActive,
  handoffDaInfraOferecido,
  handleAcceptHandoff,
  opcoesDeDestinatario,
  destinatario,
  precisaEscolherDestinatario,
  escolherDestinatario,
  manualHandoffTarget,
  setManualHandoffTarget,
  enviandoHandoffManual,
  activeFor,
  handleRequestManualHandoff,
  session,
  draft,
  setDraft,
  handleComposerKeyDown,
  streaming,
  handleSend,
  handleCancel,
  criativoActive,
  prontidaoJaDeclarada,
  handleReadiness,
  hasBusinessRule,
  arquitetoActive,
  arquiteturaJaDeclarada,
  handleArchitectureReadiness,
  hasPromotedStory,
  necessidadeJaValidada,
  validandoNecessidade,
  handleValidateNecessity,
  hasProductBrief,
  handleActivate,
}: SessionComposerProps) {
  const { t } = useTranslation('sessionPage');
  return (
    <>
      {/*
        O card ACIONÁVEL do handoff da Infra (RN-499). Ele mora AQUI, na
        faixa entre o fio e o composer, e não dentro da timeline, por
        três razões:

        1. Esta faixa já é o lugar declarado das ações de handoff que
           NÃO são conversa — o seletor logo abaixo (ADR 0109/RN-440)
           fica "FORA do `.composer` de propósito — não é uma ação de
           conversa, é redirecionamento". Aceitar a Infra é exatamente
           isso: não abre fio nenhum, ativa um agente propositivo.
        2. O card do fio pertence a um EVENTO (`handoff.offered`), e o
           evento da Infra continua sendo NARRADO lá como divisor mudo,
           sem mudança — o filtro `AGENTES_DE_CHAT` da RN-136 fica
           intacto, e nenhum handoff conversacional muda de forma.
        3. A faixa não rola. A oferta da Infra sai da janela de 200
           eventos numa sessão longa, e um botão que só existe enquanto
           o evento estiver visível é um botão que some sozinho.

        O que o texto tem de dizer é a CONSEQUÊNCIA do clique, porque
        ela não é óbvia: o Infra Lead assume e vai PROPOR a subida do
        container — proposta que ainda passa pelo pipeline de aprovação
        de sempre (`container_start`, `maintainer`, RN-491). Aceitar não
        sobe container nenhum.
      */}
      {isActive && handoffDaInfraOferecido && (
        <div className={styles.infraHandoffRow}>
          <div className={styles.infraHandoffTexto}>
            <span className={styles.infraHandoffTitulo}>
              {t('handoff.infraTitulo', {
                de: nomeDoAgente(handoffDaInfraOferecido.fromAgent),
              })}
            </span>
            <span className={styles.infraHandoffDetalhe}>
              {t('handoff.infraDetalhe')}
            </span>
          </div>
          <Button
            variant="success"
            onClick={() =>
              handleAcceptHandoff(
                handoffDaInfraOferecido.id,
                handoffDaInfraOferecido.toAgent,
              )
            }
          >
            {t('handoff.infraBotao')}
          </Button>
        </div>
      )}

      {/*
        Handoff manual a agente à escolha (ADR 0109/RN-440): a cadeia
        fixa (Criativo→PO→Arquiteto→Dev Lead…) continua sendo o caminho
        normal — este seletor existe para o caso que ela não cobre, o
        Staff (ADR 0088) e agora também `ux-designer` sendo o exemplo
        real: agentes com código pronto no engine, sem NENHUM jeito de
        um humano chegar até eles pela tela. Fica FORA do `.composer`
        de propósito — não é uma ação de conversa, é redirecionamento.
        `activeFor` (não `AGENTES_DE_CHAT`) filtra quem já entrou nesta
        sessão alguma vez, pro mesmo agente não ser oferecido duas
        vezes.
      */}
      {isActive && (
        <div className={styles.manualHandoffRow}>
          <Select
            aria-label={t('handoff.manualLabel')}
            value={manualHandoffTarget}
            disabled={enviandoHandoffManual}
            onChange={(e) => setManualHandoffTarget(e.target.value)}
          >
            <option value="">{t('handoff.manualPlaceholder')}</option>
            {addressableAgents()
              .filter((agente) => !activeFor(agente))
              .map((agente) => (
                <option key={agente} value={agente}>
                  {nomeDoAgente(agente)}
                </option>
              ))}
          </Select>
          <Button
            variant="secondary"
            loading={enviandoHandoffManual}
            disabled={!manualHandoffTarget}
            onClick={handleRequestManualHandoff}
          >
            {t('handoff.manualBotao')}
          </Button>
        </div>
      )}

      {session?.status === 'active' ? (
        <>
        {/*
          O destinatário da mensagem, VISÍVEL e escolhido (RN-631, AT-251).
          Antes ele não aparecia em lugar nenhum: era "o último agente
          ativado na janela de 200 eventos", e um handoff aceito por outro
          caminho trocava a quem a próxima mensagem ia sem a pessoa ver.
          Agora a linha nomeia quem recebe ANTES do envio; com duas ou mais
          opções e nenhuma escolha, o envio trava e o motivo é dito em TEXTO
          (tooltip em botão desabilitado não abre).
        */}
        <div className={styles.destinatarioRow} data-testid="destinatario-do-chat">
          {opcoesDeDestinatario.length === 0 ? (
            <span className={styles.destinatarioAviso}>{t('composer.semAgente')}</span>
          ) : (
            <>
              <label className={styles.destinatarioLabel} htmlFor="destinatario-do-chat">
                {t('composer.destinatarioLabel')}
              </label>
              <Select
                id="destinatario-do-chat"
                value={destinatario ?? ''}
                disabled={streaming}
                onChange={(e) => {
                  if (e.target.value) escolherDestinatario(e.target.value);
                }}
              >
                {destinatario === null && (
                  <option value="" disabled>
                    {t('composer.destinatarioPlaceholder')}
                  </option>
                )}
                {opcoesDeDestinatario.map((agente) => (
                  <option key={agente} value={agente}>
                    {nomeDoAgente(agente)}
                  </option>
                ))}
              </Select>
              {precisaEscolherDestinatario && (
                <span className={styles.destinatarioAviso}>
                  {t('composer.destinatarioPrecisaEscolher')}
                </span>
              )}
            </>
          )}
        </div>
        <div className={`${styles.composer} ${styles.composerComDestinatario}`}>
          <textarea
            className={styles.textarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={t('composer.placeholder')}
            disabled={streaming}
          />
          <Button
            onClick={handleSend}
            disabled={streaming || !draft.trim() || precisaEscolherDestinatario}
          >
            {t('composer.enviar')}
          </Button>
          {/* RN-122: só existe (habilitado) enquanto há turno em curso —
              fora disso não há o que parar. */}
          {streaming && (
            <Button variant="danger" onClick={handleCancel}>
              {t('composer.parar')}
            </Button>
          )}
          {/*
            Some depois que o Criativo passou a bola (achado L). O botão
            dependia só de o Criativo estar ativo, e continuava oferecendo
            "Estou pronto para produzir" DEPOIS do handoff — convidando a
            declarar de novo uma prontidão que já foi declarada, e cuja
            consequência (o handoff para o PO) já está na tela.
          */}
          {criativoActive && !prontidaoJaDeclarada && (
            <Button
              variant="success"
              onClick={handleReadiness}
              disabled={streaming || !hasBusinessRule}
              title={
                !hasBusinessRule
                  ? t('composer.prontoParaProduzirDesabilitado')
                  : undefined
              }
            >
              {t('composer.prontoParaProduzir')}
            </Button>
          )}
          {/*
            Mirror do botão acima, para o Arquiteto (achado do problema 1)
            — some depois que ele já ofereceu o handoff, pelo mesmo motivo
            que o do Criativo some depois de `prontidaoJaDeclarada`.
          */}
          {arquitetoActive && !arquiteturaJaDeclarada && (
            <Button
              variant="success"
              onClick={handleArchitectureReadiness}
              disabled={streaming || !hasPromotedStory}
              title={
                !hasPromotedStory
                  ? t('composer.confirmarArquiteturaDesabilitado')
                  : undefined
              }
            >
              {t('composer.confirmarArquitetura')}
            </Button>
          )}
          {/*
            Gate `necessidade-validada` (RN-406, ADR 0095): confirmação
            humana SEPARADA de "Estou pronto para produzir" — este botão
            só existe para não deixar o Criativo (o modelo) se
            autovalidar (`modelo-de-time.md`, anti-padrão registrado).
            Habilita só DEPOIS que o product_brief já existe (não dá pra
            "validar" algo que ainda não foi consolidado) e some assim
            que já foi validada.
          */}
          {criativoActive && !necessidadeJaValidada && (
            <Button
              variant="success"
              loading={validandoNecessidade}
              onClick={handleValidateNecessity}
              disabled={streaming || !hasProductBrief}
              title={
                !hasProductBrief
                  ? t('composer.confirmarNecessidadeDesabilitado')
                  : undefined
              }
            >
              {t('composer.confirmarNecessidade')}
            </Button>
          )}
        </div>
        </>
      ) : (
        <div className={styles.activatePrompt}>
          {sessaoEhTerminal(session?.status) && draft.trim() !== '' && (
            <textarea
              className={styles.textarea}
              value={draft}
              readOnly
              aria-label={t('ativacao.mensagemNaoEnviada')}
            />
          )}
          {session?.status === 'created' ? (
            <>
              {t('ativacao.naoAtivada')}
              <Button onClick={handleActivate}>{t('ativacao.ativarSessao')}</Button>
            </>
          ) : (
            <span>{t('ativacao.statusGenerico', { status: session?.status })}</span>
          )}
        </div>
      )}
    </>
  );
}
