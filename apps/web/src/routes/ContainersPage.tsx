import { Shimmer } from '../components/ui/Shimmer';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  approveAction,
  approveAlwaysAction,
  denyAction,
  getContainerState,
  mensagemDaApi,
  proposeAction,
} from '../lib/api-client';
import {
  useContainersOverview,
  useCurrentWorkspaceWithRole,
  useLatestSession,
} from '../lib/hooks';
import { userIdDaSessao } from '../lib/auth';
import type {
  ContainerOverviewItem,
  ContainerLifecycleStatus,
  Role,
} from '../lib/api-types';
import {
  decidirSubida,
  podeDecidirCicloDeVida,
  semBrokerParaCicloDeVida,
  type AcaoDeSubida,
} from './containers-subida';
import { ApprovalCard } from '../components/ApprovalCard';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import { useToast } from '../components/ui/ToastProvider';
import styles from './ContainersPage.module.css';

const TOM_DO_STATUS: Record<ContainerLifecycleStatus, BadgeTone> = {
  provisioning: 'warning',
  running: 'success',
  stopped: 'muted',
  failed: 'danger',
  removed: 'muted',
};

/** Roda dentro de CADA linha (não da página): a sessão mais recente é POR
 *  PROJETO, e um hook num `.map()` da página violaria a ordem de hooks —
 *  um componente por linha é o jeito certo de resolver isso (mesmo padrão
 *  de qualquer lista de itens com estado próprio). */
