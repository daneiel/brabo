import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getMyPreferences,
  mensagemDaApi,
  updateMyPreferences,
} from '../lib/api-client';
import {
  IDIOMA_AUTOMATICO,
  OPCAO_OUTRO_CODIGO,
  QUERY_KEY_PREFERENCIAS,
  nomeDoIdioma,
  opcoesDeIdioma,
} from '../lib/idioma-da-resposta';
import type { UserPreferences } from '../lib/api-types';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/ToastProvider';
import styles from './AccountPage.module.css';

/**
 * O idioma em que os agentes respondem à pessoa, na Conta
 * ([RN-618](../../../../docs/business-rules.md#rn-618)).
 *
 * ## Separado do idioma da interface, de propósito
 *
 * A seção vizinha ("Idioma", da interface) é fechada a dois valores porque
 * cada um precisa de arquivo de tradução. Esta é ABERTA (decisão do
 * mantenedor, AT-168): responder em espanhol não exige a interface em
 * espanhol. Uma não escreve na outra — é o que a api garante e o que o texto
 * diz.
 *
 * ## Quando salva
 *
 * A régua da RN-469 é o CONTROLE: escolher um valor NOMEADO no seletor salva
 * no `onChange`; o código DIGITADO em "Outro código…" pede o botão, porque
 * cada tecla não é uma escolha.
 *
 * ## O que a tela diz
 *
 * O efetivo SEMPRE com a origem (RN-470): "automático" sozinho não diz em que
 * idioma o agente vai responder, e o valor sozinho não diz por quê. E a tela
 * DECLARA que o valor ainda não chega aos agentes: o transporte até o modelo é
 * a AT-164, e até lá afirmar "os agentes respondem em X" seria mentir.
 */
export function ResponseLanguageSection() {
  const { t, i18n } = useTranslation('responseLanguage');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [digitando, setDigitando] = useState(false);
  const [codigo, setCodigo] = useState('');

  const { data, isPending, isError } = useQuery({
    queryKey: QUERY_KEY_PREFERENCIAS,
    queryFn: getMyPreferences,
  });

  const salvar = useMutation({
    mutationFn: (responseLanguage: string) =>
      updateMyPreferences({ responseLanguage }),
    onSuccess: (prefs: UserPreferences) => {
      queryClient.setQueryData(QUERY_KEY_PREFERENCIAS, prefs);
      // A barra de cada sessão lê a cadeia que PARTE da conta.
      void queryClient.invalidateQueries({
        queryKey: ['session-response-language'],
      });
      setDigitando(false);
      setCodigo('');
      showToast({ title: t('account.saved'), tone: 'success' });
    },
    onError: (erro) => {
      showToast({
        title: t('account.error'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    },
  });

  const idiomaDaInterface = i18n.language || 'en';

  function escolher(valor: string) {
    if (valor === OPCAO_OUTRO_CODIGO) {
      setDigitando(true);
      return;
    }
    setDigitando(false);
    if (data && valor === data.responseLanguage) return;
    salvar.mutate(valor);
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t('account.title')}</h2>
        <span className={styles.eyebrow}>{t('account.eyebrow')}</span>
      </div>
      <p className={styles.sectionSubtitle}>{t('account.subtitle')}</p>
      {/* Até a AT-164 nada disso chega ao modelo, e a tela não pode dizer
          "os agentes respondem em X" antes de ser verdade. Sai com ela. */}
      <p className={styles.sectionSubtitle}>{t('account.notYetApplied')}</p>

      <div className={styles.card}>
        <div className={styles.cardInfo}>
          <div className={styles.cardTitle}>{t('account.label')}</div>
          <div className={styles.cardHint} data-testid="idioma-efetivo">
            {isPending && t('account.loading')}
            {isError && t('account.loadError')}
            {data &&
              (salvar.isPending
                ? t('account.saving')
                : t('account.effective', {
                    idioma: nomeDoIdioma(
                      data.effectiveResponseLanguage.language,
                      idiomaDaInterface,
                    ),
                    origem: t(`origin.${data.effectiveResponseLanguage.origin}`),
                  }))}
          </div>
          {data?.detectedLanguage && (
            <div className={styles.cardHint}>
              {t('account.detectedNote', {
                idioma: nomeDoIdioma(data.detectedLanguage, idiomaDaInterface),
              })}
            </div>
          )}
        </div>
        <div className={styles.cardControl}>
          <Select
            value={digitando ? OPCAO_OUTRO_CODIGO : (data?.responseLanguage ?? '')}
            disabled={!data || salvar.isPending}
            aria-label={t('account.label')}
            onChange={(e) => escolher(e.target.value)}
          >
            <option value={IDIOMA_AUTOMATICO}>{t('account.automatic')}</option>
            {opcoesDeIdioma(data?.responseLanguage ?? null).map((c) => (
              <option key={c} value={c}>
                {nomeDoIdioma(c, idiomaDaInterface)}
              </option>
            ))}
            <option value={OPCAO_OUTRO_CODIGO}>{t('account.otherCode')}</option>
          </Select>
        </div>
      </div>

      {digitando && (
        <form
          className={styles.acoes}
          onSubmit={(e) => {
            e.preventDefault();
            if (codigo.trim()) salvar.mutate(codigo.trim());
          }}
        >
          <Input
            label={t('account.otherLabel')}
            hint={t('account.otherHint')}
            value={codigo}
            mono
            onChange={(e) => setCodigo(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!codigo.trim()}
            loading={salvar.isPending}
          >
            {t('account.save')}
          </Button>
        </form>
      )}
    </div>
  );
}
