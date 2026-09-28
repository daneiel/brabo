import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listMachineDeviceKeys,
  mensagemDaApi,
  revokeMachineDeviceKey,
} from '../lib/api-client';
import {
  QUERY_KEY_CHAVES_DE_MAQUINA,
  invalidarChavesDeDispositivo,
} from '../lib/chaves-de-dispositivo-queries';
import type { RunnerDeviceKeyListItem } from '../lib/api-types';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { TrashIcon } from '../components/ui/icons';
import { useToast } from '../components/ui/ToastProvider';
import styles from './AccountPage.module.css';

/**
 * As chaves de MÁQUINA do próprio usuário, na tela da CONTA
 * ([RN-611](../../../../docs/business-rules.md#rn-611), AT-118).
 *
 * ## Por que na Conta, e não numa seção de projeto
 *
 * A instalação de uma linha cria a conta e a chave de máquina ANTES de
 * qualquer projeto ([RN-547](../../../../docs/business-rules.md#rn-547)), e a
 * seção `device-keys` das Configurações
 * ([RN-561](../../../../docs/business-rules.md#rn-561)) só existe DENTRO de
 * um projeto. Ali a chave era viva e inalcançável. A chave de máquina não é
 * de projeto nenhum — serve todos —, então a casa dela é a Conta, que é o
 * escopo de "o que segue a pessoa entre projetos".
 *
 * ## Só a espécie de máquina, e por isso sem coluna de espécie
 *
 * A rota devolve SÓ `especie: 'maquina'`. As de projeto têm casa (a seção do
 * projeto delas, onde o alcance de revogá-las — o projeto DELA — é dito), e
 * trazê-las para cá faria a Conta revogar pareamento de projeto sem nomear o
 * projeto. Com uma espécie só, uma coluna de espécie repetiria a mesma
 * palavra em toda linha: o que ela dizia na seção de projeto — o ALCANCE — é
 * dito aqui na legenda e na confirmação.
 *
 * ## Sem papel mínimo, e por isso sem `roleAtLeast`
 *
 * As duas rotas (`/users/me/machine-device-keys`) não têm `@RequireRole`: o
 * escopo é a própria pessoa, como `users/me/preferences`. A régua do CLAUDE.md
 * é que o mínimo é o do ENDPOINT — e o do endpoint é "estar logado". Inventar
 * um papel aqui trancaria quem pode, que é o defeito PIOR dos dois. Papel de
 * workspace nem faria sentido: a chave de máquina não é de workspace nenhum.
 *
 * ## O vocabulário é o da RN-561/RN-548, inteiro
 *
 * `lastUsedAt` é USO REGISTRADO, nunca conexão; nulo tem texto próprio
 * ("nunca usada"). "ativa"/"revogada" fala da LINHA — se ela ainda autentica —
 * e nunca de agente de pé, e por isso "ativa" NÃO ganha verde (a seção de
 * projeto pinta a de projeto de `--success`; a de máquina nunca ganha verde,
 * e aqui só há de máquina). Carregando, falhou, vazio, revogada e nunca usada
 * são cinco estados com cinco textos (RN-088/RN-470).
 *
 * ## A invalidação
 *
 * Revogar aqui invalida TODAS as listagens de chave — a da Conta e a de todo
 * projeto no cache (`invalidarChavesDeDispositivo`): a chave de máquina
 * aparece nas duas, e o `RunnerOnboardingPanel` lê a por projeto para dizer
 * "máquina pareada". Invalidar só a daqui o deixaria anunciando a revogada.
 */
