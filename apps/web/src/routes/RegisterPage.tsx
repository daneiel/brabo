import { useState, type FormEvent } from 'react';
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
 * Registro (Fase 7a — o corte).
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
 */
export function RegisterPage({ onRegistrar, irPara }: RegisterPageProps) {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);

    if (senha.length < MINIMO_DE_SENHA) {
      setErro(`A senha precisa de pelo menos ${MINIMO_DE_SENHA} caracteres.`);
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
          ? 'O cadastro está fechado nesta instalação.'
          : 'Não foi possível criar a conta. Confira os dados e tente de novo.',
      );
    } catch {
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <AuthLayout titulo="Confira seu e-mail">
        <p className={styles.aviso}>
          Se o endereço estiver disponível, enviamos um link de confirmação
          para <strong>{email}</strong>.
        </p>
        <Button variant="secondary" fullWidth onClick={() => irPara('/login')}>
          Voltar para o login
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout titulo="Criar conta">
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
          label="Nome"
          autoComplete="name"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          hint="Opcional."
        />
        <Input
          label="Senha"
          type="password"
          autoComplete="new-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          error={erro}
          hint={`Pelo menos ${MINIMO_DE_SENHA} caracteres. Uma frase longa vale mais que símbolos.`}
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth disabled={enviando}>
            {enviando ? 'Criando…' : 'Criar conta'}
          </Button>
        </div>
      </form>

      <div className={styles.rodape}>
        <button
          type="button"
          className={styles.link}
          onClick={() => irPara('/login')}
        >
          Já tenho conta
        </button>
      </div>
    </AuthLayout>
  );
}
