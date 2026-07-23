import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { GitProviderName } from '../lib/api-types';
import { createProject, provisionRepository } from '../lib/api-client';
import { AGENT_LIST } from '../lib/agents';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/ToastProvider';
import { GitHubIcon, GitLabIcon, LocalRepoIcon, PlusIcon } from '../components/ui/icons';
import styles from './NewProjectWizard.module.css';

const PROVIDERS: { id: GitProviderName; label: string; desc: string; icon: typeof GitHubIcon }[] = [
  { id: 'github', label: 'GitHub', desc: 'Repositório via API do GitHub', icon: GitHubIcon },
  { id: 'gitlab', label: 'GitLab', desc: 'Repositório via API do GitLab', icon: GitLabIcon },
  { id: 'local', label: 'Local', desc: 'Repositório git local, sem provider externo', icon: LocalRepoIcon },
];

type BranchPolicy = 'gitflow' | 'trunk' | 'custom';

const BRANCH_PREVIEW: Record<BranchPolicy, string[]> = {
  gitflow: ['dev', 'qa', 'rc', 'main'],
  trunk: ['main'],
  custom: ['main'],
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

interface NewProjectWizardProps {
  workspaceId: string;
  onClose: () => void;
}

export function NewProjectWizard({ workspaceId, onClose }: NewProjectWizardProps) {
  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<GitProviderName | undefined>();
  const [name, setName] = useState('');
  const [branchPolicy, setBranchPolicy] = useState<BranchPolicy>('gitflow');
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set(AGENT_LIST.map((a) => a.key)));
  const [submitting, setSubmitting] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const slug = slugify(name);
  const canAdvance = step === 1 ? !!provider : step === 2 ? slug.length > 0 : true;

  function toggleAgent(key: string) {
    setSelectedAgents((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSubmit() {
    if (!provider) return;
    setSubmitting(true);
    try {
      const project = await createProject(workspaceId, { name, slug });
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      try {
        await provisionRepository(project.id, provider, { name: slug, visibility: 'private' });
        showToast({ title: 'Projeto criado', message: `${name} provisionado com sucesso`, tone: 'success' });
        onClose();
        navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
      } catch {
        onClose();
        navigate({ to: '/git-error', search: { projectId: project.id, provider } });
      }
    } catch {
      showToast({ title: 'Falha ao criar projeto', tone: 'danger' });
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Novo projeto" icon={<PlusIcon size={16} />} onClose={onClose}>
      <div className={styles.stepper}>
        {[1, 2, 3, 4].map((n) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: n === 4 ? '0 0 auto' : 1 }}>
            <span className={[styles.stepCircle, n < step && styles.done, n === step && styles.current].filter(Boolean).join(' ')}>
              {n}
            </span>
            {n < 4 && <span className={[styles.stepLine, n < step && styles.done].filter(Boolean).join(' ')} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className={styles.providerGrid}>
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                type="button"
                className={[styles.providerOption, provider === p.id && styles.selected].filter(Boolean).join(' ')}
                onClick={() => setProvider(p.id)}
              >
                <Icon size={20} />
                <span className={styles.providerLabel}>{p.label}</span>
                <span className={styles.providerDesc}>{p.desc}</span>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="project-name">
            Nome do projeto
          </label>
          <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Loja Online" autoFocus />
          {slug && <div className={styles.slugPreview}>repo: brabo/{slug}</div>}
        </div>
      )}

      {step === 3 && (
        <div>
          {(['gitflow', 'trunk', 'custom'] as BranchPolicy[]).map((policy) => (
            <label key={policy} className={styles.radioRow}>
              <input type="radio" checked={branchPolicy === policy} onChange={() => setBranchPolicy(policy)} />
              {policy === 'gitflow' ? 'Gitflow' : policy === 'trunk' ? 'Trunk-based' : 'Personalizada'}
            </label>
          ))}
          <div className={styles.branchPills}>
            {BRANCH_PREVIEW[branchPolicy].map((b) => (
              <span key={b} className={styles.pill}>
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <div className={styles.agentCounter}>{selectedAgents.size} agentes selecionados</div>
          <div className={styles.agentList}>
            {AGENT_LIST.map((agent) => (
              <label key={agent.key} className={styles.agentRow}>
                <input type="checkbox" checked={selectedAgents.has(agent.key)} onChange={() => toggleAgent(agent.key)} />
                {agent.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className={styles.footer}>
        {step > 1 ? (
          <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={submitting}>
            Voltar
          </Button>
        ) : (
          <span />
        )}
        <span className={styles.stepLabel}>passo {step} de 4</span>
        <div className={styles.footerActions}>
          {step < 4 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
              Continuar
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Criando…' : 'Criar projeto'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
