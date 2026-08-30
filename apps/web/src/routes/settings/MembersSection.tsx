import { useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  addProjectMember,
  listProjectMembers,
  mensagemDaApi,
  removeProjectMember,
} from '../../lib/api-client';
import { userIdDaSessao } from '../../lib/auth';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { ROLE_LABEL, ROLE_ORDER, roleAtLeast } from '../../lib/roles';
import type { Role } from '../../lib/api-types';
import { Table, type TableColumn } from '../../components/ui/Table';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { TrashIcon } from '../../components/ui/icons';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/** Duas letras a partir do nome (ou do e-mail, quando não há nome). */
function iniciaisDe(rotulo: string): string {
  const partes = rotulo.split(/[\s@._-]+/u).filter(Boolean);
  const letras =
    partes.length >= 2
      ? partes[0][0] + partes[1][0]
      : (partes[0] ?? '?').slice(0, 2);
  return letras.toUpperCase();
}

/**
 * O avatar do membro é um GRADIENTE no desenho — é o que o distingue do avatar
 * do agente, que tem cor chapada e anel. As duas pontas saem de um hash do
 * e-mail: a mesma pessoa fica com o mesmo par em qualquer tela, e ninguém
 * precisa cadastrar cor de avatar.
 */
const PARES_DE_GRADIENTE = [
  ['var(--accent)', 'var(--warning)'],
  ['var(--success)', 'var(--accent)'],
  ['var(--warning)', 'var(--danger)'],
  ['var(--success)', 'var(--border-strong)'],
  ['var(--danger)', 'var(--accent)'],
] as const;

function gradienteDe(email: string): CSSProperties {
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  const [de, para] = PARES_DE_GRADIENTE[hash % PARES_DE_GRADIENTE.length];
  return { ['--membro-de']: de, ['--membro-para']: para } as CSSProperties;
}

