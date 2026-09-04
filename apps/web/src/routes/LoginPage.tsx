import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { GitHubIcon, GitLabIcon } from '../components/ui/icons';
import { SinaisDoAmbiente } from '../components/SinaisDoAmbiente';
import { runtimeConfig } from '../lib/runtime-config';
import { AuthLayout } from './AuthLayout';
import styles from './AuthLayout.module.css';

interface LoginPageProps {
  onEntrar: (
    email: string,
    senha: string,
  ) => Promise<{ ok: true } | { ok: false; status: number }>;
  irPara: (rota: string) => void;
  /**
   * `true` quando a página abriu vinda de `?oauth_error=1` — o callback de
   * login social (ADR 0084) redireciona para cá em QUALQUER falha, sem
   * detalhar o motivo na URL (RN-283), pelo mesmo raciocínio da RN-032: o
   * 401 uniforme do login por senha.
   */
  erroOAuth?: boolean;
}

/**
 * Login (Fase 7a — o corte; fidelidade visual no ADR 0036).
 *
 * ## A mensagem de erro é sempre a mesma, de propósito
 *
 * A api devolve o MESMO 401 para e-mail inexistente, senha errada, conta
 * bloqueada por lockout e conta migrada que ainda não definiu senha (RN-032).
 * Se esta tela tentasse ser prestativa e traduzir cada caso, reintroduziria no
 * cliente o oráculo de enumeração que o servidor fecha — e não conseguiria,
 * porque a informação não chega aqui.
 *
 * O texto sobre a migração é FIXO e vive fora do card, num alerta próprio: ele
 * cobre o usuário migrado sem afirmar nada sobre a conta. É derivado de nenhum
 * sinal do servidor, então não vaza.
 *
 * ## Por que os dois alertas são irmãos e nunca aninhados
 *
 * O erro de credencial usa `role="alert"` — live region assertiva, em que o
 * leitor de tela interrompe para dizer que a tentativa falhou. O aviso de
 * migração não usa papel nenhum: é texto que já estava na tela quando ela abriu.
 *
 * Se ele caísse DENTRO do `role="alert"`, o anúncio da falha passaria a incluir
 * "a senha antiga não foi migrada" — exatamente a insinuação sobre a conta que o
 * 401 uniforme existe para evitar. `LoginPage.test.tsx` guarda essa separação
 * afirmando que o alerta não casa `/migrad|senha antiga/`.
 *
 * ## Sem `aria-invalid` nos campos
 *
 * Credencial recusada não é erro de campo: nem o e-mail nem a senha estão
 * individualmente malformados, e a api não diz qual dos dois errou. Marcar os
 * dois como inválidos afirmaria mais do que se sabe. O erro é do formulário, e é
 * onde ele aparece.
 *
 * ## Duas colunas: identidade à esquerda, formulário à direita
 *
 * O login é a ÚNICA das quatro telas de auth que entrega `colunaDeIdentidade`
 * — as outras três (registro, esqueci-senha, definir-senha) continuam na
 * coluna única. É deliberado: elas são passagens de um fluxo já iniciado, e
 * quem chega nelas já sabe onde está. O login é a primeira tela do produto, e
 * é a única que precisa dizer o que o produto é antes de pedir credencial.
 *
 * O que a coluna mostra é só o que é verdade SEM identidade — `SinaisDoAmbiente`
 * explica por que runner e modelos locais não cabem aqui. E o formulário não
 * depende dela em nada: a coluna é irmã do card, com estado próprio, então
 * uma api fora do ar muda uma linha de texto ali e não atrasa nem esconde o
 * campo de e-mail.
 */
export function LoginPage({ onEntrar, irPara, erroOAuth }: LoginPageProps) {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(
    erroOAuth ? t('loginPage.oauthError') : null,
  );
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const r = await onEntrar(email, senha);
      if (r.ok) {
        irPara('/');
        return;
      }
      setErro(
        r.status === 403
          ? t('loginPage.errors.unverifiedEmail')
          : t('loginPage.errors.invalidCredentials'),
      );
    } catch {
      setErro(t('loginPage.errors.network'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AuthLayout
      titulo={t('loginPage.title')}
      subtitulo={t('loginPage.subtitle')}
      irPara={irPara}
      colunaDeIdentidade={
        <>
          <p className={styles.pitch}>{t('loginPage.identity.pitch')}</p>
          <SinaisDoAmbiente />
        </>
      }
      rodapeDoCartao={
        <>
          {t('loginPage.footer.noAccessPrompt')}{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => irPara('/registrar')}
          >
            {t('loginPage.footer.createAccount')}
          </button>
        </>
      }
      abaixoDoCartao={
        <Alert tone="warning">
          {t('loginPage.migrationNotice.prefix')}
          <strong>{t('loginPage.migrationNotice.strong')}</strong>
          {t('loginPage.migrationNotice.suffix')}
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
          label={t('loginPage.form.emailLabel')}
          type="email"
          placeholder={t('loginPage.form.emailPlaceholder')}
          autoComplete="username"
          required
          preenchido
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label={t('loginPage.form.passwordLabel')}
          type="password"
          placeholder="••••••••••"
          autoComplete="current-password"
          required
          preenchido
          revelavel
          mono
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          acaoNoLabel={
            <button
              type="button"
              className={`${styles.link} ${styles.linkPequeno}`}
              onClick={() => irPara('/esqueci-senha')}
            >
              {t('loginPage.form.forgotPassword')}
            </button>
          }
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth size="lg" loading={enviando}>
            {enviando ? t('loginPage.form.submitting') : t('loginPage.form.submit')}
          </Button>
        </div>

        <div className={styles.divisor}>
          <span className={styles.linhaDivisor} aria-hidden="true" />
          <span className={styles.textoDivisor}>{t('loginPage.form.divider')}</span>
          <span className={styles.linhaDivisor} aria-hidden="true" />
        </div>

        <div className={styles.botoesSociais}>
          <a
            className={styles.botaoSocial}
            href={`${runtimeConfig.apiUrl}/auth/oauth/github/start`}
          >
            <GitHubIcon size={17} />
            {t('loginPage.form.githubButton')}
          </a>
          <a
            className={styles.botaoSocial}
            href={`${runtimeConfig.apiUrl}/auth/oauth/gitlab/start`}
          >
            <GitLabIcon size={17} />
            {t('loginPage.form.gitlabButton')}
          </a>
        </div>
      </form>
    </AuthLayout>
  );
}
