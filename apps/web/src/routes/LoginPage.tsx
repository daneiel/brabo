import { useState, type FormEvent } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import styles from './AuthLayout.module.css';

interface LoginPageProps {
  onEntrar: (
    email: string,
    senha: string,
  ) => Promise<{ ok: true } | { ok: false; status: number }>;
  irPara: (rota: string) => void;
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
 */
export function LoginPage({ onEntrar, irPara }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
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
          ? 'Confirme seu e-mail antes de entrar. Procure a mensagem de verificação.'
          : 'E-mail ou senha incorretos.',
      );
    } catch {
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AuthLayout
      titulo="Entrar"
      subtitulo="Acesse seu workspace e retome as sessões em andamento."
      irPara={irPara}
      rodapeDoCartao={
        <>
          Não tem acesso?{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => irPara('/registrar')}
          >
            Criar uma conta
          </button>
        </>
      }
      abaixoDoCartao={
        <Alert tone="warning">
          Sua conta existia antes desta versão? Peça o link em{' '}
          <strong>Esqueci minha senha</strong> — a senha antiga não foi migrada.
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
          label="E-mail"
          type="email"
          placeholder="voce@empresa.com"
          autoComplete="username"
          required
          preenchido
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Senha"
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
              Esqueci minha senha
            </button>
          }
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth size="lg" loading={enviando}>
            {enviando ? 'Autenticando…' : 'Entrar'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
