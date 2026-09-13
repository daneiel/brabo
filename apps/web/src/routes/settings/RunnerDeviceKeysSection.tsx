import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listProjectMembers,
  listRunnerDeviceKeys,
  mensagemDaApi,
  revokeRunnerDeviceKey,
} from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { userIdDaSessao } from '../../lib/auth';
import { podeLerChavesDeDispositivo } from '../../lib/agente-de-maquina';
import type { RunnerDeviceKeyListItem } from '../../lib/api-types';
import { Table, type TableColumn } from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TrashIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/**
 * As chaves de dispositivo do runner local — a TELA que a
 * [RN-519](../../../../docs/business-rules.md#rn-519) declarou faltar
 * ([RN-561](../../../../docs/business-rules.md#rn-561)).
 *
 * As duas rotas existem desde a RN-519 (`GET`) e o
 * [ADR 0118](../../../../docs/adr/0118-configuracao-automatica-do-runner-pelo-navegador.md)
 * (`DELETE`), e até aqui **tela nenhuma as usava**: quem quisesse revogar
 * chamava a rota na mão. Esta seção consome as duas, e **não abre uma
 * terceira** — o que a api já devolve basta para desenhar tudo o que segue.
 *
 * ## A espécie não é enfeite, é o alcance da ação mais destrutiva da tela
 *
 * A listagem devolve DUAS espécies desde a
 * [RN-543](../../../../docs/business-rules.md#rn-543): `projeto` (a do ADR
 * 0118, presa ao projeto em que o navegador a gerou) e `maquina` (ADR 0154,
 * `project_id` nulo). Uma de MÁQUINA **serve todos os projetos do dono**, e
 * por isso aparece na listagem de TODOS — inclusive nesta. Mostrá-la sem a
 * marca faria a tela afirmar que ela é "a chave deste projeto", e a pessoa
 * clicaria em revogar achando que derruba o agente local aqui quando derruba
 * em todos os projetos dela. A tela mentiria justamente sobre a única ação
 * irreversível que oferece.
 *
 * ## Uso registrado NÃO é agente de pé
 *
 * `lastUsedAt` é a MESMA classe de dado que `workspaceVerifiedAt`
 * ([RN-468](../../../../docs/business-rules.md#rn-468)) e que a chave
 * reconhecida do `RunnerOnboardingPanel`
 * ([RN-548](../../../../docs/business-rules.md#rn-548)): registro de uma
 * confirmação, nunca batimento. Ele prova que um agente local usou aquela
 * chave um dia; quem sabe do AGORA é o canal do terminal. O vocabulário aqui
 * é o MESMO da RN-548 de propósito — a ressalva é dita em texto, e a coluna
 * de status fala de REVOGAÇÃO ("ativa"/"revogada", um fato sobre a linha),
 * nunca de conexão.
 *
 * ## Três vazios, três textos
 *
 * Nenhuma chave, chave REVOGADA (que continua na lista por decisão da RN-519 —
 * sumir com ela faria a tela afirmar que nunca existiu) e `lastUsedAt` NULO (a
 * chave ÓRFÃ da [RN-473](../../../../docs/business-rules.md#rn-473): registrada
 * por uma aba que fechou no meio do fluxo e nunca usada por runner nenhum) são
 * TRÊS coisas distintas, e nenhuma se lê pelo texto da outra. "Ainda não
 * carregou" e "não consegui ler" são outras duas, e também não viram "não tem"
 * ([RN-088](../../../../docs/business-rules.md#rn-088)).
 *
 * ## Uma por vez, e por isso NÃO há desfecho de lote
 *
 * A revogação é de UMA chave, com confirmação própria. A régua da
 * [RN-469](../../../../docs/business-rules.md#rn-469) — ação de UI que vira N
 * chamadas não é transação, e a tela diz isso — não se aplica porque a tela
 * não oferece lote: oferecer "revogar todas" aqui seria N chamadas cujo
 * desfecho parcial teria de ser narrado, para uma ação que ninguém pediu.
 */
