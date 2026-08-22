import { useEffect, useState } from 'react';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { AuthLayout } from './AuthLayout';

interface VerifyEmailPageProps {
  token: string | undefined;
  onVerificar: (token: string) => Promise<{ ok: boolean }>;
  irPara: (rota: string) => void;
}

type Estado = 'carregando' | 'sucesso' | 'erro';

/**
 * Confirmação de e-mail a partir do link (fecha a lacuna do backlog "SMTP
 * real no MailSender" — ver ADR 0096).
 *
 * Espelha `SetPasswordPage`: mesmo padrão de rota (token na query string,
 * `validateSearch` no `router.tsx`), mesma resposta única para link
 * inexistente/expirado/já usado — distinguir contaria a quem roubou o link
 * se a vítima chegou primeiro — e o mesmo desfecho de não logar ninguém, só
 * levar ao login. A diferença é que aqui não há formulário: não existe dado
 * nenhum para o usuário preencher, então a confirmação dispara sozinha ao
 * montar, e a tela é as três telas da RN-088 (carregando/erro/sucesso) em
 * vez de duas — sem elas, um `POST` que ainda não voltou pareceria uma tela
 * vazia.
 */
export function VerifyEmailPage({
  token,
  onVerificar,
  irPara,
}: VerifyEmailPageProps) {
  const [estado, setEstado] = useState<Estado>(token ? 'carregando' : 'erro');
  const [mensagemDeErro, setMensagemDeErro] = useState<string>(
    token ? '' : 'Link inválido: falta o código.',
  );

  useEffect(() => {
    if (!token) return;
    let cancelado = false;

    (async () => {
      try {
        const resultado = await onVerificar(token);
        if (cancelado) return;
        if (resultado.ok) {
          setEstado('sucesso');
          return;
        }
        // A api não distingue link inexistente, expirado e já usado — os
        // três têm a mesma resposta, mesmo motivo do SetPasswordPage.
        setMensagemDeErro('Link inválido, expirado ou já usado.');
        setEstado('erro');
      } catch {
        if (cancelado) return;
        setMensagemDeErro('Não foi possível falar com o servidor. Tente de novo.');
        setEstado('erro');
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [token, onVerificar]);

  if (estado === 'sucesso') {
    return (
      <AuthLayout
        titulo="E-mail verificado"
        subtitulo="Já pode entrar com a sua conta."
        irPara={irPara}
      >
        <Alert tone="success" role="status">
          Pronto. Seu e-mail foi confirmado.
        </Alert>
        <Button fullWidth onClick={() => irPara('/login')}>
          Ir para o login
        </Button>
      </AuthLayout>
    );
  }

  if (estado === 'erro') {
    return (
      <AuthLayout
        titulo="Confirmar e-mail"
        subtitulo="Não foi possível confirmar o e-mail por este link."
        irPara={irPara}
      >
        <Alert tone="danger" role="alert">
          {mensagemDeErro}
        </Alert>
        <Button fullWidth onClick={() => irPara('/login')}>
          Ir para o login
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      titulo="Confirmar e-mail"
      subtitulo="Só um instante."
      irPara={irPara}
    >
      <p role="status">Verificando…</p>
    </AuthLayout>
  );
}
