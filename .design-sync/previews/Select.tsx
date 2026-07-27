/*
 * Previews do Select. O componente é um <select> nativo estilizado — as opções
 * são children, e o valor é controlado por quem usa (aqui, defaultValue, para
 * o card não precisar de estado).
 */
import { Select } from 'web';

const coluna: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  maxWidth: 320,
};

/** O filtro de agente do feed de atividade — o uso mais comum. */
export function FiltroDeAgente() {
  return (
    <div style={coluna}>
      <Select defaultValue="">
        <option value="">Todos os agentes</option>
        <option value="dev-backend">Dev Backend</option>
        <option value="dev-frontend">Dev Frontend</option>
        <option value="qa">QA</option>
        <option value="secops">SecOps</option>
      </Select>
    </div>
  );
}

/** Com um valor escolhido, e com grupos — o seletor de escopo de modelo. */
export function ComEscolhaEGrupos() {
  return (
    <div style={coluna}>
      <Select defaultValue="project">
        <option value="workspace">Workspace</option>
        <option value="project">Projeto</option>
        <option value="agent">Agente</option>
        <option value="session">Sessão</option>
      </Select>
      <Select defaultValue="llama3.1:8b">
        <optgroup label="Local">
          <option value="llama3.1:8b">llama3.1:8b</option>
          <option value="qwen2.5-coder:14b">qwen2.5-coder:14b</option>
        </optgroup>
        <optgroup label="Nuvem">
          <option value="claude-opus-5">claude-opus-5</option>
        </optgroup>
      </Select>
    </div>
  );
}

/** Desabilitado: o escopo que o RBAC do projeto não deixa o usuário mudar. */
export function Desabilitado() {
  return (
    <div style={coluna}>
      <Select defaultValue="workspace" disabled>
        <option value="workspace">Workspace</option>
      </Select>
    </div>
  );
}
