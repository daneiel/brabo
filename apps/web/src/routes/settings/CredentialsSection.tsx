import { useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  deleteCredential,
  listCredentials,
  mensagemDaApi,
  testCredential,
  upsertCredential,
} from '../../lib/api-client';
import {
  CREDENCIAIS_DE_LLM,
  type LlmCredentialProvider,
} from '../../lib/models';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import styles from '../ProjectSettingsTab.module.css';
import { SecaoDeConfiguracoes } from './SecaoDeConfiguracoes';

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
 * A cor da borda esquerda de cada conector (handoff, seção 7 item 4). Só tokens
 * semânticos — o handoff nomeia terracota para a Anthropic e teal para a
 * OpenAI, e os demais seguem o mesmo repertório de quatro acentos.
 *
 * `Record<LlmCredentialProvider, …>` de propósito: provider novo entra na lista
 * derivando de `ROTULO_DO_PROVIDER`, e é o compilador que cobra a cor aqui em
 * vez de ele nascer sem borda nenhuma.
 */
const COR_DO_CONECTOR: Record<LlmCredentialProvider, string> = {
  anthropic: 'var(--accent)',
  openai: 'var(--success)',
  openrouter: 'var(--violet)',
  'nvidia-nim': 'var(--success)',
  together: 'var(--warning)',
  deepinfra: 'var(--violet)',
  bitdeer: 'var(--accent)',
  vultr: 'var(--warning)',
};

// Exportada para o teste, como ExecutionSection e PromotionSection.
export function CredentialsSection() {
  const { t, i18n } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: credentials } = useQuery({ queryKey: ['credentials'], queryFn: listCredentials });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

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
    <SecaoDeConfiguracoes chave="credentials">
      <div className={styles.sectionHead}>
        <h2 className={styles.title}>{t('credentials.title')}</h2>
        <span className={styles.eyebrow}>{t('credentials.eyebrow')}</span>
      </div>
      <div className={styles.subtitle}>
        {t('credentials.subtitle.before')}
        <strong>{t('credentials.subtitle.swap')}</strong>
        {t('credentials.subtitle.middle')}
        <strong>{t('credentials.subtitle.test')}</strong>
        {t('credentials.subtitle.after')}
      </div>

      {/* Grid de conectores do handoff (seção 7, item 4): um card por
          provider, borda esquerda na cor dele, sigla de duas letras, tipo em
          mono e ponto de status pulsante. Era uma pilha de nove faixas de
          largura total, e o desenho pede
          `repeat(auto-fill, minmax(300px, 1fr))`. */}
      <div className={styles.conectorGrid}>
        {CREDENCIAIS_DE_LLM.map(({ id, label, kind }) => {
          const existing = credentials?.find((c) => c.provider === id);
          const rascunho = drafts[id]?.trim() ?? '';
          const ocupado = emVoo === id;
          const cor = COR_DO_CONECTOR[id];
          return (
            <div
              key={id}
              className={styles.conectorCard}
              style={{ ['--conector-cor' as string]: cor } as CSSProperties}
            >
              <div className={styles.conectorTopo}>
                <span className={styles.conectorSigla}>{siglaDoConector(label)}</span>
                <div className={styles.conectorIdent}>
                  <div className={styles.conectorNome}>{label}</div>
                  <div className={styles.conectorTipo}>
                    {/* Um hub roteia para provedores de terceiros: o custo e a
                        disponibilidade dependem de quem serve por baixo. */}
                    {kind === 'hub'
                      ? t('credentials.connector.hub')
                      : t('credentials.connector.provider')}
                  </div>
                </div>
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
              </div>

              {/* O desenho mostra a chave mascarada. Aqui ela NÃO existe: a
                  credencial é write-only e nunca volta do servidor (ADR 0050).
                  Mostrar `sk-••••` seria inventar um prefixo que ninguém leu. */}
              <div className={styles.conectorNota}>
                {existing
                  ? t('credentials.connector.configuredNote', {
                      date: new Date(existing.updatedAt).toLocaleDateString(i18n.language),
                    })
                  : t('credentials.connector.noneSaved')}
              </div>

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

              <div className={styles.conectorAcoes}>
                {/* Nome acessível com o provider: são oito cards com botões de
                    texto idêntico, e "Salvar" sozinho não diz salvar o quê. */}
                <Button
                  aria-label={
                    existing
                      ? t('credentials.connector.swapKeyAria', { label })
                      : t('credentials.connector.saveKeyAria', { label })
                  }
                  disabled={ocupado || rascunho.length === 0}
                  onClick={() => handleSave(id)}
                >
                  {existing ? t('credentials.connector.swap') : t('credentials.connector.save')}
                </Button>
                {existing && (
                  <>
                    <Button
                      variant="secondary"
                      aria-label={t('credentials.connector.testKeyAria', { label })}
                      disabled={ocupado}
                      onClick={() => handleTest(id)}
                    >
                      {t('credentials.connector.test')}
                    </Button>
                    <Button
                      variant="danger"
                      aria-label={t('credentials.connector.removeKeyAria', { label })}
                      disabled={ocupado}
                      onClick={() => handleRemove(id)}
                    >
                      {t('credentials.connector.remove')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SecaoDeConfiguracoes>
  );
}
