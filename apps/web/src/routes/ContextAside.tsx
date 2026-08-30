import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Trans, useTranslation } from 'react-i18next';
import { useSessionEventHistory } from '../lib/hooks';
import { AGENTS, corDoAgente, nomeDoAgente } from '../lib/agents';
import { ordemDaAcaoNaTimeline } from '../lib/session-timeline';
import {
  montarArvoreDeBacklog,
  totalDeDescendentes,
  urlDaPr,
  type NoDeBacklog,
} from '../lib/session-backlog-tree';
import type { BusinessRulePayload, ProposedAction, SessionEvent } from '../lib/api-types';
import { ActivityFeed } from '../components/ActivityFeed';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { EventItem } from '../components/EventItem';
import { Skeleton } from '../components/ui/Skeleton';
import { AvatarDoAgente } from '../components/ui/AvatarDoAgente';
import { Disclosure } from '../components/ui/Disclosure';
import { PrIcon, StackIcon } from '../components/ui/icons';
import styles from './SessionPage.module.css';

/**
 * Um artefato do painel "Artefatos gerados" (RN-159) — PR (dev ou ADR do
 * Arquiteto) e épico/história do PO, na mesma lista, agrupados por QUEM
 * gerou. `ordenacao` usa o mesmo eixo de `ordemDaAcaoNaTimeline` (RN-155)
 * pras ações — nunca `action.seq` cru, pelo mesmo motivo documentado lá:
 * é um bigserial GLOBAL da tabela inteira, incomparável entre artefatos de
 * origens diferentes.
 */
interface ArtefatoGerado {
  key: string;
  actorId: string;
  node: ReactNode;
  ordenacao: number;
}

/** `pr_open` (PR de dev) e `open_adr_pr` (PR de ADR do Arquiteto) — os dois
 *  são "uma PR foi aberta", só o autor e o conteúdo mudam; o painel os
 *  mostra juntos, com o MESMO ícone. */
const CHAVE_TITULO_PADRAO_POR_TIPO_DE_PR: Partial<Record<ProposedAction['actionType'], string>> = {
  pr_open: 'artefatos.pullRequest',
  open_adr_pr: 'artefatos.adr',
};

/**
 * Um nó da árvore de backlog na tela (RN-179).
 *
 * A LINHA do nó continua sendo um link para o Backlog (RN-159) e o colapso dos
 * filhos vem ABAIXO dela, num `Disclosure` próprio — e não com o link dentro
 * do cabeçalho do colapso: cabeçalho de `Disclosure` é `<button>`, e um `<a>`
 * dentro de um `<button>` é HTML inválido e alvo de clique ambíguo. Assim
 * épico e história continuam navegando, e as tarefas nascem FECHADAS: um épico
 * com trinta tarefas ocuparia o painel inteiro sem que ninguém tivesse pedido.
 */
