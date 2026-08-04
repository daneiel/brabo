/*
 * Previews do Alert. O conteúdo sai do uso real: AdoptionPlanPage (o aviso de
 * dry-run) e ForgotPasswordPage (sucesso, aviso e erro).
 */
import { Alert } from 'web';

const coluna: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 560,
};

/** Os quatro tons — o eixo que mais muda a aparência. Cada um traz seu ícone. */
export function Tons() {
  return (
    <div style={coluna}>
      <Alert tone="accent">
        Nada foi alterado no repositório. Isto é o que o bootstrap{' '}
        <strong>faria</strong> — nenhuma proteção existente é sobrescrita sem a
        sua aprovação.
      </Alert>
      <Alert tone="success">
        Plano aplicado. As branches permanentes existem e estão protegidas.
      </Alert>
      <Alert tone="warning">
        Serve também para quem já tinha conta antes desta versão — nesse caso,{' '}
        <strong>a senha antiga não foi migrada</strong>.
      </Alert>
      <Alert tone="danger">
        teste de conexão falhou para openrouter: o provider respondeu 401.
      </Alert>
    </div>
  );
}

/**
 * O `role` é escolha, não consequência do tom (ADR 0036): `alert` interrompe o
 * leitor de tela, `status` espera a pausa. Visualmente idênticos — a diferença
 * é inteiramente para quem navega por leitor.
 */
export function PapelDeAcessibilidade() {
  return (
    <div style={coluna}>
      <Alert tone="danger" role="alert">
        Não foi possível salvar a credencial. Nada foi gravado.
      </Alert>
      <Alert tone="success" role="status">
        Se houver uma conta com <strong>voce@empresa.com</strong>, enviamos um
        link para definir uma senha nova.
      </Alert>
    </div>
  );
}
