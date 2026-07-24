import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitProviderName } from '../lib/api-types';
import {
  ApiError,
  createProject,
  listCredentials,
  registerGitCredential,
} from '../lib/api-client';
import {
  canAdvanceFromCredential,
  providerNeedsCredential,
  slugify,
} from '../lib/wizard';
import { BOOTSTRAP_STEPS } from '../lib/bootstrap';
import { CredentialStep } from '../components/wizard/CredentialStep';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/ToastProvider';
import { GitHubIcon, GitLabIcon, LocalRepoIcon, PlusIcon } from '../components/ui/icons';
import styles from './NewProjectWizard.module.css';

type StepKey = 'provider' | 'credential' | 'details' | 'policy' | 'confirm';
type Visibility = 'private' | 'public';

const PROVIDERS: {
  id: GitProviderName;
  label: string;
  desc: string;
  icon: typeof GitHubIcon;
}[] = [
  { id: 'github', label: 'GitHub', desc: 'Repositório via API do GitHub', icon: GitHubIcon },
  { id: 'gitlab', label: 'GitLab', desc: 'Repositório via API do GitLab', icon: GitLabIcon },
  { id: 'local', label: 'Local', desc: 'Repositório git local, sem provider externo', icon: LocalRepoIcon },
];

const STEP_TITLE: Record<StepKey, string> = {
  provider: 'Onde hospedar',
  credential: 'Credencial de acesso',
  details: 'Nome e visibilidade',
  policy: 'Política de branches',
  confirm: 'Confirmar',
};

interface NewProjectWizardProps {
  workspaceId: string;
  onClose: () => void;
}