function AcoesDoContainer({
  item,
  papel,
}: {
  item: ContainerOverviewItem;
  papel: Role | undefined;
}) {
  const { t } = useTranslation('containers');
  // Sem poll (AT-278, RN-632): a linha só precisa da sessão para PROPOR no
  // clique, e cada linha em poll de 5s era uma requisição a cada 5s POR
  // PROJETO do workspace — a página inteira sozinha passava de 100/min com
  // nove projetos. Montagem e foco da janela bastam.
  const { latest: latestSession } = useLatestSession(item.projectId, false);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [emAndamento, setEmAndamento] = useState<
    'parar' | 'remover' | 'subir' | null
  >(null);

  function invalidateContainers() {
    queryClient.invalidateQueries({ queryKey: ['containers-overview'] });
  }

  async function proporAcaoDeContainer(
    actionType: 'container_stop' | 'container_remove',
  ) {
    if (!latestSession) return;
    try {
      await proposeAction(item.projectId, latestSession.id, {
        actionType,
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload: {},
      });
      invalidateContainers();
    } catch (erro) {
      showToast({
        title: t('actions.errorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    }
  }

  async function parar() {
    setEmAndamento('parar');
    try {
      await proporAcaoDeContainer('container_stop');
    } finally {
      setEmAndamento(null);
    }
  }

  async function remover() {
    setEmAndamento('remover');
    try {
      await proporAcaoDeContainer('container_remove');
    } finally {
      setEmAndamento(null);
    }
  }

  // A subida ramifica por `executionMode` (RN-521), e os DOIS payloads são
  // diferentes de propósito:
  //
  // - `container_start` (broker — `container`/`mounted`) carrega a ELEIÇÃO de
  //   imagem, buscada da decisão VIGENTE do projeto (`GET .../container`, a
  //   mesma que a aba Code lê), nunca inventada pela tela.
  // - `container_start_via_runner` (agente local — `runner`, RN-508) tem
  //   schema só com `rationale`: ela sobe a imagem JÁ decidida e não elege
  //   nada. Copiar o payload da outra aqui seria mandar campos que o schema
  //   recusa.
  //
  // `decidirSubida` já garantiu que existe imagem decidida antes de o botão
  // aparecer; a leitura ainda degrada em vez de assumir, porque entre a carga
  // da tela e o clique o artefato pode ter sido revisado.
  async function subir(acao: AcaoDeSubida) {
    if (!latestSession) return;
    setEmAndamento('subir');
    try {
      const payload =
        acao === 'container_start_via_runner'
          ? { rationale: t('actions.startRationale') }
          : await payloadDeStartPeloBroker();
      if (!payload) return;

      await proposeAction(item.projectId, latestSession.id, {
        actionType: acao,
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload,
      });
      invalidateContainers();
    } catch (erro) {
      showToast({
        title: t('actions.errorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setEmAndamento(null);
    }
  }

  async function payloadDeStartPeloBroker(): Promise<Record<
    string,
    unknown
  > | null> {
    const estado = await getContainerState(item.projectId);
    if (estado.status !== 'decidido' || !estado.decisao) {
      showToast({
        title: t('actions.startNoDecisionTitle'),
        message: t('actions.startNoDecisionMessage'),
        tone: 'danger',
      });
      return null;
    }
    return {
      imagem: estado.decisao.image,
      network: estado.decisao.network,
      resources: estado.decisao.resources,
      rationale: t('actions.startRationale'),
    };
  }

  async function aprovar() {
    if (!item.acaoPendente) return;
    await approveAction(
      item.projectId,
      item.acaoPendente.sessionId,
      item.acaoPendente.id,
    );
    invalidateContainers();
  }
  async function negar() {
    if (!item.acaoPendente) return;
    await denyAction(
      item.projectId,
      item.acaoPendente.sessionId,
      item.acaoPendente.id,
    );
    invalidateContainers();
  }
  async function sempreAprovar() {
    if (!item.acaoPendente) return;
    await approveAlwaysAction(
      item.projectId,
      item.acaoPendente.sessionId,
      item.acaoPendente.id,
    );
    invalidateContainers();
    queryClient.invalidateQueries({ queryKey: ['permissions', item.projectId] });
  }

  // Uma proposta pendente de container (qualquer uma das quatro) SUBSTITUI os
  // botões pelo card de decisão — mesmo molde de `ProjectPrsTab`: a ação já
  // existe, decidir É a próxima ação, não propor de novo.
  if (item.acaoPendente) {
    return (
      <ApprovalCard
        action={item.acaoPendente}
        detalheRecolhido
        onApprove={() => void aprovar()}
        onDeny={() => void negar()}
        onAlwaysAllow={() => void sempreAprovar()}
      />
    );
  }

  const status = item.registrado?.status ?? null;
  const podeDecidir = podeDecidirCicloDeVida(papel);
  const semSessao = !latestSession;
  // Parar/remover exigem um container REGISTRADO: num projeto que nunca
  // provisionou não há o que parar nem o que remover.
  const semBroker = semBrokerParaCicloDeVida(item);
  const podeParar =
    podeDecidir &&
    !semSessao &&
    !semBroker &&
    (status === 'running' || status === 'provisioning');
  const podeRemover =
    podeDecidir &&
    !semSessao &&
    !semBroker &&
    status !== null &&
    status !== 'removed';
  // A falta de broker para parar/remover só se diz quando HAVIA container:
  // sem registro, o motivo é outro (não há o que parar), dito abaixo.
  const semBrokerParaParar =
    semBroker && status !== null && status !== 'removed';
  // AT-324 (RN-646): Parar/Remover já eram inertes sem container, mas nada
  // dizia por quê — e o `danger` desabilitado pintava "Remover" em vermelho
  // cheio, oferecendo remover o que não existe. O motivo agora é TEXTO, uma
  // vez (ADR 0064), e é o do MUNDO, antes de papel ou sessão.
  const semContainer =
    status === null ? 'nuncaProvisionado' : status === 'removed' ? 'removido' : null;

  const subida = decidirSubida({ item, papel, temSessao: !semSessao });

  // O motivo do bloqueio é dito em TEXTO, uma vez (ADR 0064) — `title` em
  // elemento `disabled` não abre no Chromium. `ja_esta_de_pe` é a exceção:
  // a coluna Registrado já mostra `rodando`, e repetir isso numa linha de
  // texto em toda linha saudável é ruído, não explicação.
  const motivoDaSubida =
    !subida.pode && subida.motivo !== 'ja_esta_de_pe' ? subida.motivo : null;
  const semBrokerNaSubida = motivoDaSubida === 'sem_broker_na_instalacao';
  // A falta de broker é UM fato, mesmo quando trava subir E parar/remover:
  // uma linha curta só, com o detalhe (o nome da variável, para o operador)
  // atrás de um `<details>` — o texto longo estourava a célula (AT-324).
  const chaveCurtaDoBroker = semBrokerNaSubida
    ? semBrokerParaParar
      ? 'sem_broker_ambos'
      : 'sem_broker_na_instalacao'
    : semBrokerParaParar
      ? 'sem_broker_para_parar'
      : null;
  const detalhesDoBroker = [
    semBrokerNaSubida ? t('actions.bloqueio.sem_broker_na_instalacao') : null,
    semBrokerParaParar ? t('actions.bloqueio.sem_broker_para_parar') : null,
  ].filter((texto): texto is string => texto !== null);
  const motivo =
    motivoDaSubida && !semBrokerNaSubida ? t(`actions.bloqueio.${motivoDaSubida}`) : null;
  const ressalva = subida.pode && subida.ressalva ? t(`actions.ressalva.${subida.ressalva}`) : null;

  return (
    <div className={styles.blocoDeAcoes}>
      <div className={styles.acoes}>
        <Button
          variant="secondary"
          disabled={!podeParar}
          loading={emAndamento === 'parar'}
          onClick={() => void parar()}
        >
          {t('actions.stop')}
        </Button>
        <Button
          variant="danger"
          disabled={!podeRemover}
          loading={emAndamento === 'remover'}
          onClick={() => void remover()}
        >
          {t('actions.remove')}
        </Button>
        <Button
          variant="primary"
          disabled={!subida.pode}
          loading={emAndamento === 'subir'}
          onClick={() => {
            if (subida.pode) void subir(subida.acao);
          }}
        >
          {item.registrado ? t('actions.startAgain') : t('actions.start')}
        </Button>
      </div>
      {semContainer && (
        <p className={styles.motivo}>{t(`actions.semContainer.${semContainer}`)}</p>
      )}
      {chaveCurtaDoBroker && (
        <details className={styles.motivoComDetalhe}>
          <summary className={styles.motivo}>
            {t(`actions.bloqueioCurto.${chaveCurtaDoBroker}`)}{' '}
            <span className={styles.porque}>{t('actions.bloqueioDetalhe')}</span>
          </summary>
          {detalhesDoBroker.map((texto) => (
            <p key={texto} className={styles.detalheDoMotivo}>
              {texto}
            </p>
          ))}
        </details>
      )}
      {motivo && <p className={styles.motivo}>{motivo}</p>}
      {ressalva && <p className={styles.ressalva}>{ressalva}</p>}
    </div>
  );
}

function EstadoObservadoCelula({ item }: { item: ContainerOverviewItem }) {
  const { t } = useTranslation('containers');

  if (item.naoVerificado) {
    return (
      <span className={styles.naoVerificado}>
        {t(`observed.naoVerificado.${item.naoVerificado}`)}
      </span>
    );
  }
  if (item.naoObservado) {
    return (
      <span className={styles.naoVerificado} title={item.detalheDaObservacao ?? undefined}>
        {t(`observed.naoObservado.${item.naoObservado}`)}
      </span>
    );
  }
  if (!item.observado) {
    return <span className={styles.naoVerificado}>{t('observed.none')}</span>;
  }
  return (
    <Badge tone={item.observado.estado === 'running' ? 'success' : 'muted'}>
      {item.observado.estado}
    </Badge>
  );
}

/**
 * A página global de containers (`/containers`, ADR 0136, RN-495/RN-521) —
 * cross-projeto, do WORKSPACE inteiro. Lista TODO projeto do workspace, tenha
 * ele `project_containers` ou não: imagem/versão, estado REGISTRADO (ou
 * "nunca provisionado", que é um TERCEIRO estado e não um status), estado
 * OBSERVADO (nunca fundidos — RN-468/486), recursos, desde quando, e as ações
 * (parar/remover/subir), todas `proposed_action` aprovável — nenhuma direta, e
 * sempre um HUMANO clicando.
 */
export function ContainersPage() {
  const { t, i18n } = useTranslation('containers');
  const { data: atual } = useCurrentWorkspaceWithRole();
  const workspace = atual?.workspace;
  // O papel do WORKSPACE, e a lacuna é declarada: o efetivo é
  // `projectRole ?? workspaceRole` (RN-471), e esta tela é cross-projeto —
  // buscar `project_members` de cada linha seria um N+1 de rede pelo qual a
  // página inteira existe para não pagar. Consequência aceita: quem foi
  // REBAIXADO num projeto específico ainda vê o botão aqui, e a api recusa com
  // 403. É o defeito reparável (termina em toast), não o invisível.
  const papel = atual?.role;
  const query = useContainersOverview(workspace?.id);

  const columns: TableColumn<ContainerOverviewItem>[] = [
    {
      key: 'project',
      label: t('table.project'),
      width: '1.4fr',
      render: (item) => (
        <Link
          to="/projects/$projectId"
          params={{ projectId: item.projectId }}
          className={styles.projectLink}
        >
          {item.projectName}
        </Link>
      ),
    },
    {
      key: 'image',
      label: t('table.image'),
      width: '1.6fr',
      render: (item) =>
        item.registrado ? (
          <span className={styles.imagemCelula}>
            <span className={styles.imagemTexto}>
              {item.registrado.imagem ?? t('table.imageUnresolved')}
            </span>
            <span className={styles.versao}>v{item.registrado.imageVersion}</span>
          </span>
        ) : (
          <span className={styles.semRegistro}>
            {item.temImagemDecidida
              ? t('table.imageDecidedNotFrozen')
              : t('table.imageUndecided')}
          </span>
        ),
    },
    {
      key: 'status',
      label: t('table.registered'),
      width: '0.9fr',
      render: (item) =>
        item.registrado ? (
          <Badge tone={TOM_DO_STATUS[item.registrado.status]}>
            {t(`status.${item.registrado.status}`)}
          </Badge>
        ) : (
          <span className={styles.semRegistro}>{t('status.nuncaProvisionado')}</span>
        ),
    },
    {
      key: 'observed',
      label: t('table.observed'),
      width: '1fr',
      render: (item) => <EstadoObservadoCelula item={item} />,
    },
    {
      key: 'resources',
      label: t('table.resources'),
      width: '1fr',
      render: (item) =>
        item.registrado ? (
          <span className={styles.recursos}>
            {t('table.resourcesValue', {
              cpus: item.registrado.resources.cpus,
              memoryMb: item.registrado.resources.memoryMb,
              pidsLimit: item.registrado.resources.pidsLimit,
            })}
          </span>
        ) : (
          <span className={styles.semRegistro}>{t('table.resourcesNone')}</span>
        ),
    },
    {
      key: 'since',
      label: t('table.since'),
      width: '1fr',
      render: (item) =>
        item.registrado ? (
          <span className={styles.desde}>
            {new Date(item.registrado.statusChangedAt).toLocaleString(i18n.language)}
          </span>
        ) : (
          <span className={styles.semRegistro}>{t('table.sinceNone')}</span>
        ),
    },
    {
      key: 'actions',
      label: t('table.actions'),
      width: '2fr',
      largaNoMovel: true,
      render: (item) => <AcoesDoContainer item={item} papel={papel} />,
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.subtitle}>{t('subtitle')}</p>
      </div>

      {query.isError && (
        <ErroDeCarregamento
          titulo={t('loadError')}
          erro={query.error}
          onTentarDeNovo={() => void query.refetch()}
        />
      )}

      {!query.isError && query.isPending && (
        <p className={styles.loading}><Shimmer>{t('loading')}</Shimmer></p>
      )}

      {!query.isError && !query.isPending && (
        <Table
          columns={columns}
          rows={query.data ?? []}
          rowKey={(item) => item.projectId}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}
