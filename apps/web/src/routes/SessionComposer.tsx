import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { SEM_AUTOFILL } from '../lib/conversa-comecou';
import { useTranslation } from 'react-i18next';
import { getSession } from '../lib/api-client';
import { addressableAgents, nomeDoAgente } from '../lib/agents';
import type { Handoff } from '../lib/api-types';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { sessaoEhTerminal } from '../lib/sessao-encerrada';
import { agentesParaChamar } from '../lib/session-destinatario';
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
  /** RN-631: ofertas pendentes cujo `handoff.offered` saiu da janela do fio. */
  ofertasForaDaJanela?: Handoff[];
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
  /**
   * RN-673: com turno em curso, a mensagem a um agente entra na FILA dele — o
   * campo e o botão seguem abertos (o botão vira "Pôr na fila"). Falso no chat
   * sem agente, onde não há fila: lá o turno em curso continua travando.
   */
  podeEnfileirar: boolean;
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
  handleActivate: () => Promise<void>;
  /**
   * ADR 0183 (RN-650): reabrir sessão encerrada. `podeReabrir` é o papel
   * (`maintainer`, por `roleAtLeast`); sem ele o botão fica inerte e o motivo
   * é dito em TEXTO.
   */
  podeReabrir?: boolean;
  reabrindo?: boolean;
  handleReopen?: () => Promise<void>;
}

export function SessionComposer({
  isActive,
  handoffDaInfraOferecido,
  ofertasForaDaJanela = [],
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
  podeEnfileirar,
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
  handleActivate,
  podeReabrir = false,
  reabrindo = false,
  handleReopen,
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
        ela não é óbvia. Desde a RN-671 (ADR 0190) o aceite SEMEIA
        `container_start: auto_approve` e o servidor do Infra Lead propõe
        a subida no kickoff (projeto `container`/`mounted` com roteamento
        do Arquiteto) — ela executa sem passar por Aprovações. Seguem com
        o humano: `container_start_via_runner` (modo `runner`) e o merge
        da PR de infra (branch protegida). O texto antigo prometia que a
        subida "ainda passa por você em Aprovações" (AT-348) — não volte
        a ele.
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
        A oferta cujo EVENTO saiu da janela de 200 (RN-631): o card
        acionável do fio pertence ao `handoff.offered`, e sem o evento a
        oferta ficava pendente e sem botão em lugar nenhum. Mora nesta
        faixa pelo mesmo motivo 3 do card da Infra acima: ela não rola.
        Só o aceite — o atalho "Ativar execução" do card do Dev Lead segue
        no fio, onde o evento dele estiver.
      */}
      {isActive &&
        ofertasForaDaJanela.map((oferta) => (
          <div
            key={oferta.id}
            className={styles.infraHandoffRow}
            data-oferta-fora-da-janela={oferta.id}
          >
            <div className={styles.infraHandoffTexto}>
              <span className={styles.infraHandoffTitulo}>
                {t('handoff.foraDaJanelaTitulo', {
                  de: nomeDoAgente(oferta.fromAgent),
                  para: nomeDoAgente(oferta.toAgent),
                })}
              </span>
              <span className={styles.infraHandoffDetalhe}>
                {t('handoff.foraDaJanelaDetalhe')}
              </span>
            </div>
            <Button
              variant="success"
              onClick={() => handleAcceptHandoff(oferta.id, oferta.toAgent)}
            >
              {t('handoff.aceitarEIniciar', { agente: nomeDoAgente(oferta.toAgent) })}
            </Button>
          </div>
        ))}

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

        Sem agente nenhum a quem a mensagem possa ir (a consultiva que
        ainda não chamou ninguém, RN-682) este seletor MUDA de lugar: vai
        para dentro da linha do destinatário, logo abaixo, porque ali ele
        deixa de ser redirecionamento e passa a ser a ÚNICA forma de a
        mensagem ter destinatário. Dois seletores iguais na mesma tela
        seria a mesma escolha em dois lugares.
      */}
      {isActive && opcoesDeDestinatario.length > 0 && (
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
            /*
              RN-682 (AT-254): sem agente, a mensagem NÃO vai a lugar
              nenhum. Até aqui ela ia ao modelo cru (o SSE de
              `POST .../chat`), sem histórico nem prompt de sistema, e a
              resposta saía assinada pelo nome do modelo. Agora a linha
              PEDE um agente e mostra quem pode ser chamado — os agentes
              que conversam (`AGENTES_DE_CHAT`) e ainda não estão na
              sessão —, e o envio fica travado. Chamar é o MESMO handoff
              manual de sempre (ADR 0109/RN-440): a oferta aparece no fio,
              e aceitá-la faz do agente o destinatário (RN-631).
            */
            <>
              <label className={styles.destinatarioLabel} htmlFor="destinatario-do-chat">
                {t('composer.destinatarioLabel')}
              </label>
              <Select
                id="destinatario-do-chat"
                value={manualHandoffTarget}
                disabled={enviandoHandoffManual || !isActive}
                onChange={(e) => setManualHandoffTarget(e.target.value)}
              >
                <option value="">{t('composer.destinatarioPlaceholder')}</option>
                {agentesParaChamar(activeFor).map((agente) => (
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
                {t('composer.chamarAgente')}
              </Button>
              <span className={styles.destinatarioAviso}>{t('composer.semAgente')}</span>
            </>
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
            {...SEM_AUTOFILL}
            placeholder={t('composer.placeholder')}
            disabled={streaming && !podeEnfileirar}
          />
          <Button
            onClick={handleSend}
            disabled={
              (streaming && !podeEnfileirar) || !draft.trim() || destinatario === null
            }
          >
            {streaming ? t('composer.enfileirar') : t('composer.enviar')}
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

            Desde o ADR 0185 o mesmo clique fecha os DOIS gates — a
            prontidão e a necessidade validada (RN-657) — e aceita em nome
            da pessoa o handoff ao PO que o Criativo oferecer (RN-658). O
            rótulo diz isso: é ele que faz do clique um julgamento de
            mérito, e não só o piso "≥1 regra" da RN-142.
          */}
          {criativoActive && !prontidaoJaDeclarada && (
            <Button
              variant="success"
              onClick={handleReadiness}
              disabled={streaming || !hasBusinessRule}
              title={
                !hasBusinessRule
                  ? t('composer.prontoParaProduzirDesabilitado')
                  : t('composer.prontoParaProduzirExplica')
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
          ) : sessaoEhTerminal(session?.status) && handleReopen ? (
            <>
              <span>{t('ativacao.statusGenerico', { status: session?.status })}</span>
              <span>{t('ativacao.reabrirExplicacao')}</span>
              <Button
                onClick={handleReopen}
                disabled={!podeReabrir}
                loading={reabrindo}
              >
                {t('ativacao.reabrir')}
              </Button>
              {!podeReabrir && <span>{t('ativacao.reabrirExigeDeveloper')}</span>}
            </>
          ) : (
            <span>{t('ativacao.statusGenerico', { status: session?.status })}</span>
          )}
        </div>
      )}
    </>
  );
}
