import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { emailDaSessao } from '../lib/auth';
import { mensagemDaApi } from '../lib/api-client';
import { definirIdioma, IDIOMAS, type Idioma } from '../lib/idioma';
import { useToast } from '../components/ui/ToastProvider';
import { Select } from '../components/ui/Select';
import styles from './AccountPage.module.css';

const ROTULO: Record<Idioma, (t: (chave: string) => string) => string> = {
  'pt-BR': (t) => t('account.language.ptBR'),
  en: (t) => t('account.language.en'),
};

/**
 * A tela de conta (`/account`, fundação de i18n — Onda 6a).
 *
 * Fora do escopo de projeto de propósito: idioma é preferência do USUÁRIO,
 * e a única superfície de perfil que existia até aqui
 * (`ProjectSettingsTab`) é por projeto — escopo errado para algo que segue a
 * pessoa entre projetos.
 *
 * Prova o mecanismo de verdade: troca o idioma AQUI e a própria página muda
 * de texto (via `react-i18next`) — não é só grava-e-esquece. O resto da
 * interface segue em pt-BR hardcoded até a extração em massa (etapa
 * separada, em paralelo).
 */
export function AccountPage() {
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const [salvando, setSalvando] = useState(false);
  const email = emailDaSessao();

  const idiomaAtual: Idioma = i18n.language === 'pt-BR' ? 'pt-BR' : 'en';

  async function trocarIdioma(novo: Idioma) {
    if (novo === idiomaAtual) return;
    setSalvando(true);
    try {
      await definirIdioma(novo, i18n);
      showToast({ title: t('account.language.saved'), tone: 'success' });
    } catch (erro) {
      showToast({
        title: t('account.language.error'),
        message: mensagemDaApi(erro),
        tone: 'danger',
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('account.title')}</h1>
        <p className={styles.subtitle}>{t('account.subtitle')}</p>
        {email && (
          <span className={styles.identity}>
            {t('account.emailLabel')}: {email}
          </span>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('account.language.title')}</h2>
          <span className={styles.eyebrow}>{t('account.language.eyebrow')}</span>
        </div>
        <p className={styles.sectionSubtitle}>{t('account.language.subtitle')}</p>

        <div className={styles.card}>
          <div className={styles.cardInfo}>
            <div className={styles.cardTitle}>{t('account.language.title')}</div>
            <div className={styles.cardHint}>
              {salvando ? t('account.language.saving') : ROTULO[idiomaAtual](t)}
            </div>
          </div>
          <div className={styles.cardControl}>
            <Select
              value={idiomaAtual}
              disabled={salvando}
              aria-label={t('account.language.title')}
              onChange={(e) => void trocarIdioma(e.target.value as Idioma)}
            >
              {IDIOMAS.map((idioma) => (
                <option key={idioma} value={idioma}>
                  {ROTULO[idioma](t)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
