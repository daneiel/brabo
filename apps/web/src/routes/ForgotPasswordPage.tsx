import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import styles from './AuthLayout.module.css';

interface ForgotPasswordPageProps {
  onPedir: (email: string) => Promise<{ ok: boolean }>;
  irPara: (rota: string) => void;
}

/**
 * Pedido de redefinição (Fase 7a — o corte; fidelidade visual no ADR 0036).
 *
 * É também o caminho do usuário MIGRADO do Keycloak: a senha antiga não veio
 * junto, e o `set_initial_password` é emitido por aqui. Por isso o texto fala
 * em "definir" e não só em "redefinir" — quem nunca teve senha nesta api
 * também está no lugar certo.
 *
 * A resposta é 202 para endereço conhecido e desconhecido, então a tela mostra
 * o mesmo aviso nos dois casos. Confirmar a existência aqui reabriria a
 * enumeração que o login fecha.
 */
export function ForgotPasswordPage({
  onPedir,
  irPara,
}: ForgotPasswordPageProps) {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await onPedir(email);
      // Sucesso mesmo se a api recusar: o resultado não pode variar com a
      // existência da conta, e a tela não tem nada melhor a dizer.
      setEnviado(true);
    } catch {
      setErro(t('forgotPasswordPage.networkError'));
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <AuthLayout
        titulo={t('forgotPasswordPage.success.title')}
        subtitulo={t('forgotPasswordPage.success.subtitle')}
        irPara={irPara}
      >
        <Alert tone="success" role="status">
          {t('forgotPasswordPage.success.messagePrefix')}
          <strong>{email}</strong>
          {t('forgotPasswordPage.success.messageSuffix')}
        </Alert>
        <Button variant="secondary" fullWidth onClick={() => irPara('/login')}>
          {t('forgotPasswordPage.success.backToLogin')}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      titulo={t('forgotPasswordPage.form.title')}
      subtitulo={t('forgotPasswordPage.form.subtitle')}
      irPara={irPara}
      rodapeDoCartao={
        <>
          {t('forgotPasswordPage.form.rememberedPrompt')}{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => irPara('/login')}
          >
            {t('forgotPasswordPage.form.backToLogin')}
          </button>
        </>
      }
      abaixoDoCartao={
        <Alert tone="warning">
          {t('forgotPasswordPage.form.migrationNoticePrefix')}
          <strong>{t('forgotPasswordPage.form.migrationNoticeStrong')}</strong>
          {t('forgotPasswordPage.form.migrationNoticeSuffix')}
        </Alert>
      }
    >
      {erro && (
        <Alert tone="danger" role="alert">
          {erro}
        </Alert>
      )}

      <form className={styles.form} onSubmit={submeter}>
        <Input
          label={t('forgotPasswordPage.form.emailLabel')}
          type="email"
          placeholder={t('forgotPasswordPage.form.emailPlaceholder')}
          autoComplete="username"
          required
          preenchido
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth size="lg" loading={enviando}>
            {enviando
              ? t('forgotPasswordPage.form.submitting')
              : t('forgotPasswordPage.form.submit')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
