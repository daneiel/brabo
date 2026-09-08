import type { ContainerOverviewItem, Role } from '../lib/api-types';
import { roleAtLeast } from '../lib/roles';

/**
 * O tipo de `proposed_action` que SOBE o container deste projeto, ramificado
 * pelo `executionMode` (RN-521).
 *
 * A ramificação é a mesma do backend desde a RN-497/503: `container` e
 * `mounted` sobem pelo BROKER, no servidor; `runner` sobe pelo agente local,
 * na máquina do usuário. Os dois tipos NÃO são intercambiáveis, e o payload
 * também não — `container_start` carrega a ELEIÇÃO de imagem (imagem, rede,
 * recursos) e `container_start_via_runner` (RN-508) tem schema só com
 * `rationale`, porque ela sobe a imagem JÁ decidida e não elege nada.
 */
export type AcaoDeSubida = 'container_start' | 'container_start_via_runner';

/**
 * Por que a linha NÃO oferece o botão de subir. Cada motivo tem texto próprio
 * na tela: um botão desabilitado sem explicação é a tela sabendo por que e não
 * dizendo, e `title` em elemento `disabled` não abre no Chromium (ADR 0064).
 */
export type MotivoDeBloqueio =
  /** Já está `running`/`provisioning` — subir não é a próxima ação. */
  | 'ja_esta_de_pe'
  /**
   * Nenhum `artifact.project_image` decidido. O portão da RN-105 vale nos TRÊS
   * modos desde a RN-494/ADR 0135: sem imagem não há o que subir, e propor
   * seria abrir uma decisão que já se sabe que termina em falha.
   */
  | 'sem_imagem_decidida'
  /**
   * Projeto `runner` cujo `workspaceVerifiedAt` é nulo: nenhum agente local
   * jamais conectou, então `container_start_via_runner` falharia com certeza
   * (`RunnerNaoConectadoError`). Mesma honestidade que a tool do Infra Lead já
   * pratica ao recusar LOCALMENTE antes de propor (RN-508).
   */
  | 'runner_nunca_confirmou'
  /** O papel do chamador não alcança o mínimo do ENDPOINT (`maintainer`, RN-102). */
  | 'sem_papel'
  /** Sem sessão no projeto — toda `proposed_action` nasce dentro de uma. */
  | 'sem_sessao';

/**
 * O que a tela ainda NÃO consegue afirmar quando oferece a subida. Nunca
 * bloqueia — só acompanha o botão em texto.
 */
export type RessalvaDeSubida =
  /**
   * `workspaceVerifiedAt` é registro de UMA confirmação e nunca batimento
   * (RN-468): o runner pode ter sido desligado depois. A api não tem sinal de
   * presença — quem sabe do AGORA é o canal Phoenix, no engine —, então a tela
   * DIZ que não sabe em vez de prometer que sabe.
   */
  'runner_pode_estar_desconectado';

export type DecisaoDeSubida =
  | { pode: true; acao: AcaoDeSubida; ressalva: RessalvaDeSubida | null }
  | { pode: false; motivo: MotivoDeBloqueio };

/**
 * Um projeto `runner` sobe pelo agente local; `container` e `mounted` sobem
 * pelo broker. Exportado à parte porque a tela usa o mesmo mapeamento para
 * NOMEAR a ação no texto do botão.
 */
export function acaoDeSubidaDoModo(
  executionMode: ContainerOverviewItem['executionMode'],
): AcaoDeSubida {
  return executionMode === 'runner'
    ? 'container_start_via_runner'
    : 'container_start';
}

/**
 * A tela pode oferecer "subir o container" nesta linha? (RN-521)
 *
 * Pura de propósito: é a regra inteira num lugar só, testável sem montar a
 * página. Ela NÃO é fronteira de segurança nenhuma — quem recusa por papel é o
 * `RolesGuard`, quem recusa por imagem é `ReadProjectCodeUseCase`/o broker, e
 * quem recusa por runner ausente é o engine. O que ela faz é a tela parar de
 * propor o que já se sabe que vai falhar, e DIZER o motivo no lugar do botão.
 *
 * A ordem dos motivos é deliberada: primeiro o estado do MUNDO (já está de pé,
 * falta imagem, nunca houve runner), que vale para qualquer pessoa que olhe a
 * tela, e só depois a capacidade de QUEM olha (papel, sessão). Assim um
 * `viewer` ainda lê "falta decidir a imagem" em vez de só "você não pode".
 */
export function decidirSubida(input: {
  item: ContainerOverviewItem;
  papel: Role | null | undefined;
  temSessao: boolean;
}): DecisaoDeSubida {
  const { item, papel, temSessao } = input;
  const status = item.registrado?.status ?? null;

  if (status === 'running' || status === 'provisioning') {
    return { pode: false, motivo: 'ja_esta_de_pe' };
  }
  if (!item.temImagemDecidida) {
    return { pode: false, motivo: 'sem_imagem_decidida' };
  }
  if (item.executionMode === 'runner' && !item.workspaceVerifiedAt) {
    return { pode: false, motivo: 'runner_nunca_confirmou' };
  }
  // O mínimo é o do ENDPOINT (`decide.ts`: `container_start` e
  // `container_start_via_runner` são ambos `maintainer`), nunca o da tela, e a
  // comparação sai de `roleAtLeast` — nunca de uma lista de papéis à mão
  // (RN-102). Papel ausente não alcança nada.
  if (!roleAtLeast(papel, 'maintainer')) {
    return { pode: false, motivo: 'sem_papel' };
  }
  if (!temSessao) {
    return { pode: false, motivo: 'sem_sessao' };
  }

  return {
    pode: true,
    acao: acaoDeSubidaDoModo(item.executionMode),
    ressalva:
      item.executionMode === 'runner' ? 'runner_pode_estar_desconectado' : null,
  };
}

/**
 * Parar e remover têm régua PRÓPRIA — só o papel, porque elas não dependem de
 * imagem decidida nem de runner algum ter confirmado pasta; dependem de haver
 * um container REGISTRADO para parar/remover. Mesmo mínimo de endpoint
 * (`maintainer`), mesma fonte de comparação.
 */
export function podeDecidirCicloDeVida(papel: Role | null | undefined): boolean {
  return roleAtLeast(papel, 'maintainer');
}