export function MachineDeviceKeysSection() {
  const { t, i18n } = useTranslation('machineKeys');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: chaves,
    isPending,
    isError,
    isSuccess,
  } = useQuery({
    queryKey: QUERY_KEY_CHAVES_DE_MAQUINA,
    queryFn: listMachineDeviceKeys,
    retry: false,
  });

  const [aRevogar, setARevogar] = useState<RunnerDeviceKeyListItem | null>(null);
  const [revogando, setRevogando] = useState(false);

  async function confirmarRevogacao() {
    if (!aRevogar) return;
    setRevogando(true);
    try {
      await revokeMachineDeviceKey(aRevogar.id);
      setARevogar(null);
      void invalidarChavesDeDispositivo(queryClient);
    } catch (erro) {
      // A frase da api, e não uma nossa: o que sobra é rede ou o 404 de uma
      // chave que deixou de ser do chamador. A linha CONTINUA na lista.
      showToast({
        title: t('toast.revokeErrorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setRevogando(false);
    }
  }

  const colunas: TableColumn<RunnerDeviceKeyListItem>[] = [
    {
      key: 'name',
      label: t('table.name'),
      width: '2fr',
      render: (chave) => chave.name,
    },
    {
      key: 'createdAt',
      label: t('table.created'),
      width: '1fr',
      render: (chave) => new Date(chave.createdAt).toLocaleDateString(i18n.language),
    },
    {
      key: 'lastUsedAt',
      label: t('table.lastUsed'),
      width: '1fr',
      render: (chave) =>
        chave.lastUsedAt ? (
          new Date(chave.lastUsedAt).toLocaleDateString(i18n.language)
        ) : (
          <span className={styles.vazioComTexto}>{t('table.lastUsedNever')}</span>
        ),
    },
    {
      key: 'status',
      label: t('table.status'),
      width: '110px',
      render: (chave) =>
        chave.revokedAt ? (
          <Badge tone="danger">{t('table.statusRevoked')}</Badge>
        ) : (
          <span className={styles.statusDaLinha}>{t('table.statusActive')}</span>
        ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      render: (chave) =>
        chave.revokedAt ? null : (
          <button
            type="button"
            aria-label={t('table.revokeAria', { name: chave.name })}
            title={t('table.revokeTitle')}
            className={styles.remove}
            onClick={() => setARevogar(chave)}
          >
            <TrashIcon size={14} />
          </button>
        ),
    },
  ];

  const temOrfa = (chaves ?? []).some(
    (chave) => chave.revokedAt === null && chave.lastUsedAt === null,
  );
  const temRevogada = (chaves ?? []).some((chave) => chave.revokedAt !== null);

  return (
    <div className={styles.section} data-secao="machine-keys">
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('title')}</h2>
        <span className={styles.eyebrow}>{t('eyebrow')}</span>
      </div>
      <p className={styles.sectionSubtitle}>
        {t('subtitle')} {t('subtitleAlcance')} {t('subtitleNaoEBatimento')}
      </p>

      {isPending && <p className={styles.sectionSubtitle}>{t('verificando')}</p>}
      {isError && <p className={styles.sectionSubtitle}>{t('naoSei')}</p>}
      {isSuccess && (
        <Table
          columns={colunas}
          rows={chaves ?? []}
          rowKey={(chave) => chave.id}
          emptyMessage={t('emptyMessage')}
        />
      )}
      {temOrfa && <p className={styles.sectionSubtitle}>{t('orfa')}</p>}
      {/*
        "Registrar substitui a anterior" (RN-552) revoga SEM clique: a linha
        revogada que ninguém revogou pela tela precisa do motivo por escrito,
        senão a pessoa lê um incidente onde houve uma reinstalação.
      */}
      {temRevogada && <p className={styles.sectionSubtitle}>{t('subtitleSubstitui')}</p>}

      {aRevogar && (
        <Modal title={t('modal.title')} onClose={() => setARevogar(null)}>
          <p className={styles.sectionSubtitle}>
            {t('modal.body', { name: aRevogar.name })}
          </p>
          <p className={styles.sectionSubtitle}>{t('modal.alcance')}</p>
          <p className={styles.sectionSubtitle}>{t('modal.colateral')}</p>
          <div className={styles.acoes}>
            <Button variant="secondary" onClick={() => setARevogar(null)}>
              {t('modal.cancel')}
            </Button>
            <Button variant="danger" loading={revogando} onClick={confirmarRevogacao}>
              {t('modal.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
