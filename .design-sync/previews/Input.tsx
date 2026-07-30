/*
 * Previews do Input. `mono` é o campo que recebe token, comando ou branch —
 * onde caractere errado importa; `icon` é o slot do adorno à esquerda.
 */
import { Input, SearchIcon, LockIcon, BranchIcon } from 'web';

const coluna: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  maxWidth: 380,
};

/** O campo padrão, com placeholder e valor. */
export function Padrao() {
  return (
    <div style={coluna}>
      <Input placeholder="Nome do projeto" />
      <Input defaultValue="plataforma-de-pagamentos" />
    </div>
  );
}

/** `icon` recebe qualquer nó — na app é sempre um ícone do set. */
export function ComIcone() {
  return (
    <div style={coluna}>
      <Input icon={<SearchIcon size={14} />} placeholder="Buscar sessão" />
      <Input icon={<BranchIcon size={14} />} defaultValue="feature/dev-backend/oban-metrics" />
    </div>
  );
}

/** `mono` para segredo, comando e SHA: alinhamento por caractere. */
export function Monoespacado() {
  return (
    <div style={coluna}>
      <Input mono icon={<LockIcon size={14} />} type="password" defaultValue="ghp_R2d4x8Kq1mN7vB3c" />
      <Input mono defaultValue="git push origin feature/*" />
    </div>
  );
}

/**
 * `label`, `hint` e `error` — a forma que as telas de auth usam. Com qualquer
 * um dos três o componente passa a desenhar o bloco inteiro do campo.
 */
export function ComRotulo() {
  return (
    <div style={coluna}>
      <Input label="E-mail" type="email" autoComplete="username" defaultValue="daniel@brabo.dev" />
      <Input
        label="Senha nova"
        type="password"
        autoComplete="new-password"
        defaultValue="cavalo-bateria-grampo-correto"
        hint="Pelo menos 12 caracteres. Uma frase longa vale mais que símbolos."
      />
      <Input
        label="Repita a senha"
        type="password"
        autoComplete="new-password"
        defaultValue="cavalo-bateria-grampo"
        error="As senhas não conferem."
      />
    </div>
  );
}

/** Desabilitado e somente-leitura chegam por spread nos atributos de input. */
export function Bloqueado() {
  return (
    <div style={coluna}>
      <Input placeholder="Aguardando provisionamento" disabled />
      <Input mono defaultValue="01JEVHYP000000000000A1B2C3" readOnly />
    </div>
  );
}
