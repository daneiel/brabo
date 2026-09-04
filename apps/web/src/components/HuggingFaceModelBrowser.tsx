import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  confirmModelPull,
  getModelPullRequest,
  mensagemDaApi,
  requestModelPull,
  searchHuggingFaceModels,
} from '../lib/api-client';
import type { HuggingFaceModel, ModelPullRequest } from '../lib/api-types';
import { Alert } from './ui/Alert';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import { AlertIcon, ModelIcon, SearchIcon } from './ui/icons';
import styles from './HuggingFaceModelBrowser.module.css';

const STATUS_TERMINAL = new Set<ModelPullRequest['status']>(['active', 'failed']);

/** `1_500_000_000` → `1.5 GB`. Sem casa decimal abaixo de 10 do valor exibido. */
function formatarBytes(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024;
    i++;
  }
  const casas = i === 0 || valor >= 10 ? 0 : 1;
  return `${valor.toFixed(casas)} ${unidades[i]}`;
}

/**
 * Navegar o Hugging Face Hub e pedir o pull de um modelo GGUF para dentro do
 * Ollama, com a segunda confirmação explícita que o backend exige
 * (`huggingface-models.controller.ts`).
 *
 * ## Por que a busca nasce fechada (`enabled` só depois de um submit)
 *
 * Sem isto, cada tecla digitada dispararia uma chamada ao Hub — o mesmo
 * defeito de amplificação de tráfego que a leitura composta de agente evita
 * (ADR 0060), só que aqui o gatilho é o teclado do usuário em vez de um
 * laço de ferramenta.
 *
 * ## Por que o "Confirmar" fecha o modal e some do fluxo síncrono
 *
 * `ConfirmModelPullUseCase` roda o pull inteiro dentro da requisição HTTP —
 * pode levar minutos, e um proxy no meio pode fechar a conexão antes do
 * fim. O clique dispara a chamada e IMEDIATAMENTE começa a pollar
 * `GET .../pull-requests/:id`: a leitura de status nunca depende de a
 * promise do POST resolver ou rejeitar, só do estado gravado no servidor.
 */
