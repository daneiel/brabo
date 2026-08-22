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
  canAdvanceFromWorkspace,
  providerNeedsCredential,
  slugify,
  type ModoDeRepositorio,
  type ModoDeWorkspace,
} from '../lib/wizard';
import { BOOTSTRAP_STEPS } from '../lib/bootstrap';
import { CredentialStep } from '../components/wizard/CredentialStep';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Alert } from '../components/ui/Alert';
import { useToast } from '../components/ui/ToastProvider';
import { GitHubIcon, GitLabIcon, LocalRepoIcon, PlusIcon, FolderIcon } from '../components/ui/icons';
import { FolderBrowserModal } from '../components/FolderBrowserModal';
import styles from './NewProjectWizard.module.css';

type StepKey =
  | 'mode'
  | 'provider'
  | 'credential'
  | 'details'
  | 'workspace'
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

// ONDE O COMANDO deste projeto vai EXECUTAR (ADR 0072/0104). Passo próprio,
// e não uma caixinha no passo de detalhes, porque a escolha muda quem é
// dono da pasta — e as variantes `mounted`/`runner` só funcionam com um
// pré-requisito do AMBIENTE (bind-mount, ou o CLI rodando), não um detalhe
// do projeto.
const MODOS_DE_WORKSPACE: {
  id: ModoDeWorkspace;
  label: string;
  desc: string;
}[] = [
  {
    id: 'container',
    label: 'Container',
    desc: 'O Brabo gerencia a pasta, dentro do volume compartilhado com o engine. É o padrão, e não exige nada de você.',
  },
  {
    id: 'mounted',
    label: 'Pasta montada',
    desc: 'O código mora numa pasta SUA. Ela precisa estar montada dentro dos containers da api e do engine, no mesmo caminho.',
  },
  {
    id: 'runner',
    label: 'Runner local',
    desc: 'O código mora numa pasta SUA, sem bind-mount nenhum. Você roda o CLI brabo-runner na sua máquina, e ele confirma o caminho quando conectar.',
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
  workspace: 'Onde o código vai morar',
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
  // `container` é o pré-selecionado, ao contrário do modo de repositório, que
  // nasce sem default: aqui existe SIM uma "normal" — é o comportamento que
  // todo projeto teve até o ADR 0072, e o Local pede preparo do ambiente.
  const [modoDeWorkspace, setModoDeWorkspace] =
    useState<ModoDeWorkspace>('container');
  const [caminhoLocal, setCaminhoLocal] = useState('');
// Navegação de pasta local via o Runner (ADR sobre navegação de pasta via o
// Runner): SEM projeto ainda nesta tela (só nasce na confirmação), o modal
// abre no estado declarado — ver `FolderBrowserModal` sobre `projectId: null`.
const [navegadorDePastaAberto, setNavegadorDePastaAberto] = useState(false);
  const [erroDeCriacao, setErroDeCriacao] = useState<string | null>(null);
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
    keys.push('workspace');
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
      case 'workspace':
        return canAdvanceFromWorkspace(modoDeWorkspace, caminhoLocal);
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
    setErroDeCriacao(null);
    try {
      // Na adoção o nome do PROJETO vem do identificador do repositório
      // (o usuário não digitou nome nenhum) — `acme/checkout` vira
      // "checkout".
      const nomeDoProjeto = adotando ? nomeDoExternalId(externalId) : name;
      const project = await createProject(workspaceId, {
        name: nomeDoProjeto,
        slug: slugify(nomeDoProjeto),
        executionMode: modoDeWorkspace,
        // Só fora do modo Container: mandar o campo vazio junto com
        // `container` é 400 na api, de propósito (campo descartado em
        // silêncio vira "mas eu configurei").
        ...(modoDeWorkspace !== 'container'
          ? { workspacePath: caminhoLocal.trim() }
          : {}),
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
    } catch (error) {
      // A mensagem da api é o produto quando o caminho Local não está montado
      // (RN-170): ela diz o que falta e como montar. Um toast genérico
      // ("Falha ao criar projeto") jogaria fora exatamente a parte útil, então
      // o motivo fica NA TELA, no passo, e não some com o toast.
      const motivo =
        error instanceof ApiError && error.status === 400
          ? mensagemDaApi(error)
          : null;
      setErroDeCriacao(motivo);
      showToast({
        title: motivo ? 'Não deu para criar o projeto' : 'Falha ao criar projeto',
        tone: 'danger',
      });
      setSubmitting(false);
    }
  }

  return (
    <>
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
            {/* Sem dono no rótulo: quem provisiona é o backend, com o dono da
                CREDENCIAL (`createForAuthenticatedUser`). Dizia `brabo/<slug>`,
                fixo no código — e o nome errado ia até a tela de confirmação,
                onde o usuário aprova. Melhor mostrar só o que se sabe. */}
            {slug && <div className={styles.slugPreview}>repo: {slug}</div>}
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
            {/* O plano gratuito do GitHub só protege branch em repositório
                PÚBLICO. Sem este aviso, a escolha "Privado" leva a um
                bootstrap que falha no último passo com a mensagem crua da API
                — e o usuário descobre a limitação do plano dele já com o
                repositório criado. */}
            {provider === 'github' && visibility === 'private' && (
              <Alert tone="warning">
                No plano gratuito do GitHub, <strong>repositório privado não
                aceita proteção de branch</strong>. O projeto funciona e as
                branches são criadas, mas o passo "Proteger branches" vai
                falhar, e o GitHub não impedirá push direto em{' '}
                <code>main</code>, <code>qa</code> e <code>dev</code> — a trava
                de merge do Brabo continua valendo, a do GitHub não.
              </Alert>
            )}
          </div>
        </div>
      )}

      {currentStep === 'workspace' && (
        <div>
          <div className={styles.providerGrid}>
            {MODOS_DE_WORKSPACE.map((m) => (
              <button
                key={m.id}
                type="button"
                className={[
                  styles.providerOption,
                  modoDeWorkspace === m.id && styles.selected,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setModoDeWorkspace(m.id)}
              >
                <span className={styles.providerLabel}>{m.label}</span>
                <span className={styles.providerDesc}>{m.desc}</span>
              </button>
            ))}
          </div>

          {modoDeWorkspace !== 'container' && (
            <div className={styles.field} style={{ marginTop: 16 }}>
              <label className={styles.fieldLabel} htmlFor="workspace-path">
                Caminho da pasta
              </label>
              <div className={styles.toggleRow}>
                <Input
                  id="workspace-path"
                  value={caminhoLocal}
                  onChange={(e) => setCaminhoLocal(e.target.value)}
                  placeholder="/home/voce/projetos/loja"
                  autoFocus
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setNavegadorDePastaAberto(true)}
                >
                  <FolderIcon size={14} />
                  Procurar pasta...
                </Button>
              </div>
              <div className={styles.slugPreview}>
                {modoDeWorkspace === 'mounted'
                  ? 'caminho absoluto, como ele aparece DENTRO do container'
                  : 'caminho absoluto, como ele aparece na SUA máquina'}
              </div>
              {modoDeWorkspace === 'mounted' ? (
                // O aviso é a decisão do dono do produto declarada na tela: o
                // caminho é livre, e livre só funciona se estiver montado. Sem
                // isto, a recusa da api (RN-422) chegaria como surpresa.
                <Alert tone="warning">
                  A pasta precisa estar <strong>montada nos containers</strong> da
                  api e do engine, no <strong>mesmo caminho absoluto</strong> — os
                  dois escrevem no mesmo lugar. No{' '}
                  <code>docker/docker-compose.yml</code>, acrescente{' '}
                  <code>- {caminhoLocal.trim() || '/sua/pasta'}:{caminhoLocal.trim() || '/sua/pasta'}</code>{' '}
                  aos serviços <code>api</code> e <code>engine</code>. Se não
                  estiver, a criação é <strong>recusada</strong> aqui mesmo — o
                  projeto não nasce quebrado.
                </Alert>
              ) : (
                // `runner`: nada aqui trava a criação (RN-423) — o caminho só é
                // confirmado quando o runner conectar, nunca "recusado na hora"
                // como o aviso de `mounted` acima.
                <Alert tone="accent">
                  Depois de criar o projeto, rode na sua máquina:
                  <br />
                  <code>
                    brabo-runner --project &lt;id do projeto&gt; --dir{' '}
                    {caminhoLocal.trim() || '/sua/pasta'}
                  </code>
                  <br />O runner confirma o caminho ao conectar — nenhum comando
                  roda antes disso.
                </Alert>
              )}
            </div>
          )}
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
            {/* Sem `rc`: as permanentes hoje são main, dev e qa — a volta da
                rc/rcfix está no backlog do ADR 0030. */}
            {['main', 'dev', 'qa'].map((b) => (
              <span key={b} className={styles.pill}>
                {b}
              </span>
            ))}
          </div>
          <p className={styles.policyNote}>
            Cascata de promoção: <code>dev ← main</code>, <code>qa ← dev</code>.
            As permanentes recebem proteção
            {provider === 'local'
              ? ' — exceto no Local, que não tem proteção de branch (o passo é pulado com aviso).'
              : ' (main, qa, dev).'}
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
          <SummaryRow
            label="Código em"
            value={
              modoDeWorkspace !== 'container'
                ? caminhoLocal.trim()
                : 'pasta gerenciada pelo Brabo'
            }
            mono={modoDeWorkspace !== 'container'}
          />
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
              <SummaryRow label="Repositório" value={slug} mono />
              <SummaryRow label="Visibilidade" value={visibility === 'private' ? 'Privado' : 'Público'} />
              <SummaryRow label="Bootstrap" value={`${BOOTSTRAP_STEPS.length} passos de Gitflow`} />
            </>
          )}
        </div>
      )}

      {erroDeCriacao && (
        <Alert tone="danger">{erroDeCriacao}</Alert>
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
    {navegadorDePastaAberto && (
      // `projectId={null}`: nesta tela o projeto ainda não existe (só nasce
      // na confirmação) — ver o docblock de `FolderBrowserModal` sobre por
      // que a navegação não tenta conectar a um runner aqui.
      <FolderBrowserModal
        projectId={null}
        caminhoInicial={caminhoLocal.trim() || undefined}
        onSelecionar={(caminho) => setCaminhoLocal(caminho)}
        onClose={() => setNavegadorDePastaAberto(false)}
      />
    )}
    </>
  );
}

/**
 * A frase que a api mandou, quando ela mandou uma.
 *
 * O `message` do Nest chega como string ou como lista (`class-validator`
 * devolve uma por regra violada). Sem esta normalização, a lista viraria
 * `[object Object]` na tela — que é como uma mensagem que ensina vira ruído.
 */
function mensagemDaApi(error: ApiError): string | null {
  const corpo = error.body as { message?: unknown } | null;
  const bruto = corpo?.message;
  if (typeof bruto === 'string') return bruto;
  if (Array.isArray(bruto)) return bruto.filter((m) => typeof m === 'string').join(' ');
  return null;
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
