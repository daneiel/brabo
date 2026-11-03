import { useRef, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, Paperclip, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { lerAnexoComoDataUrl, type AnexoDaMensagem } from '../../lib/api-client';
import {
  adicionarAnexos,
  formatarTamanho,
  removerAnexo,
  useAnexosPendentes,
} from '../../lib/anexos';

const chip = 'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs';
const miniatura = 'h-8 w-8 rounded object-cover';

/** Botão de clipe + `<input type=file>` escondido (AT-715). */
export function BotaoDeAnexar({ sessionId, desabilitado }: { sessionId: string; desabilitado?: boolean }) {
  const { t } = useTranslation('sessionPage');
  const ref = useRef<HTMLInputElement>(null);
  const aoEscolher = (e: ChangeEvent<HTMLInputElement>) => {
    void adicionarAnexos(sessionId, Array.from(e.target.files ?? []));
    e.target.value = '';
  };
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        data-testid="anexo-input"
        accept="image/png,image/jpeg,image/webp,image/gif,text/*,.md,.json,.yml,.yaml,.ts,.tsx,.js,.py"
        onChange={aoEscolher}
      />
      <Button
        variant="secondary"
        legenda={t('anexos.anexar')}
        disabled={desabilitado}
        onClick={() => ref.current?.click()}
      >
        <Paperclip aria-hidden="true" />
      </Button>
    </>
  );
}

/** Chips dos anexos pendentes e o erro do cliente/upload, em texto. */
export function AnexosPendentes({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation('sessionPage');
  const { itens, erro } = useAnexosPendentes(sessionId);
  if (itens.length === 0 && !erro) return null;
  return (
    <div data-testid="anexos-pendentes" className="flex flex-wrap items-center gap-2 px-2 py-1">
      {itens.map((i) => (
        <span key={i.chave} className={chip} data-testid="anexo-chip">
          {i.imagem ? <img src={i.dataUrl} alt="" className={miniatura} /> : <FileText size={14} aria-hidden="true" />}
          <span>{i.nome}</span>
          <span>{formatarTamanho(i.tamanho)}</span>
          <button type="button" aria-label={t('anexos.remover', { nome: i.nome })} onClick={() => removerAnexo(sessionId, i.chave)}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      {erro && <span role="alert">{t(`anexos.erro.${erro}`)}</span>}
    </div>
  );
}

const chaveDoAnexo = (p: string, s: string, id: string) => ['anexo-bytes', p, s, id] as const;

/** Chips no fio. Leitura UMA vez por id (imutável, RN-579/632); texto só baixa no clique. */
export function AnexosDaMensagem({ projectId, sessionId, anexos }: { projectId: string; sessionId: string; anexos: AnexoDaMensagem[] }) {
  const { t } = useTranslation('sessionPage');
  const qc = useQueryClient();
  const baixar = async (a: AnexoDaMensagem) => {
    const url = await qc.fetchQuery({
      queryKey: chaveDoAnexo(projectId, sessionId, a.id),
      queryFn: () => lerAnexoComoDataUrl(projectId, sessionId, a.id),
      staleTime: Infinity,
    });
    const link = document.createElement('a');
    link.href = url;
    link.download = a.nome;
    link.click();
  };
  return (
    <div className="mt-1 flex flex-wrap gap-2" data-testid="anexos-da-mensagem">
      {anexos.map((a) =>
        a.mime.startsWith('image/') ? (
          <Miniatura key={a.id} projectId={projectId} sessionId={sessionId} anexo={a} />
        ) : (
          <button key={a.id} type="button" className={chip} data-testid="anexo-chip" title={t('anexos.baixar')} onClick={() => void baixar(a)}>
            <FileText size={14} aria-hidden="true" />
            <span>{a.nome}</span>
            <span>{formatarTamanho(a.tamanho)}</span>
          </button>
        ),
      )}
    </div>
  );
}

function Miniatura({ projectId, sessionId, anexo }: { projectId: string; sessionId: string; anexo: AnexoDaMensagem }) {
  const { data } = useQuery({
    queryKey: chaveDoAnexo(projectId, sessionId, anexo.id),
    queryFn: () => lerAnexoComoDataUrl(projectId, sessionId, anexo.id),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <span className={chip} data-testid="anexo-chip">
      {data && <img src={data} alt={anexo.nome} className={miniatura} />}
      <span>{anexo.nome}</span>
      <span>{formatarTamanho(anexo.tamanho)}</span>
    </span>
  );
}
