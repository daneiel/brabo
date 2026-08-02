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
  canAdvanceFromDetails,
  canAdvanceFromMode,
  providerNeedsCredential,
  slugify,
  type ModoDeRepositorio,
} from '../lib/wizard';
import { BOOTSTRAP_STEPS } from '../lib/bootstrap';
import { CredentialStep } from '../components/wizard/CredentialStep';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/ToastProvider';
import { GitHubIcon, GitLabIcon, LocalRepoIcon, PlusIcon } from '../components/ui/icons';
import styles from './NewProjectWizard.module.css';

type StepKey =
  | 'mode'
  | 'provider'
  | 'credential'
  | 'details'
  | 'policy'
  | 'confirm';
type Visibility = 'private' | 'public';

const MODOS: { id: ModoDeRepositorio; label: string; desc: string }[] = [
  {
    id: 'create',
    label: 'Criar novo',
    desc: 'O Brabo cria o repositório no provider e roda o bootstrap de Gitflow.',
  },
  {
    id: 'adopt',
    label: 'Adotar existente',
    desc: 'Aponta o projeto para um repositório que já existe. Nada é criado, e nada é alterado sem você aprovar.',
  },
];

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
  mode: 'Criar novo ou adotar existente',
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
  const [modo, setModo] = useState<ModoDeRepositorio | undefined>();
  const [provider, setProvider] = useState<GitProviderName | undefined>();
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
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

  const adotando = modo === 'adopt';

  const stepKeys = useMemo<StepKey[]>(() => {
    const keys: StepKey[] = ['mode', 'provider'];
    if (needsCredential) keys.push('credential');
    keys.push('details');
    // Adotar não passa pela política: o que vai (ou não) acontecer com as
    // branches é decidido depois, na tela do PLANO, contra o repositório
    // real — prometer o template aqui seria mentir sobre o que o
    // bootstrap faria num repo que já tem política própria.
    if (!adotando) keys.push('policy');
    keys.push('confirm');
    return keys;
  }, [needsCredential, adotando]);

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
      case 'mode':
        return canAdvanceFromMode(modo);
      case 'provider':
        return !!provider;
      case 'credential':
        return canAdvanceFromCredential(provider!, selectedCredentialId);
      case 'details':
        return (
          canAdvanceFromDetails(modo!, { name, externalId }) &&
          (adotando || slug.length > 0)
        );
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
      // Na adoção o nome do PROJETO vem do identificador do repositório
      // (o usuário não digitou nome nenhum) — `acme/checkout` vira
      // "checkout".
      const nomeDoProjeto = adotando ? nomeDoExternalId(externalId) : name;
      const project = await createProject(workspaceId, {
        name: nomeDoProjeto,
        slug: slugify(nomeDoProjeto),
      });
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      onClose();
      // Adotar vai para a tela do PLANO, nunca para a de provisionamento:
      // aquela dispara `provisionRepository` ao montar, o que CRIARIA um
      // repositório — exatamente o que a adoção existe para não fazer.
      navigate(
        adotando
          ? {
              to: '/projects/$projectId/adoption',
              params: { projectId: project.id },
              search: { provider, externalId: externalId.trim() },
            }
          : {
              to: '/projects/$projectId/provisioning',
              params: { projectId: project.id },
              search: { provider },
            },
      );
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

      {currentStep === 'mode' && (
        <div className={styles.providerGrid}>
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={[styles.providerOption, modo === m.id && styles.selected]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setModo(m.id)}
            >
              <span className={styles.providerLabel}>{m.label}</span>
              <span className={styles.providerDesc}>{m.desc}</span>
            </button>
          ))}
        </div>
      )}

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

      {currentStep === 'details' && adotando && (
        <div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="repo-external-id">
              Repositório existente
            </label>
            <Input
              id="repo-external-id"
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder={
                provider === 'local' ? '/caminho/do/repo.git' : 'acme/checkout'
              }
              autoFocus
            />
            <div className={styles.slugPreview}>
              {provider === 'local'
                ? 'caminho absoluto do bare repo'
                : 'no formato dono/repositório, como aparece na URL'}
            </div>
          </div>
          <p className={styles.policyNote}>
            Nada é criado e nada é alterado agora. O próximo passo mostra um{' '}
            <strong>plano</strong> do que o bootstrap faria neste repositório —
            e você decide se aplica ou adota como está.
          </p>
        </div>
      )}

      {currentStep === 'details' && !adotando && (
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
          <SummaryRow
            label="Modo"
            value={adotando ? 'Adotar existente' : 'Criar novo'}
          />
          <SummaryRow label="Provider" value={PROVIDERS.find((p) => p.id === provider)?.label ?? '—'} />
          {adotando ? (
            <>
              <SummaryRow label="Repositório" value={externalId.trim()} mono />
              <SummaryRow
                label="Bootstrap"
                value="nada roda sem sua aprovação"
              />
            </>
          ) : (
            <>
              <SummaryRow label="Repositório" value={`brabo/${slug}`} mono />
              <SummaryRow label="Visibilidade" value={visibility === 'private' ? 'Privado' : 'Público'} />
              <SummaryRow label="Bootstrap" value={`${BOOTSTRAP_STEPS.length} passos de Gitflow`} />
            </>
          )}
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
              {submitting
                ? 'Criando…'
                : adotando
                  ? 'Ver o plano'
                  : 'Provisionar'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** `acme/checkout` → `checkout`; `/srv/git/loja.git` → `loja`. */
function nomeDoExternalId(externalId: string): string {
  const ultimo = externalId.trim().replace(/\/+$/, '').split('/').pop() ?? '';
  return ultimo.replace(/\.git$/, '') || externalId.trim();
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={mono ? styles.summaryValueMono : styles.summaryValue}>{value}</span>
    </div>
  );
}
