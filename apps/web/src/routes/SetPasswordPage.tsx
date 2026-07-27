import { useState, type FormEvent } from 'react';
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
 * Definir senha a partir do link (Fase 7a — o corte).
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
 */
export function SetPasswordPage({
  token,
  onDefinir,
  irPara,
}: SetPasswordPageProps) {
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  async function submeter(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);

    if (!token) {
      setErro('Link inválido: falta o código. Peça um novo.');
      return;
    }
    if (senha.length < MINIMO_DE_SENHA) {
      setErro(`A senha precisa de pelo menos ${MINIMO_DE_SENHA} caracteres.`);
      return;
    }
    if (senha !== confirmacao) {
      setErro('As duas senhas não são iguais.');
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
      setErro(
        'Link inválido, expirado ou já usado. Peça um novo em “Esqueci minha senha”.',
      );
    } catch {
      setErro('Não foi possível falar com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  if (pronto) {
    return (
      <AuthLayout titulo="Senha definida">
        <p className={styles.aviso}>
          Pronto. Todas as sessões anteriores foram encerradas — entre de novo
          com a senha nova.
        </p>
        <Button fullWidth onClick={() => irPara('/login')}>
          Ir para o login
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout titulo="Definir senha">
      <form className={styles.form} onSubmit={submeter}>
        <Input
          label="Senha nova"
          type="password"
          autoComplete="new-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          hint={`Pelo menos ${MINIMO_DE_SENHA} caracteres. Uma frase longa vale mais que símbolos.`}
        />
        <Input
          label="Repita a senha"
          type="password"
          autoComplete="new-password"
          required
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          error={erro}
        />
        <div className={styles.acoes}>
          <Button type="submit" fullWidth disabled={enviando}>
            {enviando ? 'Definindo…' : 'Definir senha'}
          </Button>
        </div>
      </form>

      <div className={styles.rodape}>
        <button
          type="button"
          className={styles.link}
          onClick={() => irPara('/esqueci-senha')}
        >
          Pedir outro link
        </button>
      </div>
    </AuthLayout>
  );
}
