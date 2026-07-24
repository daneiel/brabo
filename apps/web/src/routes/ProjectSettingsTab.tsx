import { useState, type CSSProperties } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  addProjectMember,
  deleteMyProficiency,
  listInstructionVersions,
  optInProficiency,
  rollbackInstruction,
  deleteCredential,
  getAgentModelBinding,
  listCredentials,
  listModels,
  listProjectMembers,
  removeProjectMember,
  setAgentModelBinding,
  upsertCredential,
} from '../lib/api-client';
import { AGENT_LIST } from '../lib/agents';
import { useLatestSession, useProficiency } from '../lib/hooks';
import type {
  Model,
  ModelBindingScope,
  ProficiencyLevel,
  Role,
} from '../lib/api-types';
import { Table, type TableColumn } from '../components/ui/Table';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { ModelPicker } from '../components/ModelPicker';
import { TrashIcon } from '../components/ui/icons';
import { useToast } from '../components/ui/ToastProvider';
import styles from './ProjectSettingsTab.module.css';

const ROLE_ORDER: Role[] = ['viewer', 'developer', 'maintainer', 'owner'];
const ROLE_LABEL: Record<Role, string> = {
  viewer: 'viewer',
  developer: 'developer',
  maintainer: 'maintainer',
  owner: 'owner',
};

const ORIGIN_TONE: Record<ModelBindingScope, BadgeTone> = {
  workspace: 'muted',
  project: 'warning',
  agent: 'accent',
  session: 'success',
};

const MATRIX_ROWS: { label: string; minRole: Role }[] = [
  { label: 'Merge / abrir PR', minRole: 'maintainer' },
  { label: 'Deploy em produção', minRole: 'maintainer' },
  { label: 'Comando privilegiado', minRole: 'developer' },
  { label: 'Alterar schema/migração', minRole: 'developer' },
  { label: 'Editar permissions.json', minRole: 'maintainer' },
];

const LEVEL_TONE: Record<ProficiencyLevel, BadgeTone> = {
  iniciante: 'muted',
  intermediario: 'warning',
  avancado: 'success',
};

const CREDENTIAL_PROVIDERS: { id: 'anthropic' | 'openai'; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
];

interface ProjectSettingsTabProps {
  projectId: string;
}

export function ProjectSettingsTab({ projectId }: ProjectSettingsTabProps) {
  return (
    <div>
      <ModelsSection projectId={projectId} />
      <MembersSection projectId={projectId} />
      <ProficiencySection projectId={projectId} />
      <InstructionVersionsSection projectId={projectId} />
      <MatrixSection />
      <CredentialsSection />
    </div>
  );
}

function ModelsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: modelsByCategory } = useQuery({ queryKey: ['models'], queryFn: listModels });

  const bindingQueries = useQueries({
    queries: AGENT_LIST.map((agent) => ({
      queryKey: ['agent-binding', projectId, agent.key],
      queryFn: () => getAgentModelBinding(projectId, agent.key),
    })),
  });

  const allModels: Model[] = modelsByCategory
    ? [...Object.values(modelsByCategory.local).flat(), ...Object.values(modelsByCategory.cloud).flat()]
    : [];

  async function handleModelChange(agentKey: string, model: Model) {
    await setAgentModelBinding(projectId, agentKey, model.id);
    queryClient.invalidateQueries({ queryKey: ['agent-binding', projectId, agentKey] });
  }

  const columns: TableColumn<(typeof AGENT_LIST)[number]>[] = [
    {
      key: 'agent',
      label: 'Agente',
      width: '1.4fr',
      render: (agent) => (
        <span className={styles.agentCell}>
          <span className={styles.agentAvatar} style={{ ['--agent-color' as string]: agent.color } as CSSProperties}>
            <agent.icon size={13} />
          </span>
          {agent.name}
        </span>
      ),
    },
    {
      key: 'model',
      label: 'Modelo vigente',
      width: '1.6fr',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        return modelsByCategory ? (
          <ModelPicker
            models={modelsByCategory}
            selectedModelId={resolved?.modelId}
            onSelect={(model) => handleModelChange(agent.key, model)}
            variant="inline"
          />
        ) : null;
      },
    },
    {
      key: 'origin',
      label: 'Origem',
      width: '110px',
      render: (agent) => {
        const index = AGENT_LIST.indexOf(agent);
        const resolved = bindingQueries[index]?.data;
        return resolved ? <Badge tone={ORIGIN_TONE[resolved.origin]}>{resolved.origin}</Badge> : <span className={styles.dash}>—</span>;
      },
    },
    {
      key: 'estimate',
      label: 'Est. mês',
      width: '90px',
      render: () => <span className={styles.dash}>—</span>,
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.title}>Modelos por agente</div>
      <div className={styles.subtitle}>
        Cascata de resolução: workspace → projeto → agente → sessão. Cada nível sobrepõe o anterior quando configurado.
      </div>
      <Table columns={columns} rows={AGENT_LIST} rowKey={(a) => a.key} emptyMessage="Nenhum agente configurado." />
      {allModels.length === 0 && <div className={styles.subtitle}>Nenhum modelo disponível ainda.</div>}
    </div>
  );
}

function MembersSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: members } = useQuery({ queryKey: ['members', projectId], queryFn: () => listProjectMembers(projectId) });
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('developer');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['members', projectId] });
  }

  async function handleInvite() {
    if (!inviteUserId.trim()) return;
    try {
      await addProjectMember(projectId, { userId: inviteUserId.trim(), role: inviteRole });
      setInviteUserId('');
      invalidate();
    } catch {
      showToast({ title: 'Falha ao adicionar membro', message: 'Verifique se o ID do usuário existe', tone: 'danger' });
    }
  }

  async function handleRoleChange(userId: string, role: Role) {
    await addProjectMember(projectId, { userId, role });
    invalidate();
  }

  async function handleRemove(userId: string) {
    await removeProjectMember(projectId, userId);
    invalidate();
  }

  const columns: TableColumn<NonNullable<typeof members>[number]>[] = [
    {
      key: 'member',
      label: 'Membro',
      width: '2fr',
      render: (member) => (
        <span className={styles.memberCell}>
          <span className={styles.memberName}>{member.name ?? member.email}</span>
          <span className={styles.memberEmail}>{member.email}</span>
        </span>
      ),
    },
    {
      key: 'role',
      label: 'Papel no projeto',
      width: '160px',
      render: (member) => (
        <Select value={member.role} onChange={(e) => handleRoleChange(member.userId, e.target.value as Role)}>
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </Select>
      ),
    },
    {
      key: 'action',
      label: 'Ação',
      width: '90px',
      render: (member) => (
        <button type="button" className={styles.remove} onClick={() => handleRemove(member.userId)}>
          <TrashIcon size={14} /> remover
        </button>
      ),
    },
  ];

  return (
    <div className={styles.section}>
      <div className={styles.title}>Membros e papéis</div>
      <div className={styles.subtitle}>Adicione membros pelo ID de usuário (sincronizado via Keycloak no primeiro login).</div>

      <div className={styles.inviteBar}>
        <div className={styles.inviteInput}>
          <Input mono placeholder="ID do usuário (UUID)" value={inviteUserId} onChange={(e) => setInviteUserId(e.target.value)} />
        </div>
        <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
          {ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </Select>
        <Button onClick={handleInvite}>Convidar</Button>
      </div>

      <Table columns={columns} rows={members ?? []} rowKey={(m) => m.userId} emptyMessage="Nenhum membro além do dono do projeto." />
    </div>
  );
}

