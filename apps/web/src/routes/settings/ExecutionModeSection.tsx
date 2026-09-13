import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  convertProjectExecutionMode,
  getProject,
  getProjectsBase,
  mensagemDaApi,
} from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { roleAtLeast } from '../../lib/roles';
import type { ExecutionMode } from '../../lib/api-types';
import { Alert } from '../../components/ui/Alert';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { FolderIcon } from '../../components/ui/icons';
import { FolderBrowserModal } from '../../components/FolderBrowserModal';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

/**
 * Onde o código do projeto mora — `container` (padrão), `mounted` (pasta do
 * usuário montada por bind-mount) ou `runner` (pasta do usuário confirmada
 * pelo CLI `brabo-runner`, sem bind-mount). Rótulo/descrição REUSADOS do
 * wizard de criação (`newProject:workspaceMode.*`, `NewProjectWizard.tsx`)
 * — a pergunta é a mesma, só o MOMENTO muda (criação vs. projeto já
 * existente).
 */
const MODOS_DE_EXECUCAO: {
  id: ExecutionMode;
  labelKey: string;
  descKey: string;
}[] = [
  {
    id: 'container',
    labelKey: 'newProject:workspaceMode.container.label',
    descKey: 'newProject:workspaceMode.container.desc',
  },
  {
    id: 'mounted',
    labelKey: 'newProject:workspaceMode.mounted.label',
    descKey: 'newProject:workspaceMode.mounted.desc',
  },
  {
    id: 'runner',
    labelKey: 'newProject:workspaceMode.runner.label',
    descKey: 'newProject:workspaceMode.runner.desc',
  },
];

/**
 * O que se sabe sobre a base de projetos montados desta instalação
 * (`BRABO_PROJECTS_BASE`, ADR 0141/RN-500), do ponto de vista desta seção.
 *
 * QUATRO estados e não dois, pela régua da RN-088/RN-468: "ainda não
 * perguntei", "perguntei e não consegui saber" e "perguntei e não existe"
 * são coisas diferentes, e colapsá-las faria a tela afirmar ausência sobre
 * o que ela só não conseguiu ler. É a mesma distinção que `NewProjectWizard`
 * já faz para decidir se OFERECE o modo `mounted` (RN-513) — aqui ela decide
 * outra coisa (se o navegador de pastas é oferecido), porque um projeto que
 * JÁ é `mounted` não pode sumir do seletor por causa de uma consulta em voo.
 */
type EstadoDaBase =
  | { tipo: 'carregando' }
  | { tipo: 'falhou' }
  | { tipo: 'ausente' }
  | { tipo: 'presente'; base: string };

/**
 * Converte o `execution_mode` de um projeto EXISTENTE (RN-447..450, ADR
 * 0111) — via `PUT .../execution-mode`, rota DEDICADA e separada do PATCH
 * genérico de `ExecutionSection`/`ParallelismSection` acima: a api move o
 * `permissions.json` para o novo escopo, encerra o ciclo de vida do
 * container ao SAIR de `container`, e recusa com 409 se algum dev agent do
 * projeto estiver trabalhando ou travado agora — o aviso fixo abaixo é
 * sobre essa mesma condição, e o toast de erro mostra a explicação exata
 * que a api devolve quando ela dispara (`mensagemDaApi`).
 *
 * ## O aviso não promete migração (RN-560)
 *
 * Ele dizia *"isto migra a pasta de trabalho do agente"*, e o caso de uso
 * não tem uma linha que copie ou mova conteúdo: ele move o
 * `permissions.json` (a POLÍTICA), zera `workspaceVerifiedAt`/`mirrorPath`
 * e desprovisiona o container. O que estiver na pasta ANTIGA — trabalho não
 * commitado incluído — fica lá, órfão, e essa é uma lacuna declarada no
 * `CLAUDE.md` desde a RN-447..450. O aviso agora diz as três coisas
 * separadamente (o que recusa, o que leva, o que NÃO leva) e NOMEIA o
 * caminho antigo, que some da tela no instante em que a conversão salva.
 *
 * Ele não promete detecção: perguntar ao disco "há trabalho não commitado?"
 * é I/O por modo e impossível de responder para `runner` do lado da api.
 * Não se mede, não se afirma.
 *
 * ## O navegador de pastas, só no ramo `mounted` (RN-559)
 *
 * Esta era a única das cinco telas de escolha de pasta em que se digitava o
 * caminho no escuro. O ramo `mounted` passa a abrir o MESMO
 * `FolderBrowserModal` da criação de projeto, com `origem: { tipo: 'api',
 * workspaceId }` — mesmo componente, mesmo endpoint, nenhuma régua nova: a
 * api continua sendo quem valida o caminho (`validarExecutionModeEWorkspacePath`
 * e o CHECK do banco), e o navegador não "garante" nada.
 *
 * O ramo `runner` continua DIGITADO, de propósito, e a seção passa a DIZER
 * isso em texto em vez de só não oferecer botão nenhum (ADR 0064: tira-se o
 * controle, nunca a informação). Abrir o navegador de runner aqui exigiria
 * `origem: { tipo: 'runner', projectId }`, e um projeto que ainda NÃO é
 * `runner` não tem runner conectado — a espera terminaria num erro com cara
 * de bug. Onboardar antes de a conversão salvar registra chave num projeto
 * que ainda não é `runner`, e `ConfirmProjectWorkspaceUseCase` recusa com
 * 400; a ordem "converte, depois onboarda" é decisão de produto à parte,
 * declarada no `CLAUDE.md` e NÃO reaberta aqui.
 *
 * Salvar só habilita quando algo de fato MUDOU em relação ao par (modo,
 * caminho) atual do projeto — reenviar o mesmo par seria uma chamada que a
 * api já trata como no-op, mas o botão desabilitado evita a viagem de rede
 * e deixa claro que nada foi digitado. O controle é campo DIGITADO (ou
 * escolhido no navegador, que é a mesma coisa: um valor que a pessoa
 * compõe), então ele confirma por BOTÃO e nunca por `onChange` — a régua da
 * RN-469, que esta seção não converte para autosave.
 */
