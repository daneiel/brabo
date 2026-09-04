import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import styles from './AuthLayout.module.css';

interface RegisterPageProps {
  onRegistrar: (
    email: string,
    senha: string,
    nome?: string,
  ) => Promise<{ ok: boolean; status: number }>;
  irPara: (rota: string) => void;
}

/** Mínimo da política do domínio. Ver domain/auth/password-policy.ts. */
const MINIMO_DE_SENHA = 12;

/**
 * Registro (Fase 7a — o corte; fidelidade visual no ADR 0036).
 *
 * ## Por que não existe "esse e-mail já está em uso"
 *
 * A api responde 202 tanto para endereço novo quanto para já cadastrado, e
 * manda um aviso ao dono no segundo caso. Um `409 Conflict` — que é o que o
 * bom senso REST pediria — entregaria a lista de usuários a quem tiver uma
 * wordlist, e tornaria inútil todo o cuidado do login.
 *
 * O custo é de produto e está assumido no ADR 0031: esta tela não pode dizer
 * se a conta existe, então diz "se o endereço estiver disponível".
 *
 * ## Dois lugares para erro, e a diferença importa
 *
 * A senha curta é erro DO CAMPO: sai sob o campo de senha, com `aria-invalid`,
 * porque é ali que se conserta. Recusa do servidor é erro DO FORMULÁRIO: vai para
 * o alerta no topo do card, porque não aponta para campo nenhum. Misturar os dois
 * no mesmo lugar obrigaria a ler a mensagem para saber onde mexer.
 */
export function RegisterPage({ onRegistrar, irPara }: RegisterPageProps) {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [erroDeSenha, setErroDeSenha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setErroDeSenha(null);

    if (senha.length < MINIMO_DE_SENHA) {
      setErroDeSenha(
        t('registerPage.errors.passwordTooShort', { minimo: MINIMO_DE_SENHA }),
      );
      return;
    }

    setEnviando(true);
    try {
      const r = await onRegistrar(email, senha, nome || undefined);
      if (r.ok) {
        setEnviado(true);
        return;
      }
      setErro(
        r.status === 403
          ? t('registerPage.errors.registrationClosed')
          : t('registerPage.errors.generic'),
      );
    } catch {
      setErro(t('registerPage.errors.network'));
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <AuthLayout
        titulo={t('registerPage.success.title')}
        subtitulo={t('registerPage.success.subtitle')}
        irPara={irPara}
      >
        {/*
          `role="status"` e não `alert`: a live region polida espera o leitor de
          tela terminar a frase antes de anunciar. Interromper para dar uma boa
          notícia é grosseria de software.
        */}
        <Alert tone="success" role="status">
          {t('registerPage.success.messagePrefix')}
          <strong>{email}</strong>
          {t('registerPage.success.messageSuffix')}
        </Alert>
        <Button variant="secondary" fullWidth onClick={() => irPara('/login')}>
          {t('registerPage.success.backToLogin')}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      titulo={t('registerPage.form.title')}
      subtitulo={t('registerPage.form.subtitle')}
      irPara={irPara}
      rodapeDoCartao={
        <>
          {t('registerPage.form.alreadyHaveAccountPrompt')}{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => irPara('/login')}
          >
            {t('registerPage.form.login')}
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
          label={t('registerPage.form.emailLabel')}
          type="email"
          placeholder={t('registerPage.form.emailPlaceholder')}
          autoComplete="username"
          required
          preenchido
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label={t('registerPage.form.nameLabel')}
          autoComplete="name"
          preenchido
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          hint={t('registerPage.form.nameHint')}
        />
        <Input
          label={t('registerPage.form.passwordLabel')}
          type="password"
          autoComplete="new-password"
          required
          preenchido
          revelavel
          mono
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          error={erroDeSenha}
          hint={t('registerPage.form.passwordHint', { minimo: MINIMO_DE_SENHA })}
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth size="lg" loading={enviando}>
            {enviando ? t('registerPage.form.submitting') : t('registerPage.form.submit')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
