/*
 * Previews do CredentialStep — o passo do wizard que escolhe ou registra o
 * token de git. `credentials` são só METADADOS (id, provider, datas): o token
 * em si nunca chega ao browser, o que é o ponto do envelope encryption.
 *
 * Duas coisas que só se descobrem lendo o componente:
 *
 * 1. `error` e `registering` renderizam DENTRO do formulário de novo token, e
 *    ele começa fechado sempre que já existe alguma credencial (`adding` é
 *    inicializado com `credentials.length === 0`). Sem abrir o formulário, as
 *    duas props não produzem saída visível nenhuma — as células ficariam
 *    idênticas à normal. Por isso o `FormularioAberto` clica no "Adicionar
 *    novo token" depois do mount.
 * 2. A linha de cada credencial mostra `desde {formatRelativeTime(createdAt)}`,
 *    que compara com Date.now(). Data fixa faria o rótulo derivar com o tempo,
 *    então os createdAt abaixo são offsets a partir de agora.
 */
import { useEffect, useRef } from 'react';
import { CredentialStep } from 'web';

type Credenciais = Parameters<typeof CredentialStep>[0]['credentials'];

const noop = () => {};

const diasAtras = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const doGitHub = [
  { id: 'cred-1', provider: 'github', createdAt: diasAtras(54), updatedAt: diasAtras(6) },
  { id: 'cred-2', provider: 'github', createdAt: diasAtras(8), updatedAt: diasAtras(8) },
] as Credenciais;

function FormularioAberto({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const botoes = Array.from(ref.current?.querySelectorAll('button') ?? []);
    botoes.find((b) => b.textContent?.includes('Adicionar novo token'))?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** Com tokens já registrados, um selecionado — o formulário fica fechado. */
export function ComTokensRegistrados() {
  return (
    <CredentialStep
      provider="github"
      credentials={doGitHub}
      selectedId="cred-1"
      onSelect={noop}
      onRegister={noop}
      registering={false}
      error=""
    />
  );
}

/** Nenhum token ainda: o formulário já nasce aberto neste caso. */
export function SemNenhumToken() {
  return (
    <CredentialStep
      provider="gitlab"
      credentials={[] as Credenciais}
      selectedId=""
      onSelect={noop}
      onRegister={noop}
      registering={false}
      error=""
    />
  );
}

/** Registrando: o botão vira "Testando…" enquanto o token é validado de verdade. */
export function Registrando() {
  return (
    <FormularioAberto>
      <CredentialStep
        provider="github"
        credentials={doGitHub}
        selectedId="cred-2"
        onSelect={noop}
        onRegister={noop}
        registering
        error=""
      />
    </FormularioAberto>
  );
}

/** Erro do provider — a mensagem tem que dizer o que fazer, não só falhar. */
export function ComErro() {
  return (
    <FormularioAberto>
      <CredentialStep
        provider="github"
        credentials={doGitHub}
        selectedId="cred-1"
        onSelect={noop}
        onRegister={noop}
        registering={false}
        error="O token não tem o escopo `repo`. Gere um novo com permissão de administração no repositório."
      />
    </FormularioAberto>
  );
}
