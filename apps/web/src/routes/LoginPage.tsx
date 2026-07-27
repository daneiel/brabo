import { useState, type FormEvent } from 'react';
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
 * Login (Fase 7a — o corte).
 *
 * ## A mensagem de erro é sempre a mesma, de propósito
 *
 * A api devolve o MESMO 401 para e-mail inexistente, senha errada, conta
 * bloqueada por lockout e conta migrada que ainda não definiu senha (RN-032).
 * Se esta tela tentasse ser prestativa e traduzir cada caso, reintroduziria no
 * cliente o oráculo de enumeração que o servidor fecha — e não conseguiria,
 * porque a informação não chega aqui.
 *
 * O texto sobre "confira seu e-mail" é FIXO e aparece junto com o erro: ele
 * cobre o usuário migrado sem afirmar nada sobre a conta. É derivado de nenhum
 * sinal do servidor, então não vaza.
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
          : 'E-mail ou senha inválidos.',
      );
    } catch {
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AuthLayout titulo="Entrar">
      <form className={styles.form} onSubmit={submeter}>
        <Input
          label="E-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          error={erro}
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </Button>
        </div>
      </form>

      <div className={styles.rodape}>
        <button
          type="button"
          className={styles.link}
          onClick={() => irPara('/esqueci-senha')}
        >
          Esqueci minha senha
        </button>
        <button
          type="button"
          className={styles.link}
          onClick={() => irPara('/registrar')}
        >
          Criar uma conta
        </button>
        <span>
          Sua conta existia antes desta versão? Peça o link em “Esqueci minha
          senha” — a senha antiga não foi migrada.
        </span>
      </div>
    </AuthLayout>
  );
}
