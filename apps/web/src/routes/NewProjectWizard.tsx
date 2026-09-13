import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import type { GitProviderName } from '../lib/api-types';
import {
  ApiError,
  createProject,
  getProjectsBase,
  listCredentials,
  registerGitCredential,
} from '../lib/api-client';
import {
  caminhoDentroDaBase,
  caminhoSugeridoNaBase,
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
import {
  FolderBrowserModal,
  type OrigemDoNavegador,
} from '../components/FolderBrowserModal';
import { RunnerOnboardingPanel } from '../components/RunnerOnboardingPanel';
import styles from './NewProjectWizard.module.css';

type StepKey =
  | 'mode'
  | 'provider'
  | 'credential'
  | 'details'
  | 'confirm';
type Visibility = 'private' | 'public';

const MODOS: { id: ModoDeRepositorio; labelKey: string; descKey: string }[] = [
  { id: 'create', labelKey: 'mode.create.label', descKey: 'mode.create.desc' },
  { id: 'adopt', labelKey: 'mode.adopt.label', descKey: 'mode.adopt.desc' },
];

// ONDE O COMANDO deste projeto vai EXECUTAR (ADR 0072/0104). Passo próprio,
// e não uma caixinha no passo de detalhes, porque a escolha muda quem é
// dono da pasta — e as variantes `mounted`/`runner` só funcionam com um
// pré-requisito do AMBIENTE (bind-mount, ou o CLI rodando), não um detalhe
// do projeto.
const MODOS_DE_WORKSPACE: {
  id: ModoDeWorkspace;
  labelKey: string;
  descKey: string;
}[] = [
  { id: 'container', labelKey: 'workspaceMode.container.label', descKey: 'workspaceMode.container.desc' },
  { id: 'mounted', labelKey: 'workspaceMode.mounted.label', descKey: 'workspaceMode.mounted.desc' },
  { id: 'runner', labelKey: 'workspaceMode.runner.label', descKey: 'workspaceMode.runner.desc' },
];

const PROVIDERS: {
  id: GitProviderName;
  labelKey: string;
  descKey: string;
  icon: typeof GitHubIcon;
}[] = [
  { id: 'github', labelKey: 'provider.github.label', descKey: 'provider.github.desc', icon: GitHubIcon },
  { id: 'gitlab', labelKey: 'provider.gitlab.label', descKey: 'provider.gitlab.desc', icon: GitLabIcon },
  { id: 'local', labelKey: 'provider.local.label', descKey: 'provider.local.desc', icon: LocalRepoIcon },
];

// Navegação antecipada de pasta (RN-437, ADR 0108). Só os campos que
// determinam a IDENTIDADE do projeto — nunca `caminhoLocal`: o propósito
// inteiro de navegar é REFINAR o caminho depois de já existir um projeto, e
// incluí-lo no snapshot invalidaria o reuso a cada clique em "Procurar
// pasta...".
interface SnapshotDeIdentidade {
  name: string;
  externalId: string;
  adotando: boolean;
}

function snapshotDeIdentidade(input: {
  adotando: boolean;
  name: string;
  externalId: string;
}): SnapshotDeIdentidade {
  return { name: input.name, externalId: input.externalId, adotando: input.adotando };
}

function mesmaIdentidade(a: SnapshotDeIdentidade, b: SnapshotDeIdentidade): boolean {
  return a.name === b.name && a.externalId === b.externalId && a.adotando === b.adotando;
}

/**
 * Payload de `createProject`, reaproveitado pelos DOIS caminhos que criam o
 * projeto: a confirmação final de sempre, e a criação ANTECIPADA (só modo
 * `runner`, ao clicar "Procurar pasta..." — RN-437, ADR 0108).
 * `workspacePath` já vem resolvido pelo chamador (recortado, com o
 * placeholder aplicado quando for o caso) — esta função só monta a forma
 * que a api espera, sem decidir nada sobre o caminho.
 */
function montarPayloadDeCriacao(input: {
  adotando: boolean;
  name: string;
  externalId: string;
  modoDeWorkspace: ModoDeWorkspace;
  workspacePath: string;
}): { name: string; slug: string; executionMode: ModoDeWorkspace; workspacePath?: string } {
  const nomeDoProjeto = input.adotando ? nomeDoExternalId(input.externalId) : input.name;
  return {
    name: nomeDoProjeto,
    slug: slugify(nomeDoProjeto),
    executionMode: input.modoDeWorkspace,
    // Só fora do modo Container: mandar o campo vazio junto com `container`
    // é 400 na api, de propósito (campo descartado em silêncio vira "mas eu
    // configurei").
    ...(input.modoDeWorkspace !== 'container' ? { workspacePath: input.workspacePath } : {}),
  };
}

// Placeholder lexicalmente válido (`caminhoLocalParecePlausivel`: absoluto,
// um segmento só, não é raiz) e claramente PROVISÓRIO — usado só quando o
// usuário clica "Procurar pasta..." antes de digitar nada. Nunca é a fonte
// da verdade: quando um runner de verdade conecta, ele sobrescreve
// `workspacePath` com o caminho real que reporta (RN-423).
const CAMINHO_PROVISORIO = '/workspace-a-confirmar';

const STEP_TITLE_KEY: Record<StepKey, string> = {
  mode: 'steps.mode',
  provider: 'steps.provider',
  credential: 'steps.credential',
  details: 'steps.details',
  confirm: 'steps.confirm',
};

interface NewProjectWizardProps {
  workspaceId: string;
  onClose: () => void;
}

export function NewProjectWizard({ workspaceId, onClose }: NewProjectWizardProps) {
  const { t } = useTranslation('newProject');
  const [modo, setModo] = useState<ModoDeRepositorio | undefined>();
  const [provider, setProvider] = useState<GitProviderName | undefined>();
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  // O modo que o USUÁRIO escolheu, e só ele — `undefined` é "ainda não
  // tocou nos cards". O modo VIGENTE é derivado logo abaixo, porque desde o
  // ADR 0146 (ponto 4) o default depende da instalação: com base consentida,
  // `mounted` é o pré-selecionado; sem ela, `container` continua sendo (o
  // default do ADR 0072). Guardar a escolha separada do vigente é o que
  // impede a pré-seleção de trocar o modo debaixo da mão de quem já clicou
  // — a base chega por rede, sempre DEPOIS do primeiro render (RN-513).
  const [modoDeWorkspaceEscolhido, setModoDeWorkspaceEscolhido] =
    useState<ModoDeWorkspace>();
  const [caminhoLocal, setCaminhoLocal] = useState('');
  // A última sugestão `<base>/<slug>` que ESTA tela escreveu no campo. Sem
  // ela não há como distinguir "campo com a sugestão de antes" (pode ser
  // refeito quando o nome muda) de "campo digitado pelo usuário" (nunca se
  // toca) — as duas são apenas uma string.
  const [caminhoSugeridoAplicado, setCaminhoSugeridoAplicado] = useState<
    string | null
  >(null);
  // Navegação de pasta (ADR 0107/0108, RN-504, RN-533). No modo `mounted` o
  // modal fala com a API e não precisa de projeto nenhum: a base é da
  // INSTALAÇÃO. No modo `runner` ele fala com o agente local pelo canal, e o
  // ticket desse canal é escopado a um `projectId` real — por isso o clique
  // em "Procurar pasta..." cria o projeto ANTECIPADAMENTE
  // (`handleProcurarPasta`), e `projetoParaNavegar` guarda o id criado com o
  // SNAPSHOT de identidade que autorizou a criação, pra saber quando é
  // seguro reusar em vez de criar de novo.
  const [navegadorDePastaAberto, setNavegadorDePastaAberto] = useState(false);
  const [projetoParaNavegar, setProjetoParaNavegar] = useState<
    { id: string; snapshot: SnapshotDeIdentidade } | undefined
  >();
  const [criandoParaNavegar, setCriandoParaNavegar] = useState(false);
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

  /**
   * A base dos projetos montados (ADR 0141/0146 ponto 4, RN-500/RN-513).
   *
   * A consulta nasce com o WIZARD, não com o passo — o passo de workspace é
   * o quinto, e um `useQuery` montado só ali faria o card aparecer piscando
   * depois que a pessoa já estivesse olhando a tela.
   */
  const projectsBaseQuery = useQuery({
    queryKey: ['projects-base', workspaceId],
    queryFn: () => getProjectsBase(workspaceId),
    staleTime: 10 * 60 * 1000,
  });

  /**
   * `mounted` só é oferecido quando a base é CONHECIDA e existe.
   *
   * Enquanto a resposta não chegou, e também quando a consulta FALHA (403,
   * rede, api fora), o modo não aparece e `container` segue selecionado.
   * Falha não é permissão para oferecer um modo cuja pré-condição não se
   * conseguiu confirmar: é a mesma régua da RN-088/RN-468 — o produto não
   * colapsa "não sei" com "não tem" — e a dos ADRs 0041/0042, onde
   * capability só é declarada quando PROVADA. Oferecer no escuro terminaria
   * na recusa da api (400) depois de a pessoa ter escolhido o modo, digitado
   * o caminho e chegado ao fim do assistente.
   */
  const podeOferecerMounted =
    projectsBaseQuery.isSuccess &&
    projectsBaseQuery.data.projectsBase !== null;
  const baseDeProjetos = podeOferecerMounted
    ? (projectsBaseQuery.data?.projectsBase ?? null)
    : null;

  // O modo VIGENTE: a escolha humana quando existe, senão o default da
  // instalação. Uma escolha em `mounted` que deixe de ser oferecível (a
  // consulta invalidada devolvendo `null`) cai para o default em vez de
  // ficar apontando para um card que saiu da tela.
  const modoDeWorkspace: ModoDeWorkspace =
    modoDeWorkspaceEscolhido !== undefined &&
    (modoDeWorkspaceEscolhido !== 'mounted' || podeOferecerMounted)
      ? modoDeWorkspaceEscolhido
      : podeOferecerMounted
        ? 'mounted'
        : 'container';

  /**
   * DE ONDE o navegador de pastas lê o disco, decidido pelo MODO (RN-533).
   *
   * `undefined` só acontece em `runner` antes de a criação antecipada ter
   * dado certo — e aí o modal simplesmente não monta, porque
   * `handleProcurarPasta` nem chega a abri-lo. Representar isso como
   * `undefined` em vez de cair no transporte de api é deliberado: o silêncio
   * é honesto, e o fallback mostraria o disco do SERVIDOR a quem escolheu
   * o modo em que a pasta mora na máquina dele.
   */
  const origemDoNavegador: OrigemDoNavegador | undefined =
    modoDeWorkspace === 'runner'
      ? projetoParaNavegar
        ? { tipo: 'runner', projectId: projetoParaNavegar.id }
        : undefined
      : { tipo: 'api', workspaceId };

  // Campo VAZIO não é "fora da base": não há caminho para a api recusar
  // ainda, e alarmar antes de a pessoa digitar seria a tela afirmando sobre
  // o que não tem.
  const caminhoForaDaBase =
    caminhoLocal.trim() !== '' &&
    !caminhoDentroDaBase(caminhoLocal, baseDeProjetos);

  const modosDeWorkspaceOferecidos = useMemo(
    () =>
      MODOS_DE_WORKSPACE.filter(
        (m) => m.id !== 'mounted' || podeOferecerMounted,
      ),
    [podeOferecerMounted],
  );

  /**
   * A sugestão `<base>/<slug>` (RN-501, ADR 0142), que NUNCA clobbera o que
   * foi digitado.
   *
   * Ela entra em dois casos, e só neles: o campo está vazio e nada foi
   * sugerido ainda, ou o campo contém exatamente a sugestão anterior desta
   * tela (o nome do projeto mudou no passo de detalhes, e a sugestão
   * acompanha). Campo com qualquer outra coisa — inclusive vazio DEPOIS de
   * o usuário ter apagado a sugestão — fica como está.
   *
   * Slug vazio (a adoção, onde o nome vem do provider) não vira segmento
   * inventado: `caminhoSugeridoNaBase` devolve vazio e o campo continua
   * vazio, com `canAdvanceFromWorkspace` segurando o passo até alguém
   * digitar.
   */
  useEffect(() => {
    if (modoDeWorkspace !== 'mounted') return;
    const sugestao = caminhoSugeridoNaBase(baseDeProjetos, slug);
    if (sugestao === '' || sugestao === caminhoLocal) return;
    const campoLivre =
      caminhoSugeridoAplicado === null
        ? caminhoLocal === ''
        : caminhoLocal === caminhoSugeridoAplicado;
    if (!campoLivre) return;
    setCaminhoLocal(sugestao);
    setCaminhoSugeridoAplicado(sugestao);
  }, [
    modoDeWorkspace,
    baseDeProjetos,
    slug,
    caminhoLocal,
    caminhoSugeridoAplicado,
  ]);

  const stepKeys = useMemo<StepKey[]>(() => {
    // Provider e credencial são do caminho de ADOÇÃO, e só dele (RN-541).
    //
    // Criar um projeto deixou de provisionar repositório: o git nasce quando o
    // Arquiteto passa o handoff ao Dev Lead, e nasce `local`, que é o único
    // provider que não pede credencial nenhuma. Perguntar "onde hospedar" na
    // criação seria perguntar por uma decisão que a tela não vai usar — e
    // cobrar um PAT para um repositório que ninguém vai criar agora.
    //
    // Adotar é o oposto por construção: aponta para um repositório que JÁ
    // existe, e sem provider não há o que apontar.
    const keys: StepKey[] = ['mode'];
    if (adotando) {
      keys.push('provider');
      if (needsCredential) keys.push('credential');
    }
    // Destino e identificação num passo só: `details` agora carrega os dois.
    keys.push('details');
    // O passo "Política de branches" SAIU, e não por espaço: ele não era
    // escolha nenhuma — o payload de criação nunca teve campo de política, e
    // o bootstrap roda igual na api. Uma tela que pergunta o que não usa
    // ensina que ali há decisão. O que ele mostrava de útil (quantos passos
    // de Gitflow vêm a seguir) continua no resumo do Confirmar, que é onde
    // se aprova.
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
        // CONJUNÇÃO dos dois gates que existiam quando isto eram dois passos.
        // Um `||` aqui deixaria avançar sem nome, ou com caminho inválido.
        return (
          canAdvanceFromDetails(modo!, { name, externalId }) &&
          (adotando || slug.length > 0) &&
          canAdvanceFromWorkspace(modoDeWorkspace, caminhoLocal)
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
      showToast({ title: t('credential.tokenValidated'), tone: 'success' });
    } catch (error) {
      setCredError(
        error instanceof ApiError && error.status === 422
          ? t('credential.errors.invalidToken')
          : t('credential.errors.generic'),
      );
    } finally {
      setRegistering(false);
    }
  }

  /**
   * "Procurar pasta..." (RN-437, ADR 0108). Fora do modo `runner`, só abre o
   * modal — ele navega a base pela API, que não depende de projeto nenhum
   * existir (RN-504). No modo `runner`, o modal precisa de um projeto real
   * pra ancorar o ticket do canal do agente local (RN-533): se já existe um
   * criado ANTECIPADAMENTE e a identidade (nome/externalId/adotando) não
   * mudou desde então, reusa; senão cria agora, com o caminho digitado ou o
   * placeholder provisório.
   *
   * Falhar aqui NÃO abre o modal — sem projeto não há transporte de runner a
   * montar, e abrir "no que der" cairia na base do servidor com o rótulo
   * errado. O toast diz que a preparação falhou, e o campo de texto continua
   * sendo o caminho que sempre funcionou.
   */
  async function handleProcurarPasta() {
    if (modoDeWorkspace !== 'runner') {
      setNavegadorDePastaAberto(true);
      return;
    }

    const snapshotAtual = snapshotDeIdentidade({ adotando, name, externalId });
    if (projetoParaNavegar && mesmaIdentidade(projetoParaNavegar.snapshot, snapshotAtual)) {
      setNavegadorDePastaAberto(true);
      return;
    }

    setCriandoParaNavegar(true);
    try {
      const project = await createProject(
        workspaceId,
        montarPayloadDeCriacao({
          adotando,
          name,
          externalId,
          modoDeWorkspace,
          workspacePath: caminhoLocal.trim() || CAMINHO_PROVISORIO,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      setProjetoParaNavegar({ id: project.id, snapshot: snapshotAtual });
      setNavegadorDePastaAberto(true);
    } catch {
      showToast({
        title: t('toasts.folderNavigationPrepareFailed'),
        tone: 'danger',
      });
    } finally {
      setCriandoParaNavegar(false);
    }
  }

  async function handleConfirm() {
    // A guarda é da ADOÇÃO: lá o provider é obrigatório e vai no `search` da
    // tela de plano. Ao criar ele é `undefined` no caso normal, e o `return`
    // incondicional que existia aqui faria o botão não fazer NADA, em silêncio.
    if (adotando && !provider) return;
    setSubmitting(true);
    setErroDeCriacao(null);
    try {
      const snapshotAtual = snapshotDeIdentidade({ adotando, name, externalId });
      // Reusa o projeto criado ao navegar em vez de criar de novo — duas
      // linhas pro mesmo clique de "Provisionar"/"Ver o plano" seria bug,
      // não feature (RN-437). Se o wizard for fechado sem chegar até aqui,
      // o projeto criado antecipadamente fica "não provisionado": o MESMO
      // estado que qualquer criação interrompida já produz hoje — não é
      // regressão desta entrega.
      const podeReaproveitar =
        modoDeWorkspace === 'runner' &&
        !!projetoParaNavegar &&
        mesmaIdentidade(projetoParaNavegar.snapshot, snapshotAtual);

      const project = podeReaproveitar
        ? { id: projetoParaNavegar!.id }
        : await createProject(
            workspaceId,
            montarPayloadDeCriacao({
              adotando,
              name,
              externalId,
              modoDeWorkspace,
              workspacePath: caminhoLocal.trim(),
            }),
          );
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
              search: { provider: provider!, externalId: externalId.trim() },
            }
          : // Criar vai direto para o PROJETO (RN-541). Ir para a tela de
            // provisionamento era o que fazia criar projeto e provisionar git
            // serem o mesmo gesto: ela é o ÚNICO chamador de
            // `provisionRepository` no web, e o disparo mora no efeito de
            // montagem dela. Não passar por lá é, literalmente, o adiamento do
            // git. A rota continua existindo — o Dashboard leva a ela quando o
            // provisionamento FALHOU e precisa ser retomado.
            {
              to: '/projects/$projectId',
              params: { projectId: project.id },
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
        title: motivo ? t('toasts.createFailedWithReason') : t('toasts.createFailedGeneric'),
        tone: 'danger',
      });
      setSubmitting(false);
    }
  }

  return (
    <>
    <Modal title={t('modal.title')} icon={<PlusIcon size={16} />} onClose={onClose}>
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

      <div className={styles.stepTitle}>{t(STEP_TITLE_KEY[currentStep])}</div>

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
              <span className={styles.providerLabel}>{t(m.labelKey)}</span>
              <span className={styles.providerDesc}>{t(m.descKey)}</span>
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
                <span className={styles.providerLabel}>{t(p.labelKey)}</span>
                <span className={styles.providerDesc}>{t(p.descKey)}</span>
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

      {/* UM passo, com o DESTINO acima da identificação — é o destino que
          decide se existe campo de caminho, e pedir o nome primeiro era
          mostrar a consequência depois da escolha fácil. Os dois eram
          passos separados; o gate deste é a CONJUNÇÃO dos dois que
          existiam, e um `||` no lugar do `&&` deixaria avançar sem nome. */}
      {currentStep === 'details' && (
        <div>
        <div>
          <div className={styles.providerGrid}>
            {modosDeWorkspaceOferecidos.map((m) => (
              <button
                key={m.id}
                type="button"
                className={[
                  styles.providerOption,
                  modoDeWorkspace === m.id && styles.selected,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setModoDeWorkspaceEscolhido(m.id)}
              >
                <span className={styles.providerLabel}>{t(m.labelKey)}</span>
                <span className={styles.providerDesc}>{t(m.descKey)}</span>
              </button>
            ))}
          </div>

          {modoDeWorkspace !== 'container' && (
            <div className={styles.field} style={{ marginTop: 16 }}>
              <label className={styles.fieldLabel} htmlFor="workspace-path">
                {t('workspace.pathLabel')}
              </label>
              <div className={styles.toggleRow}>
                <Input
                  id="workspace-path"
                  value={caminhoLocal}
                  onChange={(e) => setCaminhoLocal(e.target.value)}
                  placeholder={t('workspace.pathPlaceholder')}
                  autoFocus
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleProcurarPasta()}
                  disabled={criandoParaNavegar}
                >
                  <FolderIcon size={14} />
                  {criandoParaNavegar ? t('workspace.preparing') : t('workspace.browseButton')}
                </Button>
              </div>
              <div className={styles.slugPreview}>
                {modoDeWorkspace === 'mounted'
                  ? t('workspace.hintMounted')
                  : t('workspace.hintRunner')}
              </div>
              {modoDeWorkspace === 'mounted' ? (
                // DOIS estados, e são os dois que o backend realmente tem
                // (RN-500/RN-501): dentro da base consentida a criação passa,
                // e a pasta nem precisa existir — `materializarWorkspaceMontado`
                // a cria quando a Infra sobe o container (ADR 0142); fora
                // dela a api RECUSA com 400, em `resolverWorkspacePath`.
                // O aviso anterior era anterior ao ADR 0141 e dizia que o
                // caminho era livre e que o usuário precisava montá-lo — as
                // duas coisas deixaram de ser verdade quando a base virou
                // uma só, montada por identidade.
                caminhoForaDaBase ? (
                  <Alert tone="warning">
                    <Trans
                      i18nKey="workspace.mountedOutsideBase"
                      ns="newProject"
                      values={{ base: baseDeProjetos ?? '' }}
                      components={{ strong: <strong />, code: <code /> }}
                    />
                  </Alert>
                ) : (
                  <div className={styles.baseNote}>
                    <Trans
                      i18nKey="workspace.mountedUnderBase"
                      ns="newProject"
                      values={{ base: baseDeProjetos ?? '' }}
                      components={{ strong: <strong />, code: <code /> }}
                    />
                  </div>
                )
              ) : (
                // `runner`: nada aqui trava a criação (RN-423) — o caminho só é
                // confirmado quando o runner conectar, nunca "recusado na hora"
                // como o aviso de `mounted` acima. Converge para o MESMO
                // `RunnerOnboardingPanel` de `TerminalPanel`/`FolderBrowserModal`
                // (a divergência de antes: esta tela tinha o próprio alerta,
                // com um comando sem `--token` e sem a opção de configuração
                // automática). Sem `projetoParaNavegar` (usuário ainda não
                // clicou "Procurar pasta..." — RN-437), o painel mostra só o
                // comando manual com o placeholder do id.
                <RunnerOnboardingPanel
                  projectId={projetoParaNavegar?.id ?? null}
                  caminhoSugerido={caminhoLocal}
                />
              )}
            </div>
          )}
        </div>
          {adotando ? (
          <div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="repo-external-id">
                {t('details.adopt.repoLabel')}
              </label>
              <Input
                id="repo-external-id"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder={
                  provider === 'local'
                    ? t('details.adopt.placeholderLocal')
                    : t('details.adopt.placeholderRemote')
                }
                autoFocus
              />
              <div className={styles.slugPreview}>
                {provider === 'local'
                  ? t('details.adopt.hintLocal')
                  : t('details.adopt.hintRemote')}
              </div>
            </div>
            <p className={styles.notaDaAdocao}>
              <Trans i18nKey="details.adopt.note" ns="newProject" components={{ strong: <strong /> }} />
            </p>
          </div>
          ) : (
          <div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="project-name">
                {t('details.create.nameLabel')}
              </label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('details.create.namePlaceholder')}
                autoFocus
              />
              {/* Sem dono no rótulo: quem provisiona é o backend, com o dono da
                  CREDENCIAL (`createForAuthenticatedUser`). Dizia `brabo/<slug>`,
                  fixo no código — e o nome errado ia até a tela de confirmação,
                  onde o usuário aprova. Melhor mostrar só o que se sabe. */}
              {slug && (
                <div className={styles.slugPreview}>
                  {t('details.create.repoPreview', { slug })}
                </div>
              )}
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t('details.create.visibilityLabel')}</span>
              <div className={styles.toggleRow}>
                {(['private', 'public'] as Visibility[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={[styles.toggleOption, visibility === v && styles.selected].filter(Boolean).join(' ')}
                    onClick={() => setVisibility(v)}
                  >
                    {v === 'private'
                      ? t('details.create.visibilityPrivate')
                      : t('details.create.visibilityPublic')}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {currentStep === 'confirm' && (
        <div className={styles.summary}>
          <SummaryRow
            label={t('confirm.modeLabel')}
            value={adotando ? t('mode.adopt.label') : t('mode.create.label')}
          />
          <SummaryRow
            label={t('confirm.providerLabel')}
            value={
              PROVIDERS.find((p) => p.id === provider)
                ? t(PROVIDERS.find((p) => p.id === provider)!.labelKey)
                : t('confirm.unknownProvider')
            }
          />
          <SummaryRow
            label={t('confirm.codeAtLabel')}
            value={
              modoDeWorkspace !== 'container'
                ? caminhoLocal.trim()
                : t('confirm.managedFolder')
            }
            mono={modoDeWorkspace !== 'container'}
          />
          {adotando ? (
            <>
              <SummaryRow label={t('confirm.repoLabel')} value={externalId.trim()} mono />
              <SummaryRow
                label={t('confirm.bootstrapLabel')}
                value={t('confirm.bootstrapAdoptValue')}
              />
            </>
          ) : (
            <>
              <SummaryRow label={t('confirm.repoLabel')} value={slug} mono />
              <SummaryRow
                label={t('confirm.visibilityLabel')}
                value={
                  visibility === 'private'
                    ? t('details.create.visibilityPrivate')
                    : t('details.create.visibilityPublic')
                }
              />
              <SummaryRow
                label={t('confirm.bootstrapLabel')}
                value={t('confirm.bootstrapStepsValue', { count: BOOTSTRAP_STEPS.length })}
              />
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
            {t('footer.back')}
          </Button>
        ) : (
          <span />
        )}
        <span className={styles.stepLabel}>
          {t('footer.stepLabel', { atual: stepIndex + 1, total: stepKeys.length })}
        </span>
        <div className={styles.footerActions}>
          {currentStep !== 'confirm' ? (
            <Button onClick={() => setStepIndex((s) => s + 1)} disabled={!canAdvance()}>
              {t('footer.continue')}
            </Button>
          ) : (
            <Button variant="success" onClick={handleConfirm} disabled={submitting}>
              {submitting
                ? t('footer.submitting')
                : adotando
                  ? t('footer.viewPlan')
                  : t('footer.provision')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
    {navegadorDePastaAberto && origemDoNavegador && (
      // O transporte é escolhido pelo MODO, e são duas perguntas diferentes
      // (RN-533, ADR 0151 ponto 7).
      //
      // `mounted` pergunta à API, escopado à base de projetos montados
      // (RN-504): a pasta dele mora dentro de `BRABO_PROJECTS_BASE`, no
      // SERVIDOR, e é o servidor quem a enxerga. Este caminho fica intacto.
      //
      // `runner` volta a perguntar ao AGENTE LOCAL, pelo canal Phoenix
      // (`fs_list_dir`) que sempre existiu dos dois lados. A RN-504 o tinha
      // apontado para a api junto com o `mounted`, e declarou o preço:
      // "para `runner` a lista deixa de ser o disco da máquina do usuário e
      // passa a ser a base". Aquilo foi aceito porque o modo `runner` sairia
      // da criação de projeto — o que não aconteceu, e a direção de produto
      // do ADR 0151 é a oposta. Enquanto isso durou, escolher `runner` e
      // clicar "Procurar pasta..." navegava um disco que não é o daquele
      // projeto, e nada na tela dizia isso.
      //
      // A âncora do modo `runner` é o projeto criado ANTECIPADAMENTE
      // (RN-437, ADR 0108) — o ticket do canal é escopado a um `projectId`
      // real —, e é por isso que `origemDoNavegador` pode ser `undefined`:
      // sem projeto criado não há transporte a montar, e abrir o modal caindo
      // na api mostraria a base do servidor sob o rótulo de "sua máquina",
      // que é exatamente o que esta entrega existe para acabar.
      <FolderBrowserModal
        origem={origemDoNavegador}
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