export function MembersSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: members } = useQuery({ queryKey: ['members', projectId], queryFn: () => listProjectMembers(projectId) });
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('developer');

  /**
   * O papel EFETIVO de quem está olhando, NESTE projeto — e não o papel de
   * workspace que `ModelsSection`/`AreaModelsSection` leem.
   *
   * ## Por que `maintainer`, e não o `developer` da seção de modelos
   *
   * O mínimo é do ENDPOINT, nunca da seção vizinha (RN-102), e aqui os TRÊS
   * caminhos pedem `maintainer` (`projects.controller.ts`):
   *
   * | ação | endpoint | papel |
   * |---|---|---|
   * | convidar | `POST :projectId/members` | `maintainer` |
   * | trocar papel | `POST :projectId/members` (upsert) | `maintainer` |
   * | remover | `DELETE :projectId/members/:userId` | `maintainer` |
   * | ver a tabela | `GET :projectId/members` | `viewer` |
   *
   * Copiar o `developer` da tabela de agentes ofereceria os três controles a
   * quem a api recusa — o defeito que a #443 fechou lá, reaberto aqui.
   *
   * ## E por que o papel é o EFETIVO, fechando a lacuna que a RN-102 declarou
   *
   * A #443 declarou um limite: a tela lia o papel de WORKSPACE, e quem autoriza
   * do outro lado é `ResolveEffectiveRoleUseCase.forProject` — a linha de
   * `project_members` SOBREPÕE o workspace, nos dois sentidos. É a MESMA
   * lacuna aqui; a diferença é que esta seção tem com que fechá-la, sem
   * endpoint novo e sem segunda fonte de papel inventada: `listProjectMembers`
   * já É `findMemberRole` para todo mundo, e `userIdDaSessao()` diz qual linha
   * é a minha. A composição abaixo é literalmente a do caso de uso —
   * `projectRole ?? workspaceRole`, e nunca "o maior dos dois".
   *
   * Enquanto a lista não chegou o papel é AUSENTE, não o de workspace: sem ela
   * não dá para saber se existe linha própria, e errar para o lado de
   * desabilitar se conserta recarregando (`roleAtLeast`, mesma régua).
   *
   * Isto NÃO é fronteira de segurança — quem recusa é o `RolesGuard`.
   */
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const meuId = userIdDaSessao();
  const papelEfetivo = members
    ? (members.find((m) => m.userId === meuId)?.role ?? comPapel?.role)
    : undefined;
  const podeEditar = roleAtLeast(papelEfetivo, 'maintainer');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['members', projectId] });
  }

  /**
   * Convidar — o ÚNICO dos três que NÃO usa `mensagemDaApi`, e é deliberado.
   *
   * As duas funções abaixo recebem um `userId` que veio da própria lista, então
   * ele existe: o que sobra ali é 403 (papel vencido) e rede, e nesses casos a
   * frase da api é a informação mais útil que existe. Aqui o `userId` é DIGITADO
   * à mão, e o erro que uma pessoa realmente alcança é apontar para um usuário
   * que não existe — um UUID bem formado passa pelo `@IsUUID()` do
   * `AddMemberDto`, chega ao `insert` e estoura a FK `project_members.user_id →
   * users.id`. Nenhum dos cinco filtros globais (`main.ts:119`) trata violação
   * de FK, então o Nest responde o 500 padrão e `body.message` é
   * "Internal server error" — `mensagemDaApi` devolveria EXATAMENTE essa frase,
   * porque o `padrao` dela só vale para erro que não é `ApiError`.
   *
   * Trocar a dica por ela seria uniformizar a forma e PIORAR o conteúdo, no
   * caminho mais provável desta caixa. Uniformizar por simetria é o que estaria
   * errado; a régua é qual das duas frases ajuda quem está lendo.
   */
  async function handleInvite() {
    if (!inviteUserId.trim()) return;
    try {
      await addProjectMember(projectId, { userId: inviteUserId.trim(), role: inviteRole });
      setInviteUserId('');
      invalidate();
    } catch {
      showToast({
        title: t('members.toast.inviteErrorTitle'),
        message: t('members.toast.inviteErrorMessage'),
        tone: 'danger',
      });
    }
  }

  /**
   * Sem o `try/catch` isto era `unhandled promise rejection`: a pessoa trocava o
   * papel de alguém, o `Select` voltava sozinho ao valor da query e o erro só
   * existia no console — mesma classe que a #440/#441 fechou na tabela de
   * modelos. A lista só é relida no SUCESSO: na recusa nada mudou no banco, e o
   * `Select` não guarda a escolha em estado local (`value` sai de `member.role`),
   * então não há valor recusado para desfazer.
   */
  async function handleRoleChange(userId: string, role: Role) {
    try {
      await addProjectMember(projectId, { userId, role });
      invalidate();
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('members.toast.roleErrorTitle')),
        tone: 'danger',
      });
    }
  }

  /**
   * Falhar calado aqui é o pior dos três: remover alguém é ação consequente e
   * sem volta pela tela (repor exige o UUID, que a linha removida levava
   * junto), e a lista some ou não some sem dizer por quê.
   */
  async function handleRemove(userId: string) {
    try {
      await removeProjectMember(projectId, userId);
      invalidate();
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('members.toast.removeErrorTitle')),
        tone: 'danger',
      });
    }
  }

  const columns: TableColumn<NonNullable<typeof members>[number]>[] = [
    {
      key: 'member',
      label: t('members.table.member'),
      width: '2fr',
      render: (member) => (
        <span className={styles.membroCell}>
          <span className={styles.membroAvatar} style={gradienteDe(member.email)}>
            {iniciaisDe(member.name ?? member.email)}
          </span>
          <span className={styles.memberCell}>
            <span className={styles.memberName}>{member.name ?? member.email}</span>
            <span className={styles.memberEmail}>{member.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      label: t('members.table.role'),
      width: '160px',
      // Desabilitar, não esconder (ADR 0064): sem `maintainer` o papel de cada
      // linha continua LEGÍVEL no próprio `Select` — é a informação central da
      // tabela, e trocá-la por texto para quem não edita esconderia o estado
      // junto com o controle.
      render: (member) => (
        <Select
          value={member.role}
          disabled={!podeEditar}
          onChange={(e) => handleRoleChange(member.userId, e.target.value as Role)}
        >
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'status',
      label: t('members.table.status'),
      width: '1fr',
      render: () => (
        <span className={styles.status}>
          <span className={styles.statusDot} />
          {t('members.table.active')}
        </span>
      ),
    },
    {
      key: 'action',
      label: '',
      width: '56px',
      render: (member) => (
        <button
          type="button"
          aria-label={t('members.table.removeAria', { name: member.name ?? member.email })}
          title={t('members.table.removeTitle')}
          className={styles.remove}
          // O motivo de estar apagado é dito UMA vez, em texto, na legenda da
          // seção — e não aqui: o `title` acima não abre em elemento
          // `disabled` no Chromium (o navegador não despacha evento de mouse em
          // controle desabilitado), e uma linha por membro repetiria um fato
          // sobre QUEM OLHA em cima de cada pessoa da lista.
          disabled={!podeEditar}
          onClick={() => handleRemove(member.userId)}
        >
          <TrashIcon size={14} />
        </button>
      ),
    },
  ];

  return (
    <SecaoDeConfiguracoes chave="members">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('members.title')}</h2>
        <span className={styles.eyebrow}>{t('members.eyebrow')}</span>
      </div>
      <p className={styles.subtitle}>
        {t('members.subtitle')}
        {/*
          O que a coluna PAPEL NO PROJETO significa, dito onde ela é lida.
          `member.role` é a linha de `project_members`, e essa linha é o papel
          efetivo de quem a tem — `ResolveEffectiveRoleUseCase.forProject`
          devolve `projectRole ?? workspaceRole`, uma SOBREPOSIÇÃO e não "o
          maior dos dois". Sem esta frase o `Select` se lê como sugestão
          inofensiva, quando pôr `viewer` aqui rebaixa de verdade — inclusive o
          `owner` do workspace, e só quem tem `maintainer` desfaz.

          A segunda metade declara o que a tabela NÃO mostra: `listMembers` é um
          `innerJoin` em `project_members`, então quem alcança o projeto só pelo
          workspace não aparece em linha nenhuma. Esse dado não está ao alcance
          do cliente — nenhuma consulta do web lista os membros do workspace com
          papel —, então a tela DIZ que é recorte em vez de deixar a lista ser
          lida como "todo mundo que tem acesso" (RN-180).
        */}
        {t('members.subtitleCascata')}
        {/*
          E o motivo dos controles apagados, dito uma vez e em texto: o fato é
          sobre quem está lendo, não sobre uma linha da tabela.
        */}
        {!podeEditar && t('members.subtitleNeedsMaintainer')}
      </p>

      <div className={styles.inviteBar}>
        <div className={styles.inviteInput}>
          <Input
            mono
            placeholder={t('members.invite.placeholder')}
            // A barra inteira, e não só o botão: um campo aberto sobre um botão
            // inerte convida a digitar um UUID para nada.
            disabled={!podeEditar}
            value={inviteUserId}
            onChange={(e) => setInviteUserId(e.target.value)}
          />
        </div>
        <div className={styles.inviteRole}>
          <Select
            value={inviteRole}
            disabled={!podeEditar}
            onChange={(e) => setInviteRole(e.target.value as Role)}
          >
            {ROLE_ORDER.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </Select>
        </div>
        <Button disabled={!podeEditar} onClick={handleInvite}>
          {t('members.invite.button')}
        </Button>
      </div>

      <Table
        columns={columns}
        rows={members ?? []}
        rowKey={(m) => m.userId}
        emptyMessage={t('members.emptyMessage')}
      />
    </SecaoDeConfiguracoes>
  );
}