export function ExecutionModeSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  // O mínimo é o do ENDPOINT (`@RequireRole('maintainer')` em
  // `PUT projects/:projectId/execution-mode`), lido por `roleAtLeast` sobre a
  // `ROLE_ORDER` e nunca por uma lista de papéis à mão — que acerta por
  // acidente enquanto o mínimo é alto e erra calada quando ele baixa (RN-102).
  const papel = comPapel?.role;
  const workspaceId = comPapel?.workspace?.id;
  const podeEditar = roleAtLeast(papel, 'maintainer');
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  // A base é da INSTALAÇÃO e a rota pede `maintainer` — o mesmo mínimo da
  // conversão. Para quem não alcança esse mínimo a consulta nem sai: ela
  // terminaria em 403 garantido, e o estado "não sei" que ela produziria
  // seria sobre a autorização, não sobre a base.
  const baseQuery = useQuery({
    queryKey: ['projects-base', workspaceId],
    queryFn: () => getProjectsBase(workspaceId!),
    enabled: !!workspaceId && podeEditar,
    staleTime: 10 * 60 * 1000,
  });
  const [modoDraft, setModoDraft] = useState<ExecutionMode | null>(null);
  const [caminhoDraft, setCaminhoDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [navegadorAberto, setNavegadorAberto] = useState(false);

  if (!project) return null;

  const modo = modoDraft ?? project.executionMode;
  const caminhoAtual = project.workspacePath ?? '';
  // Trocar de modo começa o caminho em branco — copiar o caminho ANTIGO
  // (de um modo diferente) seria oferecer um valor que quase certamente
  // não serve para o modo novo.
  const caminho =
    caminhoDraft ?? (modoDraft && modoDraft !== project.executionMode ? '' : caminhoAtual);
  const precisaCaminho = modo !== 'container';
  const mudouAlgo =
    modo !== project.executionMode || (precisaCaminho && caminho !== caminhoAtual);
  const valido = !precisaCaminho || caminho.trim().length > 0;
  const descricaoDoModo = MODOS_DE_EXECUCAO.find((m) => m.id === modo)?.descKey;

  const estadoDaBase: EstadoDaBase = baseQuery.isSuccess
    ? baseQuery.data.projectsBase !== null
      ? { tipo: 'presente', base: baseQuery.data.projectsBase }
      : { tipo: 'ausente' }
    : baseQuery.isError
      ? { tipo: 'falhou' }
      : { tipo: 'carregando' };

  // O navegador só monta com o que ele exige para existir: o ramo `mounted`,
  // um `workspaceId` e uma base CONFIRMADA. "Não sei" nunca vira "tem"
  // (RN-513), e o botão sem base abriria um modal que listaria o nada.
  const podeNavegar =
    modo === 'mounted' && !!workspaceId && estadoDaBase.tipo === 'presente';

  async function handleSave() {
    setSaving(true);
    try {
      await convertProjectExecutionMode(projectId, {
        executionMode: modo,
        ...(precisaCaminho ? { workspacePath: caminho.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      setModoDraft(null);
      setCaminhoDraft(null);
      showToast({ title: t('executionMode.toast.success'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: mensagemDaApi(erro, t('executionMode.toast.error')),
        tone: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SecaoDeConfiguracoes chave="execution-mode">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('executionMode.title')}</h2>
        <span className={styles.eyebrow}>{t('executionMode.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {t('executionMode.subtitle')}
        {!podeEditar && ` ${t('executionMode.needsMaintainer')}`}
      </div>

      {/*
        TRÊS fatos, e não um parágrafo (RN-560). O tom passou de `accent` para
        `warning` porque o terceiro deles é uma PERDA de alcance: o que ficou
        na pasta antiga ninguém vai buscar depois.

        Sem `role="alert"`: é texto que já estava na tela quando ela abriu, e
        uma live region assertiva aqui viraria interrupção sem causa (o mesmo
        motivo documentado em `Alert`).
      */}
      <Alert tone="warning">
        <div>{t('executionMode.warning.refuses')}</div>
        <div style={{ marginTop: 6 }}>{t('executionMode.warning.carries')}</div>
        <div style={{ marginTop: 6 }}>
          {caminhoAtual
            ? t('executionMode.warning.leavesPath', { caminho: caminhoAtual })
            : t('executionMode.warning.leavesManaged')}
        </div>
      </Alert>

      <div className={styles.ajusteCard} style={{ marginTop: 12 }}>
        <div className={styles.ajusteInfo}>
          <div className={styles.ajusteTitulo}>{t('executionMode.card.title')}</div>
          <div className={styles.ajusteHint}>
            {descricaoDoModo ? t(descricaoDoModo) : null}
          </div>
        </div>
        <div className={styles.ajusteControle}>
          <Select
            value={modo}
            disabled={!podeEditar || saving}
            aria-label={t('executionMode.selectAria')}
            onChange={(e) => {
              setModoDraft(e.target.value as ExecutionMode);
              setCaminhoDraft(null);
            }}
          >
            {MODOS_DE_EXECUCAO.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.labelKey)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {precisaCaminho && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Input
              mono
              value={caminho}
              disabled={!podeEditar || saving}
              onChange={(e) => setCaminhoDraft(e.target.value)}
              placeholder={t('newProject:workspace.pathPlaceholder')}
              aria-label={t('executionMode.pathAria')}
              style={{ flex: 1, minWidth: 0 }}
            />
            {modo === 'mounted' && (
              // O botão FICA na tela sem base, apagado, com o motivo dito em
              // TEXTO logo abaixo (ADR 0064). Escondê-lo deixaria a pessoa
              // sem saber que existe um navegador, e `title` em elemento
              // `disabled` não abre no Chromium.
              <Button
                type="button"
                variant="secondary"
                onClick={() => setNavegadorAberto(true)}
                disabled={!podeEditar || saving || !podeNavegar}
              >
                <FolderIcon size={14} />
                {t('newProject:workspace.browseButton')}
              </Button>
            )}
          </div>
          <div className={styles.ajusteHint} style={{ marginTop: 6 }}>
            {modo === 'runner'
              ? t('executionMode.path.runnerTyped')
              : estadoDaBase.tipo === 'presente'
                ? t('executionMode.path.underBase', { base: estadoDaBase.base })
                : estadoDaBase.tipo === 'ausente'
                  ? t('executionMode.path.noBase')
                  : estadoDaBase.tipo === 'falhou'
                    ? t('executionMode.path.baseUnknown')
                    : t('executionMode.path.baseLoading')}
          </div>
        </div>
      )}

      <Button
        style={{ marginTop: 12 }}
        onClick={() => void handleSave()}
        disabled={!podeEditar || !mudouAlgo || !valido || saving}
      >
        {saving ? t('executionMode.saving') : t('executionMode.save')}
      </Button>

      {navegadorAberto && podeNavegar && workspaceId && (
        // `origem: { tipo: 'api', workspaceId }` — o MESMO transporte do
        // wizard para o modo `mounted` (RN-504/RN-533): a pasta mora dentro
        // da base, no SERVIDOR, e é o servidor quem a enxerga. Nunca
        // `{ tipo: 'runner', projectId }` aqui: ver o docblock acima.
        <FolderBrowserModal
          origem={{ tipo: 'api', workspaceId }}
          caminhoInicial={caminho.trim() || undefined}
          onSelecionar={(escolhido) => setCaminhoDraft(escolhido)}
          onClose={() => setNavegadorAberto(false)}
        />
      )}
    </SecaoDeConfiguracoes>
  );
}
