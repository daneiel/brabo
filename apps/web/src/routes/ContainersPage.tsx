import { Shimmer } from '../components/ui/Shimmer';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import {
  useContainersOverview,
  useCurrentWorkspaceWithRole,
} from '../lib/hooks';
import type { ContainerOverviewItem } from '../lib/api-types';
import { AcoesDoContainer, EstadoObservadoCelula, TOM_DO_STATUS } from '../components/AcoesDoContainer';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { ErroDeCarregamento } from '../components/ErroDeCarregamento';
import styles from './ContainersPage.module.css';

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
      key: 'detail',
      label: t('table.detail'),
      width: '0.8fr',
      render: (item) => (
        <Link
          to="/containers/$projectId"
          params={{ projectId: item.projectId }}
          className={styles.projectLink}
        >
          {t('table.openDetail')}
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
          <Badge
                tone={TOM_DO_STATUS[item.registrado.status]}
                emCurso={item.registrado.status === 'provisioning'}
              >
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