export function NewProjectWizard({ workspaceId, onClose }: NewProjectWizardProps) {
  const [provider, setProvider] = useState<GitProviderName | undefined>();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>();
  const [registering, setRegistering] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const slug = slugify(name);
  const needsCredential = !!provider && providerNeedsCredential(provider);

  const stepKeys = useMemo<StepKey[]>(() => {
    const keys: StepKey[] = ['provider'];
    if (needsCredential) keys.push('credential');
    keys.push('details', 'policy', 'confirm');
    return keys;
  }, [needsCredential]);

  const currentStep = stepKeys[stepIndex];

  const credentialsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: listCredentials,
    enabled: needsCredential,
  });
  const providerCredentials = useMemo(
    () =>
      (credentialsQuery.data ?? []).filter((c) => c.provider === provider),
    [credentialsQuery.data, provider],
  );

  // Auto-seleciona a primeira credencial existente do provider (frictionless
  // "selecionar existente"); quando não há nenhuma, nada é selecionado e o
  // avanço fica bloqueado até cadastrar uma.
  useEffect(() => {
    if (!needsCredential) return;
    if (!selectedCredentialId && providerCredentials.length > 0) {
      setSelectedCredentialId(providerCredentials[0].id);
    }
  }, [needsCredential, providerCredentials, selectedCredentialId]);

  function canAdvance(): boolean {
    switch (currentStep) {
      case 'provider':
        return !!provider;
      case 'credential':
        return canAdvanceFromCredential(provider!, selectedCredentialId);
      case 'details':
        return slug.length > 0;
      default:
        return true;
    }
  }

  async function handleRegister(token: string) {
    if (!provider || !providerNeedsCredential(provider)) return;
    setRegistering(true);
    setCredError(null);
    try {
      const cred = await registerGitCredential({ provider, token });
      await queryClient.invalidateQueries({ queryKey: ['credentials'] });
      setSelectedCredentialId(cred.id);
      showToast({ title: 'Token validado', tone: 'success' });
    } catch (error) {
      setCredError(
        error instanceof ApiError && error.status === 422
          ? 'Token inválido ou sem escopo suficiente. Confira e tente de novo.'
          : 'Não foi possível validar o token agora.',
      );
    } finally {
      setRegistering(false);
    }
  }

  async function handleConfirm() {
    if (!provider) return;
    setSubmitting(true);
    try {
      const project = await createProject(workspaceId, { name, slug });
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      onClose();
      navigate({
        to: '/projects/$projectId/provisioning',
        params: { projectId: project.id },
        search: { provider },
      });
    } catch {
      showToast({ title: 'Falha ao criar projeto', tone: 'danger' });
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Novo projeto" icon={<PlusIcon size={16} />} onClose={onClose}>
      <div className={styles.stepper}>
        {stepKeys.map((key, n) => (
          <div
            key={key}
            style={{ display: 'flex', alignItems: 'center', flex: n === stepKeys.length - 1 ? '0 0 auto' : 1 }}
          >
            <span
              className={[
                styles.stepCircle,
                n < stepIndex && styles.done,
                n === stepIndex && styles.current,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {n + 1}
            </span>
            {n < stepKeys.length - 1 && (
              <span className={[styles.stepLine, n < stepIndex && styles.done].filter(Boolean).join(' ')} />
            )}
          </div>
        ))}
      </div>

      <div className={styles.stepTitle}>{STEP_TITLE[currentStep]}</div>

      {currentStep === 'provider' && (
        <div className={styles.providerGrid}>
          {PROVIDERS.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                type="button"
                className={[styles.providerOption, provider === p.id && styles.selected].filter(Boolean).join(' ')}
                onClick={() => {
                  setProvider(p.id);
                  setSelectedCredentialId(undefined);
                  setCredError(null);
                }}
              >
                <Icon size={20} />
                <span className={styles.providerLabel}>{p.label}</span>
                <span className={styles.providerDesc}>{p.desc}</span>
              </button>
            );
          })}
        </div>
      )}

      {currentStep === 'credential' && provider && provider !== 'local' && (
        <CredentialStep
          provider={provider}
          credentials={providerCredentials}
          selectedId={selectedCredentialId}
          onSelect={setSelectedCredentialId}
          onRegister={handleRegister}
          registering={registering}
          error={credError}
        />
      )}

      {currentStep === 'details' && (
        <div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="project-name">
              Nome do projeto
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Loja Online"
              autoFocus
            />
            {slug && <div className={styles.slugPreview}>repo: brabo/{slug}</div>}
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Visibilidade</span>
            <div className={styles.toggleRow}>
              {(['private', 'public'] as Visibility[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={[styles.toggleOption, visibility === v && styles.selected].filter(Boolean).join(' ')}
                  onClick={() => setVisibility(v)}
                >
                  {v === 'private' ? 'Privado' : 'Público'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {currentStep === 'policy' && (
        <div className={styles.policy}>
          <p className={styles.policyIntro}>
            Ao provisionar, o bootstrap de Gitflow roda estes passos no repo:
          </p>
          <ol className={styles.policySteps}>
            {BOOTSTRAP_STEPS.map((step) => (
              <li key={step.name}>{step.label}</li>
            ))}
          </ol>
          <div className={styles.branchPills}>
            {['main', 'dev', 'qa', 'rc'].map((b) => (
              <span key={b} className={styles.pill}>
                {b}
              </span>
            ))}
          </div>
          <p className={styles.policyNote}>
            Cascata de promoção: <code>dev ← main</code>, <code>qa ← dev</code>,{' '}
            <code>rc ← qa</code>. As permanentes recebem proteção
            {provider === 'local'
              ? ' — exceto no Local, que não tem proteção de branch (o passo é pulado com aviso).'
              : ' (main, rc, qa, dev).'}
          </p>
        </div>
      )}

      {currentStep === 'confirm' && (
        <div className={styles.summary}>
          <SummaryRow label="Provider" value={PROVIDERS.find((p) => p.id === provider)?.label ?? '—'} />
          <SummaryRow label="Repositório" value={`brabo/${slug}`} mono />
          <SummaryRow label="Visibilidade" value={visibility === 'private' ? 'Privado' : 'Público'} />
          <SummaryRow label="Bootstrap" value={`${BOOTSTRAP_STEPS.length} passos de Gitflow`} />
        </div>
      )}

      <div className={styles.footer}>
        {stepIndex > 0 ? (
          <Button variant="ghost" onClick={() => setStepIndex((s) => s - 1)} disabled={submitting}>
            Voltar
          </Button>
        ) : (
          <span />
        )}
        <span className={styles.stepLabel}>
          passo {stepIndex + 1} de {stepKeys.length}
        </span>
        <div className={styles.footerActions}>
          {currentStep !== 'confirm' ? (
            <Button onClick={() => setStepIndex((s) => s + 1)} disabled={!canAdvance()}>
              Continuar
            </Button>
          ) : (
            <Button variant="success" onClick={handleConfirm} disabled={submitting}>
              {submitting ? 'Criando…' : 'Provisionar'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={mono ? styles.summaryValueMono : styles.summaryValue}>{value}</span>
    </div>
  );
}
