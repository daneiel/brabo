import { useMemo, useState, type CSSProperties } from 'react';
import { PlugZap, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  deleteCredential,
  listCredentials,
  listModelCatalog,
  mensagemDaApi,
  syncModelCatalog,
  testCredential,
  upsertCredential,
} from '../../lib/api-client';
import {
  COR_DO_PROVIDER,
  CREDENCIAIS_DE_LLM,
  providersSemCatalogo,
  type LlmCredentialProvider,
} from '../../lib/models';
import { Input } from '../../components/ui/Input';
import { Ajuda } from '@/components/ui/Ajuda';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/shadcn/item';
import styles from '../ProjectSettingsTab.module.css';
import { FRESCOR_DA_CONFIGURACAO_MS } from '../../lib/query-policy';
import { listProviderCapabilities } from '../../lib/api-client';
import { useCurrentWorkspaceWithRole } from '../../lib/hooks';
import { roleAtLeast } from '../../lib/roles';

/**
 * A sigla de duas letras do chip do conector (handoff, seção 7 item 4).
 *
 * NÃO é `iniciaisDe`: aquela quebra por espaço, e "OpenAI" e "OpenRouter" são
 * uma palavra só — as duas saíam como `OP`, dois conectores com o mesmo
 * distintivo lado a lado. As MAIÚSCULAS do nome distinguem (`OA` e `OR`), e
 * quando só há uma (Anthropic, Vultr) valem as duas primeiras letras.
 */
function siglaDoConector(label: string): string {
  const maiusculas = label.replace(/[^A-Za-z]/gu, '').match(/[A-Z]/gu) ?? [];
  const letras =
    maiusculas.length >= 2 ? maiusculas.slice(0, 2).join('') : label.slice(0, 2);
  return letras.toUpperCase();
}

/**
 * Exportada para o teste, como ExecutionSection e PromotionSection.
 *
 * ## Por que esta seção salva por LINHA, e não por seção
 *
 * `ParallelismSection` e `BudgetSection` passaram a ter um botão só, da seção
 * (`settings/secao-salvavel.tsx`). Esta NÃO passou, e a semelhança de fora — as
 * três guardavam `drafts: Record<string, string>` — esconde três diferenças que
 * são o motivo:
 *
 * 1. **Não há valor do servidor com que comparar.** A credencial é write-only e
 *    nunca volta (ADR 0050) — é por isso que o card mostra a data e não a chave.
 *    O hook decide "sujo" comparando o rascunho ao que a api tem; aqui só existe
 *    o rascunho. Um botão por seção teria de chamar "sujo" tudo que tem texto,
 *    o que não é a mesma pergunta.
 * 2. **O botão da linha não é sempre "Salvar".** Ele diz "Trocar" no provider
 *    que já tem chave, porque a consequência é outra: substituir uma credencial
 *    em uso. Um botão só da seção não consegue dizer as duas coisas, e um botão
 *    que diga "Salvar" para uma troca mente.
 * 3. **Ele divide o card com "Testar" e "Remover"**, que agem sobre AQUELE
 *    provider e não têm equivalente de seção. Tirar um dos três do card deixaria
 *    dois botões de linha e um de seção fazendo trabalho vizinho.
 *
 * Somando: `upsertCredential` faz a api VERIFICAR a chave, então 422 é o
 * desfecho comum de um paste errado, não a exceção. Agrupar oito verificações
 * num clique transformaria o caso normal em relatório de falha parcial, no
 * lugar do toast direto que o comentário de `handleSave` abaixo custou caro.
 */
