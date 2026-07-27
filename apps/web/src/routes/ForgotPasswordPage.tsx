import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AuthLayout } from './AuthLayout';
import styles from './AuthLayout.module.css';

interface ForgotPasswordPageProps {
  onPedir: (email: string) => Promise<{ ok: boolean }>;
  irPara: (rota: string) => void;
}

/**
 * Pedido de redefinição (Fase 7a — o corte).
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
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <AuthLayout titulo="Confira seu e-mail">
        <p className={styles.aviso}>
          Se houver uma conta com <strong>{email}</strong>, enviamos um link
          para definir uma senha nova. Ele vale por tempo limitado.
        </p>
        <Button variant="secondary" fullWidth onClick={() => irPara('/login')}>
          Voltar para o login
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout titulo="Definir uma senha nova">
      <p className={styles.aviso}>
        Serve para quem esqueceu a senha e para quem já tinha conta antes desta
        versão — nesse caso, a senha antiga não foi migrada.
      </p>
      <form className={styles.form} onSubmit={submeter}>
        <Input
          label="E-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={erro}
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar link'}
          </Button>
        </div>
      </form>

      <div className={styles.rodape}>
        <button
          type="button"
          className={styles.link}
          onClick={() => irPara('/login')}
        >
          Voltar para o login
        </button>
      </div>
    </AuthLayout>
  );
}