export function HuggingFaceModelBrowser({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation('models');
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [termo, setTermo] = useState('');
  const [buscado, setBuscado] = useState('');
  const [incluirComunidade, setIncluirComunidade] = useState(false);

  const [modeloParaConfirmar, setModeloParaConfirmar] = useState<HuggingFaceModel | null>(null);
  const [pullEmAndamentoId, setPullEmAndamentoId] = useState<string | null>(null);
  const statusJaTratado = useRef<string | null>(null);

  const busca = useQuery({
    queryKey: ['huggingface-models', workspaceId, buscado, incluirComunidade],
    queryFn: () => searchHuggingFaceModels(workspaceId, { q: buscado, includeCommunity: incluirComunidade }),
    enabled: buscado.length > 0,
  });

  const criarPedido = useMutation({
    mutationFn: (repoId: string) => requestModelPull(workspaceId, { repoId }),
    onError: (erro) => {
      showToast({
        title: t('huggingface.toasts.requestErrorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
      setModeloParaConfirmar(null);
    },
  });

  const confirmarPedido = useMutation({
    mutationFn: (id: string) => confirmModelPull(workspaceId, id),
    // Erro AQUI é quase sempre a conexão caindo antes do pull terminar no
    // servidor (ver a nota da classe acima) — não necessariamente falha do
    // pull. O polling abaixo continua sendo quem decide o desfecho real.
    onError: (erro) => {
      showToast({
        title: t('huggingface.toasts.confirmConnectionLostTitle'),
        message: mensagemDaApi(erro),
        tone: 'warning',
      });
    },
  });

  const statusQuery = useQuery({
    queryKey: ['huggingface-pull-request', workspaceId, pullEmAndamentoId],
    queryFn: () => getModelPullRequest(workspaceId, pullEmAndamentoId!),
    enabled: !!pullEmAndamentoId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && STATUS_TERMINAL.has(status)) return false;
      return query.state.status === 'error' ? false : 3000;
    },
  });

  // Desfecho terminal: um toast e, em sucesso, invalidar o catálogo — o
  // modelo puxado entra ativo NESTE workspace, e sem isto a seção de
  // curadoria (e o seletor, que lê `models`) só mostrariam isso no próximo
  // refetch espontâneo.
  useEffect(() => {
    const pedido = statusQuery.data;
    if (!pedido || !STATUS_TERMINAL.has(pedido.status)) return;
    if (statusJaTratado.current === pedido.id) return;
    statusJaTratado.current = pedido.id;

    if (pedido.status === 'active') {
      showToast({
        title: t('huggingface.toasts.pullSuccess', { repoId: pedido.repoId }),
        tone: 'success',
      });
      void queryClient.invalidateQueries({ queryKey: ['model-catalog', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['models'] });
    } else {
      showToast({
        title: t('huggingface.toasts.pullFailedTitle', { repoId: pedido.repoId }),
        message: pedido.failedReason ?? undefined,
        tone: 'danger',
      });
    }
    setPullEmAndamentoId(null);
  }, [statusQuery.data, showToast, t, queryClient, workspaceId]);

  function submeterBusca(event: FormEvent) {
    event.preventDefault();
    setBuscado(termo.trim());
  }

  function abrirConfirmacao(model: HuggingFaceModel) {
    setModeloParaConfirmar(model);
    criarPedido.mutate(model.repoId);
  }

  function fecharModal() {
    setModeloParaConfirmar(null);
    criarPedido.reset();
  }

  function confirmar() {
    const pedido = criarPedido.data;
    if (!pedido) return;
    setPullEmAndamentoId(pedido.id);
    confirmarPedido.mutate(pedido.id);
    fecharModal();
  }

  const resultados = busca.data ?? [];
  const statusAtual = pullEmAndamentoId ? statusQuery.data : undefined;

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <div className={styles.tituloLinha}>
          <h3 className={styles.title}>{t('huggingface.title')}</h3>
          <span className={styles.eyebrow}>{t('huggingface.eyebrow')}</span>
        </div>
        <div className={styles.subtitle}>{t('huggingface.subtitle')}</div>
      </div>

      <form className={styles.buscaLinha} onSubmit={submeterBusca}>
        <div className={styles.campoBusca}>
          <Input
            icon={<SearchIcon size={14} />}
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={t('huggingface.searchPlaceholder')}
            aria-label={t('huggingface.searchLabel')}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={termo.trim().length === 0}>
          {t('huggingface.searchButton')}
        </Button>
      </form>

      <label className={styles.comunidade}>
        <input
          type="checkbox"
          checked={incluirComunidade}
          onChange={(e) => setIncluirComunidade(e.target.checked)}
        />
        {t('huggingface.communityToggle')}
      </label>

      {incluirComunidade && (
        <Alert tone="danger" role="status" className={styles.avisoComunidade}>
          {t('huggingface.communityWarning')}
        </Alert>
      )}

      {statusAtual && (
        <div className={styles.statusAtual}>
          <span className={styles.statusRepo}>{statusAtual.repoId}</span>
          <span className={styles.statusRotulo}>
            {t(`huggingface.pullStatus.${statusAtual.status}`)}
          </span>
        </div>
      )}

      {busca.isFetching && <div className={styles.estado}>{t('huggingface.searching')}</div>}

      {busca.isError && (
        <Alert tone="danger">{mensagemDaApi(busca.error, t('huggingface.searchError'))}</Alert>
      )}

      {!busca.isFetching && buscado.length > 0 && resultados.length === 0 && !busca.isError && (
        <div className={styles.estado}>{t('huggingface.noResults', { query: buscado })}</div>
      )}

      {resultados.length > 0 && (
        <div className={styles.lista}>
          {resultados.map((model) => (
            <div key={model.repoId} className={styles.linha}>
              <div className={styles.nome}>
                <span className={styles.repoId}>{model.repoId}</span>
                <span className={styles.publisher}>{model.publisher}</span>
              </div>
              <div className={styles.selos}>
                <span className={styles.downloads}>
                  {t('huggingface.downloads', { value: model.downloads.toLocaleString() })}
                </span>
                <Badge tone={model.official ? 'muted' : 'warning'}>
                  {model.official ? t('huggingface.badgeOfficial') : t('huggingface.badgeCommunity')}
                </Badge>
              </div>
              <Button
                variant="secondary"
                onClick={() => abrirConfirmacao(model)}
                disabled={!!pullEmAndamentoId}
              >
                {t('huggingface.pullButton')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {modeloParaConfirmar && (
        <Modal
          title={t('huggingface.confirmModal.title')}
          icon={<ModelIcon size={16} />}
          onClose={fecharModal}
        >
          <div className={styles.corpoModal}>
            <p className={styles.explicacaoModal}>{t('huggingface.confirmModal.explanation')}</p>

            {criarPedido.isPending && (
              <div className={styles.estado}>{t('huggingface.confirmModal.preparing')}</div>
            )}

            {criarPedido.data && (
              <div className={styles.resumoModal}>
                <div className={styles.resumoModalLinha}>
                  <span>{t('huggingface.confirmModal.repoIdLabel')}</span>
                  <strong>{criarPedido.data.repoId}</strong>
                </div>
                <div className={styles.resumoModalLinha}>
                  <span>{t('huggingface.confirmModal.sizeLabel')}</span>
                  <strong>
                    {criarPedido.data.estimatedSizeBytes
                      ? formatarBytes(criarPedido.data.estimatedSizeBytes)
                      : t('huggingface.confirmModal.sizeUnknown')}
                  </strong>
                </div>
              </div>
            )}

            {!modeloParaConfirmar.official && (
              <Alert tone="danger" icon={<AlertIcon size={14} />}>
                {t('huggingface.communityWarning')}
              </Alert>
            )}

            <div className={styles.acoesModal}>
              <Button variant="ghost" onClick={fecharModal}>
                {t('huggingface.confirmModal.cancel')}
              </Button>
              <Button onClick={confirmar} disabled={!criarPedido.data}>
                {t('huggingface.confirmModal.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