function ItemDeBacklog({
  projectId,
  no,
}: {
  projectId: string;
  no: NoDeBacklog;
}) {
  const { t } = useTranslation('sessionPage');
  return (
    <div className={styles.artefatoNo}>
      <Link
        to="/projects/$projectId"
        params={{ projectId }}
        search={{ tab: 'backlog' }}
        className={[styles.artefatoItem, styles.artefatoItemLink].join(' ')}
      >
        <StackIcon size={13} className={styles.artefatoItemIcone} />
        <span className={styles.artefatoItemTitulo}>
          {no.titulo ?? t('compartilhado.semTitulo')}
        </span>
      </Link>
      {no.filhos.length > 0 && (
        <Disclosure
          titulo={no.rotuloDosFilhosKey ? t(no.rotuloDosFilhosKey) : t('artefatos.itens')}
          trailing={no.filhos.length}
          classNameCabecalho={styles.artefatoFilhosCabecalho}
        >
          <div className={styles.artefatoFilhos}>
            {/* RN-178 vale aqui dentro também: o mais recente primeiro. */}
            {[...no.filhos]
              .sort((a, b) => b.evento.seq - a.evento.seq)
              .map((filho) => (
                <ItemDeBacklog key={filho.id} projectId={projectId} no={filho} />
              ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/** Quantas regras de negócio cabem numa página do painel (RN-178). */
const REGRAS_POR_PAGINA = 5;

export function ContextAside({
  projectId,
  sessionId,
  actions,
  pausarPoll,
  logOpen,
  onToggleLog,
  highlightEvent,
  citedEvent,
  citedEventMissing,
}: {
  projectId: string;
  sessionId: string;
  actions: ProposedAction[];
  pausarPoll: boolean;
  logOpen: boolean;
  onToggleLog: () => void;
  highlightEvent?: string;
  citedEvent?: SessionEvent;
  citedEventMissing?: boolean;
}) {
  const { t } = useTranslation('sessionPage');
  /**
   * RN-180 — o painel deixa de mentir sobre o teto.
   *
   * Antes ele recebia por prop os 200 últimos eventos (`useSessionEvents`) e
   * não tinha como dizer que havia mais: numa sessão de milhares, as quatro
   * seções mostravam um recorte da cauda como se fosse a sessão inteira. Agora
   * ele lê o MESMO histórico paginado que a aba de Atividade da Visão Geral já
   * usava (RN-099), com a `queryKey` da cauda compartilhada com o fio — ZERO
   * requisição a mais no ciclo de poll (RN-090/091).
   *
   * `baixados` (tudo que já veio) alimenta as seções derivadas e `events` (a
   * janela) alimenta o feed: as seções não paginam item a item, e cortá-las na
   * janela de 100 as faria mostrar MENOS do que mostravam antes desta mudança.
   */
  const historico = useSessionEventHistory(projectId, sessionId, 3000, pausarPoll);
  const events = historico.baixados;

  // Quantos eventos da sessão ficaram ANTES do que já foi baixado. Sai de
  // SUBTRAÇÃO sobre o `seq` (que é gapless e por sessão), nunca de uma
  // requisição a mais — o mesmo mecanismo do "+ N mais antigos" do sino
  // (RN-100).
  const eventosAnteriores = Math.max(0, (events[0]?.seq ?? 1) - 1);

  // RN-178: do último para o primeiro, nas quatro seções. Cópia antes do
  // `sort`: `baixados` é derivado do cache da query, e ordená-lo no lugar
  // reordenaria o que os outros consumidores leem.
  const businessRules = events
    .filter((e) => e.type === 'artifact.business_rule')
    .sort((a, b) => b.seq - a.seq);

  // RN-178: acima de 5 regras a lista pagina em vez de crescer sem fim — o
  // painel tem a altura de uma coluna, e uma sessão de ideação passa
  // facilmente de vinte regras.
  const [paginaDeRegras, setPaginaDeRegras] = useState(0);
  const totalDePaginas = Math.max(1, Math.ceil(businessRules.length / REGRAS_POR_PAGINA));
  // Clamp em vez de efeito: regra nova chegando pelo poll encurta a lista
  // (nunca) ou a alonga, e trocar de sessão a zera — um `useEffect` de
  // sincronização renderizaria uma vez com a página inválida antes de corrigir.
  const pagina = Math.min(paginaDeRegras, totalDePaginas - 1);
  const regrasDaPagina = businessRules.slice(
    pagina * REGRAS_POR_PAGINA,
    pagina * REGRAS_POR_PAGINA + REGRAS_POR_PAGINA,
  );

  // Artefatos gerados (RN-159): PR (dev ou ADR) + backlog do PO, numa lista
  // só, agrupada por AGENTE. module_map/C4 ficaram de FORA desta rodada —
  // decisão registrada no PR: os dois são estado VIGENTE do projeto (uma
  // versão corrente, sobrescrita a cada geração), não um artefato datado por
  // SESSÃO como PR/épico/história; a "Visão Geral" (`ProjectOverviewTab.tsx`)
  // já é o lugar deles, sem âncora própria hoje — adicionar uma seria fora do
  // escopo desta entrega.
  const artefatos: ArtefatoGerado[] = [];

  for (const a of actions) {
    if (a.actionType !== 'pr_open' && a.actionType !== 'open_adr_pr') continue;
    const titulo =
      (a.payload as { title?: string }).title ?? t(CHAVE_TITULO_PADRAO_POR_TIPO_DE_PR[a.actionType]!);
    const url = urlDaPr(a);
    artefatos.push({
      key: `pr-${a.id}`,
      actorId: a.actor.id,
      ordenacao: ordemDaAcaoNaTimeline(a, events),
      node: url ? (
        <a
          key={`pr-${a.id}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          className={[styles.artefatoItem, styles.artefatoItemLink].join(' ')}
        >
          <PrIcon size={13} className={styles.artefatoItemIcone} />
          <span className={styles.artefatoItemTitulo}>{titulo}</span>
        </a>
      ) : (
        <span key={`pr-${a.id}`} className={styles.artefatoItem}>
          <PrIcon size={13} className={styles.artefatoItemIcone} />
          <span className={styles.artefatoItemTitulo}>{titulo}</span>
        </span>
      ),
    });
  }

  // RN-179: a TAREFA entra no painel, e entra pendurada na história, que por
  // sua vez pende do épico. Antes só épico e história apareciam, lado a lado e
  // planos — o que o PO produziu de fato (a tarefa, que é o que um dev pega)
  // não deixava rastro nenhum aqui. Só as RAÍZES viram item da lista; os
  // descendentes vão dentro do colapso do pai.
  const arvoreDeBacklog = montarArvoreDeBacklog(events);
  for (const raiz of arvoreDeBacklog) {
    artefatos.push({
      key: `backlog-${raiz.evento.id}`,
      actorId: raiz.evento.actor.id,
      ordenacao: raiz.evento.seq,
      node: <ItemDeBacklog key={`backlog-${raiz.evento.id}`} projectId={projectId} no={raiz} />,
    });
  }

  // RN-178: o mais recente primeiro, aqui como nas outras seções.
  artefatos.sort((a, b) => b.ordenacao - a.ordenacao);

  // O contador do cabeçalho conta a ÁRVORE inteira, não só as raízes: dizer
  // "3" com dezoito tarefas dentro seria o mesmo tipo de número que não
  // corresponde a nada que a RN-151 tirou da sidebar.
  const totalDeArtefatos =
    artefatos.length +
    arvoreDeBacklog.reduce((soma, r) => soma + totalDeDescendentes(r), 0);

  // Agrupado por `actorId` — o mesmo padrão de colapso do fio principal
  // (RN-138, `timelineAgrupada`), num `Disclosure` por agente, com a ORDEM
  // em que os artefatos aparecem na lista (que agora é a do mais recente).
  const gruposDeArtefatos: { actorId: string; itens: ArtefatoGerado[] }[] = [];
  for (const item of artefatos) {
    const grupo = gruposDeArtefatos.find((g) => g.actorId === item.actorId);
    if (grupo) grupo.itens.push(item);
    else gruposDeArtefatos.push({ actorId: item.actorId, itens: [item] });
  }

  // Opções do filtro "por agente" do feed (Fase 8d — a prop existia desde
  // sempre em ActivityFeed, mas nenhum dos dois call sites a passava, então
  // o filtro nunca funcionou). Deriva dos atores REAIS desta sessão — pega
  // subagentes de área automaticamente, sem precisar buscar module_map/
  // handoffs só pra montar a lista (que `deriveAgentRoster` exigiria).
  const agentOptions = Array.from(new Set(events.map((e) => e.actor.id))).map((id) => ({
    id,
    label: AGENTS[id as keyof typeof AGENTS]?.name ?? id,
  }));

  // RN-178: a ação mais recente primeiro, e a chave carrega o id da AÇÃO —
  // o mesmo arquivo tocado por dois commits são duas linhas legítimas, e
  // `key={file.path}` fazia delas uma chave duplicada.
  const filesTouched = [...actions]
    .filter((a) => a.actionType === 'git_commit' || a.actionType === 'git_push')
    .sort((a, b) => ordemDaAcaoNaTimeline(b, events) - ordemDaAcaoNaTimeline(a, events))
    .flatMap((a) => {
      const files = (a.payload as { files?: { path: string; additions: number; deletions: number }[] }).files;
      return (files ?? []).map((file) => ({ ...file, actionId: a.id }));
    });

  return (
    <aside className={styles.aside}>
      {/* O trilho se nomeia (handoff, seção 5). Sem isto, quem abre o painel vê
          quatro rótulos mono soltos e nenhuma pista do que os junta. */}
      <div className={styles.asideTitleBar}>
        <h2 className={styles.asideTitle}>{t('aside.titulo')}</h2>
      </div>

      {/* RN-180 — o teto que existia em silêncio passa a estar escrito. Uma
          nota só, no topo, porque o teto é UM: as quatro seções leem os mesmos
          eventos baixados, e é o mesmo botão que traz mais para todas. */}
      {eventosAnteriores > 0 && (
        <p className={styles.asideTeto}>
          <Trans
            i18nKey="aside.teto"
            ns="sessionPage"
            values={{ lidos: events.length, anteriores: eventosAnteriores }}
            components={{ b: <strong /> }}
          />
        </p>
      )}

      <div className={styles.asideSection}>
        {/* Contador exposto com o MESMO padrão do Log de eventos (`Disclosure`
            + `trailing`) — antes o cabeçalho era um `div` mudo e o rodapé
            estático do convite ("Quando as regras estiverem completas…")
            não tinha como saber quantas já existiam. Sem threshold: o ganho
            é mostrar o número real, não decidir por um mínimo. */}
        <Disclosure
          titulo={t('aside.regrasDeNegocio')}
          trailing={businessRules.length}
          padraoAberto
          classNameCabecalho={styles.asideHeader}
        >
          {businessRules.length === 0 ? (
            <div className={styles.asideEmpty}>{t('aside.nadaAinda')}</div>
          ) : (
            <>
              {regrasDaPagina.map((e) => {
                const rule = e.payload as BusinessRulePayload;
                return (
                  <div key={e.id} className={styles.ruleCard}>
                    <div className={styles.ruleTitle}>{rule.title}</div>
                    <div className={styles.ruleDescription}>{rule.description}</div>
                    <div className={styles.ruleOrigin}>
                      {t('aside.origemRefs', {
                        count: Array.isArray(rule.origin) ? rule.origin.length : 0,
                      })}
                    </div>
                  </div>
                );
              })}
              {/* O paginador só existe quando há o que paginar: com 5 ou menos
                  ele seria um controle permanentemente inútil ocupando altura
                  na coluna mais estreita da tela. */}
              {totalDePaginas > 1 && (
                <div className={styles.asidePager}>
                  <button
                    type="button"
                    className={styles.asidePagerBotao}
                    onClick={() => setPaginaDeRegras(Math.max(0, pagina - 1))}
                    disabled={pagina === 0}
                    aria-label={t('aside.paginaAnterior')}
                  >
                    ‹
                  </button>
                  <span className={styles.asidePagerTexto}>
                    {t('aside.paginaDe', { atual: pagina + 1, total: totalDePaginas })}
                  </span>
                  <button
                    type="button"
                    className={styles.asidePagerBotao}
                    onClick={() => setPaginaDeRegras(Math.min(totalDePaginas - 1, pagina + 1))}
                    disabled={pagina >= totalDePaginas - 1}
                    aria-label={t('aside.proximaPagina')}
                  >
                    ›
                  </button>
                </div>
              )}
            </>
          )}
        </Disclosure>
      </div>

      <div className={styles.asideSection}>
        {/* RN-159: agrupado por agente (mesmo `Disclosure` do colapso do fio,
            RN-138) — antes era uma lista PLANA só de `pr_open`, sem dizer
            QUEM abriu cada PR nem incluir épico/história do PO. RN-179: e as
            tarefas, penduradas na história a que pertencem. */}
        <Disclosure
          titulo={t('aside.artefatosGerados')}
          trailing={totalDeArtefatos}
          padraoAberto
          classNameCabecalho={styles.asideHeader}
        >
          {gruposDeArtefatos.length === 0 ? (
            <div className={styles.asideEmpty}>{t('aside.nadaAinda')}</div>
          ) : (
            gruposDeArtefatos.map(({ actorId, itens }) => (
              <div key={actorId} style={corDoAgente(actorId)}>
                <Disclosure
                  titulo={
                    <span className={styles.agentGroupTitulo}>
                      <AvatarDoAgente id={actorId} />
                      {nomeDoAgente(actorId)}
                    </span>
                  }
                  trailing={itens.length}
                  classNameCabecalho={styles.agentGroupCabecalho}
                  className={styles.agentGroup}
                >
                  <div className={styles.artefatoGrupoRegiao}>
                    {itens.map((item) => item.node)}
                  </div>
                </Disclosure>
              </div>
            ))
          )}
        </Disclosure>
      </div>

      <div className={styles.asideSection}>
        <div className={styles.asideHeader}>{t('aside.arquivosTocados')}</div>
        {filesTouched.length === 0 ? (
          <div className={styles.asideEmpty}>{t('aside.nadaAinda')}</div>
        ) : (
          filesTouched.map((file) => (
            <div key={`${file.actionId}-${file.path}`} className={styles.asideItem}>
              <span className={styles.fileLetter}>M</span>
              <span className={styles.filePath}>{file.path}</span>
              <span className={styles.fileAdd}>+{file.additions}</span>
              <span className={styles.fileDel}>−{file.deletions}</span>
            </div>
          ))
        )}
      </div>

      {/* Log completo de eventos — o alvo da navegação de evidência do
          Psicólogo (Fase 4b). Colapsável pra não competir com o chat.

          Migrado para o `Disclosure` do design system na FASE 20, a fase que
          abre este arquivo. O colapso ad-hoc daqui era um `button` com
          `aria-expanded` e um `−`/`+` de texto, sem `aria-controls` e sem
          região nomeada: o leitor de tela anunciava um botão expandido sem
          dizer o que ele expandia. A contagem virou `trailing`, que fica dentro
          do alvo de clique — a linha inteira alterna, como nas outras seis. */}
      <div className={styles.asideSection}>
        <Disclosure
          titulo={t('aside.logDeEventos')}
          trailing={historico.carregados}
          aberto={logOpen}
          onAlternar={onToggleLog}
          classNameCabecalho={styles.asideHeader}
        >
          {/* Evento citado FIXADO no topo: garante que a evidência chega
              no evento independente de paginação e dos filtros do feed. */}
          {highlightEvent && citedEvent && (
            <div className={styles.citedEvent}>
              <div className={styles.citedEventLabel}>
                {t('aside.eventoCitado')}
              </div>
              <EventItem event={citedEvent} highlighted />
            </div>
          )}
          {highlightEvent && citedEventMissing && (
            <div className={styles.asideEmpty}>
              {t('aside.eventoCitadoNaoEncontrado')}
            </div>
          )}
          {/* Os três estados da RN-088, com o ERRO antes do vazio — o painel
              lia de uma prop e por isso nunca soube distinguir "a api recusou"
              de "não aconteceu nada". */}
          {historico.isError ? (
            <ErroDeCarregamento
              titulo={t('aside.erroCarregarLog')}
              erro={historico.error}
              onTentarDeNovo={historico.refetch}
            />
          ) : historico.isPending ? (
            <Skeleton height={120} />
          ) : (
            <ActivityFeed
              events={historico.events}
              agentOptions={agentOptions}
              highlightEventId={highlightEvent}
              // RN-180: o pager sempre existiu no componente e este call site
              // nunca o passava — era essa a razão de a sessão perder o começo
              // em silêncio.
              onLoadOlder={historico.carregarMaisAntigos}
              hasOlder={historico.temMaisAntigos}
              loadingOlder={historico.carregandoMaisAntigos}
            />
          )}
        </Disclosure>
      </div>
    </aside>
  );
}
