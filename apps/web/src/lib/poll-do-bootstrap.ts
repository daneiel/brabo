import type { ProvisioningStatus } from './api-types';
import { pollQueParaNoErro } from './query-policy';

/**
 * O ritmo do acompanhamento do bootstrap do repositório (AT-302), nas duas
 * telas que o mostram ao vivo — o provisionamento e o plano de adoção.
 *
 * Era 1 s nas duas, para o status E para os eventos da sessão técnica: duas
 * buscas por segundo, 120/min, e sem parada nenhuma nos eventos — a tela de um
 * repositório já provisionado continuava pollando enquanto aberta, contra o
 * teto de 300/min do USUÁRIO (RN-579). O provisionamento leva dezenas de
 * segundos por passo; 3 s é a mesma resolução que o usuário percebe.
 */
export const INTERVALO_DO_BOOTSTRAP_MS = 3000;

interface QueryDoBootstrap {
  state: {
    status: 'pending' | 'error' | 'success';
    data?: { status: ProvisioningStatus | null } | null;
  };
}

/**
 * O `refetchInterval` do status do bootstrap.
 *
 * Para em TRÊS casos: a query errou (`pollQueParaNoErro` — quem insiste é o
 * foco da janela ou o botão, nunca o timer), o bootstrap convergiu
 * (`provisioned`), ou, quando `paraNaFalha`, ele falhou (`provision_failed`).
 * A falha é terminal só onde nada a retoma sozinho: na tela de
 * provisionamento o "Tentar novamente" dispara um bootstrap novo e a tela
 * precisa VER o progresso dele, então lá ela continua acompanhando.
 */
export function pollDoBootstrap({
  paraNaFalha,
}: {
  paraNaFalha: boolean;
}): (query: QueryDoBootstrap) => number | false {
  const seNaoErrou = pollQueParaNoErro(INTERVALO_DO_BOOTSTRAP_MS);
  return (query) => {
    const status = query.state.data?.status ?? null;
    if (bootstrapTerminou(status, { paraNaFalha })) return false;
    return seNaoErrou(query);
  };
}

/** O bootstrap chegou a um fim — é também quando os eventos param de pollar. */
export function bootstrapTerminou(
  status: ProvisioningStatus | null | undefined,
  { paraNaFalha }: { paraNaFalha: boolean },
): boolean {
  return status === 'provisioned' || (paraNaFalha && status === 'provision_failed');
}