export function RunnerDeviceKeysSection({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  /**
   * O papel EFETIVO de quem está olhando, NESTE projeto — a mesma composição
   * de `MembersSection`, e não o papel de workspace que `agente-de-maquina.ts`
   * declara ler.
   *
   * A RN-548 declarou aquela lacuna porque o `RunnerOnboardingPanel` monta em
   * lugares que não buscam `project_members`. Aqui os dados estão à mão — esta
   * seção mora na MESMA aba que `MembersSection`, com a MESMA `queryKey`, e o
   * react-query deduplica a chamada —, e o `CLAUDE.md` é explícito: onde o
   * papel efetivo é derivável a lacuna se FECHA, e não se declara de novo.
   * `listProjectMembers` já É `findMemberRole` para todo mundo (`viewer`
   * basta), e `userIdDaSessao()` diz qual linha é a minha.
   *
   * A composição é a do caso de uso — `projectRole ?? workspaceRole`, uma
   * SOBREPOSIÇÃO nos dois sentidos
   * ([RN-471](../../../../docs/business-rules.md#rn-471)) —, nunca "o maior
   * dos dois". Enquanto a lista não chegou o papel é AUSENTE: errar para o
   * lado de não perguntar se conserta recarregando.
   *
   * O mínimo é o do ENDPOINT ([RN-102](../../../../docs/business-rules/custo.md#rn-102)):
   * as TRÊS rotas de `RunnerDeviceKeysController` exigem `developer`, e é a
   * MESMA função da RN-548 (`podeLerChavesDeDispositivo`) que compara — não
   * uma segunda régua, e nunca `role === 'x' || role === 'y'` à mão.
   *
   * Isto NÃO é fronteira de segurança: quem recusa é o `RolesGuard`.
   */
  const { data: membros } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => listProjectMembers(projectId),
  });
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const meuId = userIdDaSessao();
  const papelEfetivo = membros
    ? (membros.find((m) => m.userId === meuId)?.role ?? comPapel?.role)
    : undefined;
  /**
   * Papel AUSENTE não é papel INSUFICIENTE, e colapsar os dois faria a seção
   * afirmar "você não alcança developer" durante o meio segundo em que a
   * consulta de membros está em voo — uma acusação sobre quem lê, dita por
   * ignorância. Enquanto não se sabe, o texto é o de estar verificando.
   */
  const papelConhecido = papelEfetivo !== undefined;
  const podeVerAsChaves = podeLerChavesDeDispositivo(papelEfetivo);

  const {
    data: chaves,
    isPending,
    isError,
    isSuccess,
  } = useQuery({
    queryKey: ['runner-device-keys', projectId],
    queryFn: () => listRunnerDeviceKeys(projectId),
    // A tela deixa de perguntar o que a api negaria (RN-548): um 403
    // previsível viraria "não consegui ler", que é o pior dos dois textos —
    // ignorância inventada no lugar de um motivo conhecido.
    enabled: podeVerAsChaves,
    // A MESMA `queryKey` e o MESMO `retry` do `RunnerOnboardingPanel`: as duas
    // leituras são a mesma listagem, e o react-query as deduplica. É por isso
    // que revogar invalida esta chave — sem isso o painel continuaria
    // anunciando uma máquina pareada com a chave que se acabou de revogar.
    retry: false,
  });

  const [aRevogar, setARevogar] = useState<RunnerDeviceKeyListItem | null>(null);
  const [revogando, setRevogando] = useState(false);

  async function confirmarRevogacao() {
    if (!aRevogar) return;
    setRevogando(true);
    try {
      await revokeRunnerDeviceKey(projectId, aRevogar.id);
      setARevogar(null);
      queryClient.invalidateQueries({ queryKey: ['runner-device-keys', projectId] });
    } catch (erro) {
      // A frase da api, e não uma nossa: o que sobra aqui é 403 (papel vencido
      // entre o render e o clique) e rede, e nesses casos a mensagem dela é a
      // informação mais útil que existe. A linha CONTINUA na lista.
      showToast({
        title: t('runnerDeviceKeys.toast.revokeErrorTitle'),
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
      label: t('runnerDeviceKeys.table.name'),
      width: '2fr',
      render: (chave) => chave.name,
    },
    {
      key: 'especie',
      label: t('runnerDeviceKeys.table.especie'),
      width: '150px',
      // `warning` para a de MÁQUINA e `muted` para a de projeto: a diferença
      // entre as duas é o ALCANCE de revogar, e a de máquina é a que alcança
      // mais. Nunca `success` — verde aqui leria como "está de pé", que é
      // exatamente o que esta tela não sabe (a mesma aritmética da RN-548).
      render: (chave) =>
        chave.especie === 'maquina' ? (
          <Badge tone="warning" square>
            {t('runnerDeviceKeys.table.especieMaquina')}
          </Badge>
        ) : (
          <Badge tone="muted" square>
            {t('runnerDeviceKeys.table.especieProjeto')}
          </Badge>
        ),
    },
    {
      key: 'createdAt',
      label: t('runnerDeviceKeys.table.created'),
      width: '1fr',
      render: (chave) => new Date(chave.createdAt).toLocaleDateString(i18n.language),
    },
    {
      key: 'lastUsedAt',
      label: t('runnerDeviceKeys.table.lastUsed'),
      width: '1fr',
      // Nunca usada tem TEXTO próprio, e não um traço: é o sinal da chave
      // órfã, e um `—` diria o mesmo que "não sei" e que "não se aplica".
      render: (chave) =>
        chave.lastUsedAt ? (
          new Date(chave.lastUsedAt).toLocaleDateString(i18n.language)
        ) : (
          <span className={styles.vazioComTexto}>
            {t('runnerDeviceKeys.table.lastUsedNever')}
          </span>
        ),
    },
    {
      key: 'status',
      label: t('runnerDeviceKeys.table.status'),
      width: '120px',
      // "ativa"/"revogada" é um fato sobre a LINHA — se ela ainda autentica —,
      // nunca sobre haver agente conectado. A ressalva está dita em texto na
      // legenda da seção, uma vez.
      render: (chave) =>
        chave.revokedAt ? (
          <Badge tone="danger">{t('runnerDeviceKeys.table.statusRevoked')}</Badge>
        ) : (
          <span className={styles.status}>
            <span className={styles.statusDot} />
            {t('runnerDeviceKeys.table.statusActive')}
          </span>
        ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      // A revogada não ganha botão: revogar de novo é idempotente na api, mas
      // oferecer o gesto sugeriria que sobrou efeito a produzir.
      render: (chave) =>
        chave.revokedAt ? null : (
          <button
            type="button"
            aria-label={t('runnerDeviceKeys.table.revokeAria', { name: chave.name })}
            title={t('runnerDeviceKeys.table.revokeTitle')}
            className={styles.remove}
            onClick={() => setARevogar(chave)}
          >
            <TrashIcon size={14} />
          </button>
        ),
    },
  ];

  /**
   * A chave ativa que agente nenhum usou — a ÓRFÃ. A frase só aparece quando
   * existe uma: explicar o que "nunca usada" significa numa lista onde isso
   * não ocorre seria texto sobre nada.
   */
  const temOrfa = (chaves ?? []).some(
    (chave) => chave.revokedAt === null && chave.lastUsedAt === null,
  );

  return (
    <SecaoDeConfiguracoes chave="device-keys">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('runnerDeviceKeys.title')}</h2>
        <span className={styles.eyebrow}>{t('runnerDeviceKeys.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {t('runnerDeviceKeys.subtitle')}
        {/*
          O ALCANCE da espécie de máquina, dito onde a coluna que a marca é
          lida — sem esta frase a marca seria decoração, e é ela que separa
          "derruba o agente aqui" de "derruba o agente em todos os seus
          projetos".
        */}
        {' '}
        {t('runnerDeviceKeys.subtitleAlcance')}
        {/*
          E a ressalva de sempre: registro de uma confirmação, não batimento.
          Mesmo vocabulário da RN-548, de propósito.
        */}
        {' '}
        {t('runnerDeviceKeys.subtitleNaoEBatimento')}
        {/*
          O motivo dos controles ausentes, dito UMA vez e em TEXTO — o fato é
          sobre quem está lendo, não sobre uma linha da tabela, e `title` em
          elemento `disabled` não abre no Chromium (ADR 0064).
        */}
        {papelConhecido &&
          !podeVerAsChaves &&
          ` ${t('runnerDeviceKeys.subtitleNeedsDeveloper')}`}
      </p>

      {(!papelConhecido || (podeVerAsChaves && isPending)) && (
        <p className={styles.subtitle}>{t('runnerDeviceKeys.verificando')}</p>
      )}
      {podeVerAsChaves && isError && (
        <p className={styles.subtitle}>{t('runnerDeviceKeys.naoSei')}</p>
      )}
      {podeVerAsChaves && isSuccess && (
        <Table
          columns={colunas}
          rows={chaves ?? []}
          rowKey={(chave) => chave.id}
          emptyMessage={t('runnerDeviceKeys.emptyMessage')}
        />
      )}
      {temOrfa && <p className={styles.subtitle}>{t('runnerDeviceKeys.orfa')}</p>}

      {aRevogar && (
        <Modal
          title={t('runnerDeviceKeys.modal.title')}
          onClose={() => setARevogar(null)}
        >
          <p className={styles.subtitle}>
            {t('runnerDeviceKeys.modal.body', { name: aRevogar.name })}
          </p>
          {/*
            O ALCANCE, e ele DEPENDE da espécie: a de máquina derruba o agente
            local em todos os projetos do dono em modo runner (o `for` de
            `RevokeRunnerDeviceKeyUseCase` sobre `listRunnerModeReachableBy`);
            a de projeto derruba no projeto DELA. Um texto só para as duas
            mentiria numa das metades.
          */}
          <p className={styles.subtitle}>
            {aRevogar.especie === 'maquina'
              ? t('runnerDeviceKeys.modal.alcanceMaquina')
              : t('runnerDeviceKeys.modal.alcanceProjeto')}
          </p>
          {/*
            E o custo colateral que a RN-520 declarou: o alvo da desconexão é
            `{projeto, usuário}` e nunca `{chave}` — outro runner SEU no mesmo
            projeto cai junto, mesmo autenticado por PAT ou por outra chave, e
            reconecta sozinho se a credencial dele ainda valer. Mudar esse alvo
            é frente própria, com ADR.
          */}
          <p className={styles.subtitle}>{t('runnerDeviceKeys.modal.colateral')}</p>
          <div className={styles.acoesDaSecao}>
            <Button variant="secondary" onClick={() => setARevogar(null)}>
              {t('runnerDeviceKeys.modal.cancel')}
            </Button>
            <Button variant="danger" loading={revogando} onClick={confirmarRevogacao}>
              {t('runnerDeviceKeys.modal.confirm')}
            </Button>
          </div>
        </Modal>
      )}
    </SecaoDeConfiguracoes>
  );
}
