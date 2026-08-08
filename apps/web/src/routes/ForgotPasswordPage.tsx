import { useState, type FormEvent } from 'react';
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
      <AuthLayout
        titulo="Confira seu e-mail"
        subtitulo="O link vale por tempo limitado e só pode ser usado uma vez."
        irPara={irPara}
      >
        <Alert tone="success" role="status">
          Se houver uma conta com <strong>{email}</strong>, enviamos um link para
          definir uma senha nova.
        </Alert>
        <Button variant="secondary" fullWidth onClick={() => irPara('/login')}>
          Voltar para o login
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      titulo="Definir uma senha nova"
      subtitulo="Informe seu e-mail e enviamos um link para criar a senha."
      irPara={irPara}
      rodapeDoCartao={
        <>
          Lembrou a senha?{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => irPara('/login')}
          >
            Voltar para o login
          </button>
        </>
      }
      abaixoDoCartao={
        <Alert tone="warning">
          Serve também para quem já tinha conta antes desta versão — nesse caso,{' '}
          <strong>a senha antiga não foi migrada</strong> e este é o caminho para
          criar a primeira.
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
        <div className={styles.acoes}>
          <Button type="submit" fullWidth size="lg" loading={enviando}>
            {enviando ? 'Enviando…' : 'Enviar link'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
