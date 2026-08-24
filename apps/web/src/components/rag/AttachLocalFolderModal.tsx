import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { attachLocalFolder, mensagemDaApi } from '../../lib/api-client';
import {
  RAG_LOCAL_FILE_BYTES_LIMIT,
  RAG_LOCAL_FILE_COUNT_LIMIT,
  RAG_LOCAL_TOTAL_BYTES_LIMIT,
  extensaoAceita,
} from '../../lib/rag-local-limits';
import type { AttachLocalFolderReport, LocalFolderFile } from '../../lib/api-types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useToast } from '../ui/ToastProvider';
import { AlertIcon, FolderIcon } from '../ui/icons';
import styles from './AttachLocalFolderModal.module.css';

interface Preview {
  folderName: string;
  included: LocalFolderFile[];
  filesSkipped: number;
  totalBytes: number;
  /** `true` quando o teto agregado (quantidade OU bytes somados) estourou — o upload fica BLOQUEADO, nunca truncado em silêncio (mesma régua do backend). */
  overCap: boolean;
}

/**
 * "Anexar pasta local" (RN-454, ADR 0113) — o navegador lê o CONTEÚDO dos
 * arquivos escolhidos (`<input webkitdirectory>` + `File.text()`) e envia
 * como texto puro. Nenhum caminho de máquina do usuário atravessa a rede —
 * é a distinção completa com o runner (ADR 0103/0107) que este componente
 * existe para preservar; ver o ADR 0113 para o argumento inteiro.
 *
 * O pré-filtro AQUI (tamanho por arquivo, extensão) é só conveniência de UX
 * — mostra o resumo ANTES de enviar, para quem escolheu a pasta poder
 * decidir se quer prosseguir. Quem garante os tetos de verdade é
 * `IndexLocalFolderUseCase`, que rejeita (400) o upload inteiro se os tetos
 * agregados estourarem — nunca trunca em silêncio.
 */
export function AttachLocalFolderModal({
  projectId,
  onClose,
  onAttached,
}: {
  projectId: string;
  onClose: () => void;
  onAttached: (relatorio: AttachLocalFolderReport) => void;
}) {
  const { t } = useTranslation('sessions');
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lendo, setLendo] = useState(false);

  useEffect(() => {
    // `webkitdirectory` não é padrão — o tipo de `HTMLInputElement` do React
    // não o declara, então é setado imperativamente em vez de via JSX.
    inputRef.current?.setAttribute('webkitdirectory', '');
    inputRef.current?.setAttribute('directory', '');
  }, []);

  const mutation = useMutation({
    mutationFn: (dados: { folderName: string; files: LocalFolderFile[] }) =>
      attachLocalFolder(projectId, dados),
    onSuccess: (relatorio) => {
      showToast({
        title: t('rag.attachLocalFolder.successTitle'),
        message: t('rag.attachLocalFolder.successMessage', {
          filesIndexed: relatorio.filesIndexed,
          folderName: relatorio.folderName,
          embeddingSuffix: relatorio.embedding.available
            ? ''
            : t('rag.embeddingUnavailableSuffix'),
        }),
        tone: relatorio.embedding.available ? 'success' : 'warning',
      });
      onAttached(relatorio);
    },
    onError: (erro) =>
      showToast({
        title: t('rag.attachLocalFolder.errorTitle'),
        message: mensagemDaApi(erro, t('rag.attachLocalFolder.errorDefaultMessage')),
        tone: 'danger',
      }),
  });

  async function selecionarPasta(event: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (arquivos.length === 0) return;

    setLendo(true);
    setPreview(null);

    const primeiroCaminho = arquivos[0].webkitRelativePath || arquivos[0].name;
    const folderName = primeiroCaminho.split('/')[0] || 'pasta';

    if (arquivos.length > RAG_LOCAL_FILE_COUNT_LIMIT) {
      setPreview({
        folderName,
        included: [],
        filesSkipped: arquivos.length,
        totalBytes: 0,
        overCap: true,
      });
      setLendo(false);
      return;
    }

    const included: LocalFolderFile[] = [];
    let filesSkipped = 0;
    let totalBytes = 0;

    for (const arquivo of arquivos) {
      const relativo = caminhoRelativo(arquivo.webkitRelativePath || arquivo.name, folderName);
      if (arquivo.size > RAG_LOCAL_FILE_BYTES_LIMIT || !extensaoAceita(relativo)) {
        filesSkipped++;
        continue;
      }
      totalBytes += arquivo.size;
      try {
        const conteudo = await arquivo.text();
        included.push({ path: relativo, content: conteudo });
      } catch {
        filesSkipped++;
      }
    }

    setPreview({
      folderName,
      included,
      filesSkipped,
      totalBytes,
      overCap: totalBytes > RAG_LOCAL_TOTAL_BYTES_LIMIT,
    });
    setLendo(false);
  }

  function confirmar() {
    if (!preview || preview.overCap || preview.included.length === 0) return;
    mutation.mutate({ folderName: preview.folderName, files: preview.included });
  }

  return (
    <Modal title={t('rag.attachLocalFolder.modalTitle')} icon={<FolderIcon size={16} />} onClose={onClose}>
      <div className={styles.corpo}>
        <p className={styles.explicacao}>{t('rag.attachLocalFolder.explanation')}</p>

        <input
          ref={inputRef}
          type="file"
          multiple
          className={styles.inputOculto}
          onChange={(e) => void selecionarPasta(e)}
          aria-label={t('rag.attachLocalFolder.chooseFolder')}
        />

        {!preview && !lendo && (
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            <FolderIcon size={14} /> {t('rag.attachLocalFolder.chooseFolder')}
          </Button>
        )}

        {lendo && <div className={styles.estado}>{t('rag.attachLocalFolder.reading')}</div>}

        {preview && preview.overCap && (
          <div className={styles.aviso} role="alert">
            <AlertIcon size={14} />
            {preview.included.length === 0 && preview.filesSkipped > RAG_LOCAL_FILE_COUNT_LIMIT
              ? t('rag.attachLocalFolder.tooManyFiles', {
                  count: preview.filesSkipped,
                  limit: RAG_LOCAL_FILE_COUNT_LIMIT,
                })
              : t('rag.attachLocalFolder.tooManyBytes')}
          </div>
        )}

        {preview && !preview.overCap && (
          <div className={styles.resumo}>
            {preview.included.length === 0 ? (
              <div className={styles.estado}>{t('rag.attachLocalFolder.emptyFolder')}</div>
            ) : preview.filesSkipped > 0 ? (
              t('rag.attachLocalFolder.summary', {
                included: preview.included.length,
                folderName: preview.folderName,
                skipped: preview.filesSkipped,
              })
            ) : (
              t('rag.attachLocalFolder.summaryNoSkipped', {
                included: preview.included.length,
                folderName: preview.folderName,
              })
            )}
          </div>
        )}

        <div className={styles.acoes}>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            {t('rag.attachLocalFolder.cancelButton')}
          </Button>
          {preview && !preview.overCap && preview.included.length > 0 && (
            <Button onClick={confirmar} loading={mutation.isPending}>
              {mutation.isPending
                ? t('rag.attachLocalFolder.confirmButtonLoading')
                : t('rag.attachLocalFolder.confirmButton', { count: preview.included.length })}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Retira o primeiro segmento (o nome da própria pasta) do `webkitRelativePath`. */
function caminhoRelativo(webkitRelativePath: string, folderName: string): string {
  const prefixo = `${folderName}/`;
  return webkitRelativePath.startsWith(prefixo)
    ? webkitRelativePath.slice(prefixo.length)
    : webkitRelativePath;
}
