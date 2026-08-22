import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import styles from './AuthLayout.module.css';

interface SetPasswordPageProps {
  token: string | undefined;
  onDefinir: (
    token: string,
    novaSenha: string,
  ) => Promise<{ ok: boolean; status: number }>;
  irPara: (rota: string) => void;
}

const MINIMO_DE_SENHA = 12;

/**
 * Definir senha a partir do link (Fase 7a — o corte; visual no ADR 0036).
 *
 * Atende os dois propósitos da api — `password_reset` e
 * `set_initial_password`, o do usuário migrado — porque o cliente não escolhe
 * qual é: manda o token, e o servidor tenta os dois. Se a tela pudesse
 * escolher, ela também poderia DESCOBRIR de que tipo é a conta, o que é o
 * mesmo vazamento por outro caminho.
 *
 * ## Não loga o usuário no fim
 *
 * A api não emite sessão aqui, de propósito: entrar direto a partir de um link
 * recebido por e-mail faria comprometer o e-mail equivaler a tomar a conta,
 * sem segundo passo. A tela manda para o login.
 *
 * ## Onde cada erro aparece
 *
 * Senha curta e senhas diferentes são erros de campo — saem sob o campo em que
 * se conserta cada um. Link inválido e falha de rede são do formulário: nenhum
 * campo está errado, e o alerta no topo do card é onde isso se diz.
 */
export function SetPasswordPage({
  token,
  onDefinir,
  irPara,
}: SetPasswordPageProps) {
  const { t } = useTranslation('auth');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [erroDeSenha, setErroDeSenha] = useState<string | null>(null);
  const [erroDeConfirmacao, setErroDeConfirmacao] = useState<string | null>(
    null,
  );
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setErroDeSenha(null);
    setErroDeConfirmacao(null);

    if (!token) {
      setErro(t('setPasswordPage.errors.missingToken'));
      return;
    }
    if (senha.length < MINIMO_DE_SENHA) {
      setErroDeSenha(
        t('setPasswordPage.errors.passwordTooShort', { minimo: MINIMO_DE_SENHA }),
      );
      return;
    }
    if (senha !== confirmacao) {
      setErroDeConfirmacao(t('setPasswordPage.errors.passwordMismatch'));
      return;
    }

    setEnviando(true);
    try {
      const r = await onDefinir(token, senha);
      if (r.ok) {
        setPronto(true);
        return;
      }
      // A api não distingue link inexistente, expirado e já usado — os três
      // têm a mesma resposta, para não contar a um ladrão de token se a vítima
      // chegou primeiro.
      setErro(t('setPasswordPage.errors.invalidToken'));
    } catch {
      setErro(t('setPasswordPage.errors.network'));
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <AuthLayout
        titulo={t('setPasswordPage.success.title')}
        subtitulo={t('setPasswordPage.success.subtitle')}
        irPara={irPara}
      >
        <Alert tone="success" role="status">
          {t('setPasswordPage.success.message')}
        </Alert>
        <Button fullWidth onClick={() => irPara('/login')}>
          {t('setPasswordPage.success.goToLogin')}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      titulo={t('setPasswordPage.form.title')}
      subtitulo={t('setPasswordPage.form.subtitle')}
      irPara={irPara}
      rodapeDoCartao={
        <>
          {t('setPasswordPage.form.expiredPrompt')}{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => irPara('/esqueci-senha')}
          >
            {t('setPasswordPage.form.requestAnother')}
          </button>
        </>
      }
    >
      {erro && (
        <Alert tone="danger" role="alert">
          {erro}
        </Alert>
      )}

      <form className={styles.form} onSubmit={submeter}>
        <Input
          label={t('setPasswordPage.form.newPasswordLabel')}
          type="password"
          autoComplete="new-password"
          required
          preenchido
          revelavel
          mono
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          error={erroDeSenha}
          hint={t('setPasswordPage.form.passwordHint', { minimo: MINIMO_DE_SENHA })}
        />
        <Input
          label={t('setPasswordPage.form.confirmPasswordLabel')}
          type="password"
          autoComplete="new-password"
          required
          preenchido
          revelavel
          mono
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          error={erroDeConfirmacao}
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth size="lg" loading={enviando}>
            {enviando ? t('setPasswordPage.form.submitting') : t('setPasswordPage.form.submit')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