function MatrixSection() {
  return (
    <div className={styles.section}>
      <div className={styles.title}>Quem pode aprovar o quê</div>
      <div className={styles.subtitle}>
        Tabela informativa — reflete os papéis mínimos por tipo de ação hoje aplicados no backend; algumas linhas ainda não têm checagem
        granular própria e usam a aproximação mais próxima.
      </div>
      <table className={styles.matrixTable}>
        <thead>
          <tr>
            <th>Ação</th>
            <th>owner</th>
            <th>maintainer</th>
            <th>developer</th>
            <th>viewer</th>
          </tr>
        </thead>
        <tbody>
          {MATRIX_ROWS.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              {(['owner', 'maintainer', 'developer', 'viewer'] as Role[]).map((role) => (
                <td key={role}>
                  {ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(row.minRole) ? (
                    <span className={styles.check}>✓</span>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CredentialsSection() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: credentials } = useQuery({ queryKey: ['credentials'], queryFn: listCredentials });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function handleSave(provider: 'anthropic' | 'openai') {
    const apiKey = drafts[provider]?.trim();
    if (!apiKey) return;
    await upsertCredential({ provider, apiKey });
    setDrafts((d) => ({ ...d, [provider]: '' }));
    queryClient.invalidateQueries({ queryKey: ['credentials'] });
    showToast({ title: 'Credencial salva', tone: 'success' });
  }

  async function handleRemove(provider: 'anthropic' | 'openai') {
    await deleteCredential(provider);
    queryClient.invalidateQueries({ queryKey: ['credentials'] });
  }

  return (
    <div className={styles.section}>
      <div className={styles.title}>Credenciais de provider</div>
      <div className={styles.subtitle}>Chaves write-only — nunca reexibidas após salvas.</div>

      {CREDENTIAL_PROVIDERS.map(({ id, label }) => {
        const existing = credentials?.find((c) => c.provider === id);
        return (
          <div key={id} className={styles.credentialCard}>
            <div className={styles.credentialInfo}>
              <div className={styles.credentialProvider}>{label}</div>
              <div className={styles.credentialStatus}>
                {existing ? `Configurado em ${new Date(existing.updatedAt).toLocaleDateString('pt-BR')}` : 'Nenhuma credencial salva'}
              </div>
            </div>
            {!existing && (
              <div className={styles.credentialInput}>
                <Input
                  mono
                  type="password"
                  placeholder="API key"
                  value={drafts[id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                />
              </div>
            )}
            {existing ? (
              <Button variant="danger" onClick={() => handleRemove(id)}>
                Remover
              </Button>
            ) : (
              <Button onClick={() => handleSave(id)}>Salvar</Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Perfil de proficiência (Fase 4b — Anamnese): competência, nível e "os
 * porquês" com evidências clicáveis que navegam até o evento na sessão.
 * O usuário pode apagar o PRÓPRIO perfil — o que também registra o
 * opt-out (senão a rodada seguinte re-derivaria tudo).
 */
function ProficiencySection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { data: profiles } = useProficiency(projectId);
  const { latest: latestSession } = useLatestSession(projectId);

  const all = profiles ?? [];
  const byUser = new Map<string, typeof all>();
  for (const p of all) {
    byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  }

  async function handleDelete() {
    try {
      await deleteMyProficiency(projectId);
      await queryClient.invalidateQueries({ queryKey: ['proficiency', projectId] });
      showToast({
        title: 'Perfil apagado',
        message: 'A Anamnese não vai mais te perfilar até você reativar.',
        tone: 'success',
      });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível apagar o perfil', tone: 'danger' });
    }
  }

  async function handleOptIn() {
    try {
      await optInProficiency(projectId);
      showToast({ title: 'Reativado', message: 'A Anamnese voltará a perfilar você.', tone: 'success' });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível reativar', tone: 'danger' });
    }
  }

  function goToEvidence(eventId: string) {
    if (!latestSession) return;
    navigate({
      to: '/projects/$projectId/sessions/$sessionId',
      params: { projectId, sessionId: latestSession.id },
      search: { highlightEvent: eventId },
    });
  }

  return (
    <div className={styles.section}>
      <div className={styles.title}>Perfil de proficiência</div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        Derivado pela Anamnese a partir das suas interações. Só competências
        técnicas e de processo — nunca características pessoais.
      </div>

      {all.length === 0 ? (
        <div className={styles.subtitle}>
          Nada ainda — a Anamnese roda periodicamente sobre o log do projeto.
        </div>
      ) : (
        [...byUser.entries()].map(([userId, group]) => (
          <div key={userId} className={styles.profileGroup}>
            <div className={styles.profileUser}>{userId}</div>
            {group.map((profile) => (
              <div key={profile.id}>
                <div className={styles.profileRow}>
                  <span className={styles.profileCompetency}>
                    {profile.competency}
                  </span>
                  <Badge tone={LEVEL_TONE[profile.level] ?? 'muted'}>
                    {profile.level}
                  </Badge>
                  <span className={styles.profileWhy}>{profile.rationale}</span>
                </div>
                <div className={styles.evidenceChips}>
                  {profile.evidenceEventIds.map((eventId) => (
                    <button
                      key={eventId}
                      type="button"
                      className={styles.evidenceChip}
                      onClick={() => goToEvidence(eventId)}
                    >
                      {eventId.slice(-8)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button variant="danger" onClick={handleDelete}>
          Apagar meu perfil
        </Button>
        <Button variant="ghost" onClick={handleOptIn}>
          Voltar a ser perfilado
        </Button>
      </div>
    </div>
  );
}

/**
 * Histórico de versões por arquivo de agente (Fase 4b), com diff de cada
 * versão contra a anterior e rollback de um clique. Rollback é operação
 * PRA FRENTE: grava uma versão nova com o conteúdo antigo.
 */
function InstructionVersionsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);

  const versionQueries = useQueries({
    queries: AGENT_LIST.map((agent) => ({
      queryKey: ['instruction-versions', projectId, agent.key],
      queryFn: () => listInstructionVersions(projectId, agent.key),
    })),
  });

  async function handleRollback(agent: string, version: number) {
    try {
      await rollbackInstruction(projectId, agent, version);
      await queryClient.invalidateQueries({
        queryKey: ['instruction-versions', projectId, agent],
      });
      showToast({
        title: 'Revertido',
        message: `${agent} voltou ao conteúdo da v${version}.`,
        tone: 'success',
      });
    } catch {
      showToast({ title: 'Erro', message: 'Não foi possível reverter', tone: 'danger' });
    }
  }

  const withHistory = AGENT_LIST.map((agent, index) => ({
    agent,
    versions: versionQueries[index]?.data ?? [],
  })).filter((entry) => entry.versions.length > 0);

  return (
    <div className={styles.section}>
      <div className={styles.title}>Histórico de instruções</div>
      <div className={styles.subtitle} style={{ marginBottom: 12 }}>
        Cada patch aprovado vira uma versão. Reverter grava uma versão nova
        com o conteúdo antigo — nada é apagado.
      </div>

      {withHistory.length === 0 ? (
        <div className={styles.subtitle}>
          Nenhum agente teve a instrução alterada ainda.
        </div>
      ) : (
        withHistory.map(({ agent, versions }) => (
          <div key={agent.key} className={styles.agentBlock}>
            <div className={styles.profileUser}>{agent.name}</div>
            {versions.map((version) => {
              const key = `${agent.key}:${version.version}`;
              const open = expanded === key;
              return (
                <div key={version.id}>
                  <div className={styles.versionRow}>
                    <span className={styles.versionNo}>v{version.version}</span>
                    {version.isCurrent && <Badge tone="success">atual</Badge>}
                    {version.sourceHypothesisId && (
                      <Badge tone="accent">
                        hipótese {version.sourceHypothesisId.slice(-8)}
                      </Badge>
                    )}
                    <span className={styles.versionNote}>
                      {version.note ?? '—'}
                    </span>
                    <button
                      type="button"
                      className={styles.evidenceChip}
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      {open ? 'ocultar diff' : `diff +${version.diff.additions} −${version.diff.deletions}`}
                    </button>
                    {!version.isCurrent && (
                      <Button
                        variant="secondary"
                        onClick={() => handleRollback(agent.key, version.version)}
                      >
                        Reverter
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div className={styles.versionDiff}>
                      {version.diff.lines.map((line, i) => (
                        <div
                          key={i}
                          className={[
                            styles.diffLine,
                            line.kind === 'add' && styles.add,
                            line.kind === 'del' && styles.del,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <span>
                            {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                          </span>
                          <span>{line.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
