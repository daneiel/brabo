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
import { useContainersOverview, useCurrentWorkspace, useLatestSession } from '../lib/hooks';
import { userIdDaSessao } from '../lib/auth';
import type { ContainerOverviewItem, ContainerLifecycleStatus } from '../lib/api-types';
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
function AcoesDoContainer({ item }: { item: ContainerOverviewItem }) {
  const { t } = useTranslation('containers');
  const { latest: latestSession } = useLatestSession(item.projectId);
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

  // "Subir de novo" REUSA `container_start` (ADR 0136) — não é um tipo de
  // ação novo. A imagem/rede/recursos vêm da DECISÃO VIGENTE do projeto
  // (`GET .../container`, a mesma que a aba Code lê), nunca inventados pela
  // tela: se o Arquiteto/Infra ainda não decidiu (não deveria acontecer para
  // uma linha que já existe, mas a leitura degrada em vez de assumir), o
  // clique falha com uma mensagem, nunca propõe um payload vazio.
  async function subirDeNovo() {
    if (!latestSession) return;
    setEmAndamento('subir');
    try {
      const estado = await getContainerState(item.projectId);
      if (estado.status !== 'decidido' || !estado.decisao) {
        showToast({
          title: t('actions.startAgainNoDecisionTitle'),
          message: t('actions.startAgainNoDecisionMessage'),
          tone: 'danger',
        });
        return;
      }
      await proposeAction(item.projectId, latestSession.id, {
        actionType: 'container_start',
        actor: { kind: 'user', id: userIdDaSessao() ?? 'usuário' },
        payload: {
          imagem: estado.decisao.image,
          network: estado.decisao.network,
          resources: estado.decisao.resources,
          rationale: t('actions.startAgainRationale'),
        },
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

  // Uma proposta pendente de container (qualquer uma das três) SUBSTITUI os
  // três botões pelo card de decisão — mesmo molde de `ProjectPrsTab`: a
  // ação já existe, decidir É a próxima ação, não propor de novo.
  if (item.acaoPendente) {
    return (
      <ApprovalCard
        action={item.acaoPendente}
        variant="queue"
        onApprove={() => void aprovar()}
        onDeny={() => void negar()}
        onAlwaysAllow={() => void sempreAprovar()}
      />
    );
  }

  const podeParar = item.status === 'running' || item.status === 'provisioning';
  const podeRemover = item.status !== 'removed';
  const podeSubirDeNovo =
    item.status === 'stopped' ||
    item.status === 'failed' ||
    item.status === 'removed';
  const semSessao = !latestSession;
  const tituloSemSessao = semSessao ? t('actions.noSession') : undefined;

  return (
    <div className={styles.acoes}>
      <Button
        variant="secondary"
        disabled={!podeParar || semSessao}
        loading={emAndamento === 'parar'}
        title={tituloSemSessao}
        onClick={() => void parar()}
      >
        {t('actions.stop')}
      </Button>
      <Button
        variant="danger"
        disabled={!podeRemover || semSessao}
        loading={emAndamento === 'remover'}
        title={tituloSemSessao}
        onClick={() => void remover()}
      >
        {t('actions.remove')}
      </Button>
      <Button
        variant="primary"
        disabled={!podeSubirDeNovo || semSessao}
        loading={emAndamento === 'subir'}
        title={tituloSemSessao}
        onClick={() => void subirDeNovo()}
      >
        {t('actions.startAgain')}
      </Button>
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
 * A página global de containers (`/containers`, ADR 0136, RN-495) —
 * cross-projeto, do WORKSPACE inteiro. Lista o container de CADA projeto
 * que já tem `project_containers`: imagem/versão, estado REGISTRADO,
 * estado OBSERVADO (nunca fundidos — RN-468/486), recursos, desde quando, e
 * as três ações (parar/remover/subir de novo), todas `proposed_action`
 * aprovável — nenhuma direta.
 */
export function ContainersPage() {
  const { t, i18n } = useTranslation('containers');
  const { data: workspace } = useCurrentWorkspace();
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
      render: (item) => (
        <span className={styles.imagemCelula}>
          <span className={styles.imagemTexto}>
            {item.imagem ?? t('table.imageUnresolved')}
          </span>
          <span className={styles.versao}>v{item.imageVersion}</span>
        </span>
      ),
    },
    {
      key: 'status',
      label: t('table.registered'),
      width: '0.9fr',
      render: (item) => (
        <Badge tone={TOM_DO_STATUS[item.status]}>
          {t(`status.${item.status}`)}
        </Badge>
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
      render: (item) => (
        <span className={styles.recursos}>
          {t('table.resourcesValue', {
            cpus: item.resources.cpus,
            memoryMb: item.resources.memoryMb,
            pidsLimit: item.resources.pidsLimit,
          })}
        </span>
      ),
    },
    {
      key: 'since',
      label: t('table.since'),
      width: '1fr',
      render: (item) => (
        <span className={styles.desde}>
          {new Date(item.statusChangedAt).toLocaleString(i18n.language)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('table.actions'),
      width: '2fr',
      render: (item) => <AcoesDoContainer item={item} />,
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
        <p className={styles.loading}>{t('loading')}</p>
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
