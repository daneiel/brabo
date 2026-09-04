import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  convertProjectExecutionMode,
  getProject,
  mensagemDaApi,
} from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import type { ExecutionMode } from '../../lib/api-types';
import { Alert } from '../../components/ui/Alert';
import { Select } from '../../components/ui/Select';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
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
 * Converte o `execution_mode` de um projeto EXISTENTE (RN-447..450, ADR
 * 0111) — via `PUT .../execution-mode`, rota DEDICADA e separada do PATCH
 * genérico de `ExecutionSection`/`ParallelismSection` acima: a api migra o
 * `permissions.json` para o novo escopo, encerra o ciclo de vida do
 * container ao SAIR de `container`, e recusa com 409 se algum dev agent do
 * projeto estiver trabalhando ou travado agora — o aviso fixo abaixo é
 * sobre essa mesma condição, e o toast de erro mostra a explicação exata
 * que a api devolve quando ela dispara (`mensagemDaApi`).
 *
 * Salvar só habilita quando algo de fato MUDOU em relação ao par (modo,
 * caminho) atual do projeto — reenviar o mesmo par seria uma chamada que a
 * api já trata como no-op, mas o botão desabilitado evita a viagem de rede
 * e deixa claro que nada foi digitado.
 */
export function ExecutionModeSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const podeEditar = comPapel?.role === 'owner' || comPapel?.role === 'maintainer';
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const [modoDraft, setModoDraft] = useState<ExecutionMode | null>(null);
  const [caminhoDraft, setCaminhoDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

      <Alert tone="accent">{t('executionMode.warning')}</Alert>

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
          <Input
            mono
            value={caminho}
            disabled={!podeEditar || saving}
            onChange={(e) => setCaminhoDraft(e.target.value)}
            placeholder={t('newProject:workspace.pathPlaceholder')}
            aria-label={t('executionMode.pathAria')}
          />
        </div>
      )}

      <Button
        style={{ marginTop: 12 }}
        onClick={() => void handleSave()}
        disabled={!podeEditar || !mudouAlgo || !valido || saving}
      >
        {saving ? t('executionMode.saving') : t('executionMode.save')}
      </Button>
    </SecaoDeConfiguracoes>
  );
}