export function CredentialsSection() {
  const { t, i18n } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: credentials } = useQuery({
    queryKey: ['credentials'],
    queryFn: listCredentials,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /**
   * "Atualizar catálogo" AO LADO da credencial (RN-694): cadastrar a chave não
   * descobre modelo, e o botão que descobre morava no fim da página. É a MESMA
   * ação do catálogo (`POST .../models/sync`, `owner`) e só aparece no card
   * cujo provider tem credencial e nenhum modelo no catálogo. Ler o catálogo
   * pede `maintainer`; o botão pede `owner` — abaixo disso a nota fica e o
   * controle não é oferecido (RN-102).
   */
  const { data: comPapel } = useCurrentWorkspaceWithRole();
  const workspaceId = comPapel?.workspace?.id;
  const podeLerCatalogo = roleAtLeast(comPapel?.role, 'maintainer');
  const podeSincronizar = roleAtLeast(comPapel?.role, 'owner');
  const { data: catalogo } = useQuery({
    queryKey: ['model-catalog', workspaceId],
    queryFn: () => listModelCatalog(workspaceId!),
    enabled: !!workspaceId && podeLerCatalogo,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const semCatalogo = useMemo(
    () =>
      credentials && catalogo
        ? new Set<string>(providersSemCatalogo(credentials, catalogo))
        : new Set<string>(),
    [credentials, catalogo],
  );
  // Provider sem `listModels` não tem o que sincronizar: o botão não é
  // oferecido e a nota diz por quê. Capability ainda desconhecida (carregando
  // ou falhada) NÃO vira "sem catálogo" — fica o comportamento anterior.
  const { data: capacidades } = useQuery({
    queryKey: ['provider-capabilities'],
    queryFn: listProviderCapabilities,
    staleTime: FRESCOR_DA_CONFIGURACAO_MS,
  });
  const semListModels = (id: string) =>
    capacidades?.find((c) => c.provider === id)?.capabilities.listModels === false;
  const [sincronizando, setSincronizando] = useState(false);

  async function handleSync() {
    if (!workspaceId) return;
    setSincronizando(true);
    try {
      await syncModelCatalog(workspaceId);
      void queryClient.invalidateQueries({ queryKey: ['model-catalog', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['models'] });
      showToast({ title: t('catalog.toasts.syncSuccess', { ns: 'models' }), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('catalog.toasts.syncErrorTitle', { ns: 'models' }),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setSincronizando(false);
    }
  }

  // Qual provider está com uma chamada em voo — `null` quando nenhum. Um id
  // só, e não um booleano por card: duas chamadas simultâneas aqui não fazem
  // sentido nenhum, e o estado por provider convidaria a esquecer de limpá-lo.
  const [emVoo, setEmVoo] = useState<string | null>(null);

  /**
   * Todo `catch` desta seção existe por um bug real: sem eles, o `ApiError`
   * escapava do `onClick` e caía no `unhandledrejection` global, que só LOGA.
   * O sintoma era o pior possível — o botão Salvar parecia não ter ação,
   * enquanto a api respondia 422 a cada clique.
   */
  async function handleSave(provider: LlmCredentialProvider) {
    const apiKey = drafts[provider]?.trim();
    if (!apiKey) return;
    setEmVoo(provider);
    try {
      await upsertCredential({ provider, apiKey });
      setDrafts((d) => ({ ...d, [provider]: '' }));
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      showToast({ title: t('credentials.toast.saved'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('credentials.toast.saveErrorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setEmVoo(null);
    }
  }

  /**
   * A verificação que saiu do cadastro (ADR 0050). Os três resultados viram
   * três toasts diferentes de propósito: `nao_suportado` NÃO pode parecer
   * sucesso, senão a tela afirma que uma chave foi checada quando ninguém a
   * checou.
   */
  async function handleTest(provider: LlmCredentialProvider) {
    setEmVoo(provider);
    try {
      const { resultado, motivo } = await testCredential(provider);
      if (resultado === 'ok') {
        showToast({ title: t('credentials.toast.testOk'), tone: 'success' });
      } else if (resultado === 'recusado') {
        showToast({ title: t('credentials.toast.testRefused'), message: motivo, tone: 'danger' });
      } else {
        showToast({
          title: t('credentials.toast.testUnsupportedTitle'),
          message: t('credentials.toast.testUnsupportedMessage'),
          tone: 'warning',
        });
      }
    } catch (erro) {
      showToast({
        title: t('credentials.toast.testErrorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setEmVoo(null);
    }
  }

  async function handleRemove(provider: LlmCredentialProvider) {
    setEmVoo(provider);
    try {
      await deleteCredential(provider);
      queryClient.invalidateQueries({ queryKey: ['credentials'] });
      showToast({ title: t('credentials.toast.removed'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('credentials.toast.removeErrorTitle'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setEmVoo(null);
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('credentials.title')}</h2>
        <span className={styles.eyebrow}>{t('credentials.eyebrow')}</span>
        <Ajuda assunto={t('credentials.title')}>
          {t('credentials.subtitle.before')}
          <strong>{t('credentials.subtitle.swap')}</strong>
          {t('credentials.subtitle.middle')}
          <strong>{t('credentials.subtitle.test')}</strong>
          {t('credentials.subtitle.after')}
        </Ajuda>
      </div>

      {/* Lista linear (AT-714, prévia v7): uma linha `Item` por provider —
          sigla, nome, estado da chave e ações só com ícone. A credencial é
          write-only e nunca volta do servidor (ADR 0050): a linha mostra a
          data, nunca uma chave mascarada inventada. */}
      <ItemGroup className={styles.conectorLista}>
        {CREDENCIAIS_DE_LLM.map(({ id, label, kind }) => {
          const existing = credentials?.find((c) => c.provider === id);
          const rascunho = drafts[id]?.trim() ?? '';
          const ocupado = emVoo === id;
          const cor = COR_DO_PROVIDER[id];
          return (
            <Item
              key={id}
              variant="outline"
              size="sm"
              className="flex-wrap"
              style={{ ['--conector-cor' as string]: cor } as CSSProperties}
            >
              <ItemMedia>
                <span className={styles.conectorSigla}>{siglaDoConector(label)}</span>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {label}
                  <span className={styles.conectorTipo}>
                    {/* Um hub roteia para provedores de terceiros: o custo e a
                        disponibilidade dependem de quem serve por baixo. */}
                    {kind === 'hub'
                      ? t('credentials.connector.hub')
                      : t('credentials.connector.provider')}
                  </span>
                </ItemTitle>
                <ItemDescription>
                  {existing
                    ? t('credentials.connector.configuredNote', {
                        date: new Date(existing.updatedAt).toLocaleDateString(i18n.language),
                      })
                    : t('credentials.connector.noneSaved')}
                  {existing && semCatalogo.has(id) && (
                    <>
                      {' '}
                      {semListModels(id)
                        ? t('credentials.connector.noCatalogSource')
                        : t('credentials.connector.noModels')}
                    </>
                  )}
                </ItemDescription>
              </ItemContent>
              <span
                className={[styles.conectorStatus, existing && styles.conectorAtivo]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.conectorPonto} />
                {existing
                  ? t('credentials.connector.configured')
                  : t('credentials.connector.missing')}
              </span>
              <ItemActions>
                {/* O input fica SEMPRE visível: com credencial salva ele é o
                    caminho da troca, que antes só existia removendo primeiro. */}
                <Input
                  mono
                  type="password"
                  aria-label={
                    existing
                      ? t('credentials.connector.newKeyAria', { label })
                      : t('credentials.connector.apiKeyAria', { label })
                  }
                  placeholder={
                    existing
                      ? t('credentials.connector.swapPlaceholder')
                      : t('credentials.connector.apiKeyPlaceholder')
                  }
                  value={drafts[id] ?? ''}
                  onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                />
                <Button
                  legenda={
                    existing
                      ? t('credentials.connector.swapKeyAria', { label })
                      : t('credentials.connector.saveKeyAria', { label })
                  }
                  disabled={ocupado || rascunho.length === 0}
                  onClick={() => handleSave(id)}
                >
                  {existing ? <RefreshCw aria-hidden="true" /> : <Save aria-hidden="true" />}
                </Button>
                {existing && (
                  <>
                    <Button
                      variant="secondary"
                      legenda={t('credentials.connector.testKeyAria', { label })}
                      disabled={ocupado}
                      onClick={() => handleTest(id)}
                    >
                      <PlugZap aria-hidden="true" />
                    </Button>
                    <Button
                      variant="danger"
                      legenda={t('credentials.connector.removeKeyAria', { label })}
                      disabled={ocupado}
                      onClick={() => handleRemove(id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                    {semCatalogo.has(id) && podeSincronizar && !semListModels(id) && (
                      <Button
                        variant="secondary"
                        legenda={t('credentials.connector.updateCatalogAria', { label })}
                        disabled={sincronizando}
                        onClick={() => void handleSync()}
                      >
                        <RefreshCw aria-hidden="true" />
                      </Button>
                    )}
                  </>
                )}
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
    </section>
  );
}
