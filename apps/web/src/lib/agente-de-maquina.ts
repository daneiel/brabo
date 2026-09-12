import type { Role, RunnerDeviceKeyListItem } from './api-types';
import { roleAtLeast } from './roles';

/**
 * A tela reconhece um agente local de MÁQUINA já pareado (RN-548, ADR 0154).
 *
 * ## O que esta derivação responde, e o que ela NUNCA responde
 *
 * Ela responde **"esta conta já pareou alguma máquina?"**, lendo
 * `GET /projects/:projectId/runner-device-keys` — a listagem da
 * [RN-519](../../../../docs/business-rules.md#rn-519), que desde a
 * [RN-543](../../../../docs/business-rules.md#rn-543) marca a ESPÉCIE de cada
 * chave (`projeto` | `maquina`). A marca existe por causa desta tela: sem ela,
 * uma chave de máquina seria invisível aqui.
 *
 * Ela NUNCA responde "o agente está rodando agora". É a mesma disciplina que
 * `workspaceVerifiedAt` já impõe em `AmbienteDoProjeto` e na `EsperaDoRunner`
 * ([RN-468](../../../../docs/business-rules.md#rn-468)): o carimbo é registro
 * de uma confirmação, não batimento. Uma chave registrada prova que a máquina
 * foi pareada um dia; quem sabe do AGORA é o canal do terminal. Uma tela que
 * confundisse as duas coisas seria PIOR que a de hoje, porque a de hoje ao
 * menos não mente.
 *
 * E há um segundo limite, que o dado impõe e nenhuma redação apaga: a lista é
 * da CONTA, não deste navegador. `runner_device_keys` não sabe de que máquina
 * o navegador está falando — então o mais forte que a tela pode afirmar é
 * *"sua conta tem uma máquina pareada"*, nunca *"esta máquina está pareada"*.
 * Por isso o caminho do [ADR 0118](../../../../docs/adr/0118-configuracao-do-runner-pelo-navegador.md)
 * continua alcançável em TODOS os estados: ele é o que resolve exatamente o
 * caso de estar numa segunda máquina.
 *
 * ## Sete estados, e nenhum vira o outro (RN-088/RN-470)
 *
 * `semPapel` (não perguntamos), `verificando` (perguntamos e não voltou),
 * `naoSei` (a pergunta falhou), `semChaveDeMaquina` (voltou e não há),
 * `revogada` (houve e foi revogada), `pareadaNuncaUsada` (há chave ativa que
 * agente nenhum usou — a órfã da RN-519, na espécie nova) e `pareada`.
 *
 * "Não sei" nunca vira "não tem", e os dois vazios — nunca houve chave / houve
 * e foi revogada — têm textos diferentes porque o gesto é diferente: um pede
 * parear, o outro explica por que o agente parou de conectar.
 */
export type ReconhecimentoDeAgenteDeMaquina =
  | { estado: 'semPapel' }
  | { estado: 'verificando' }
  | { estado: 'naoSei' }
  | { estado: 'semChaveDeMaquina' }
  | { estado: 'revogada'; nomes: string[] }
  | { estado: 'pareadaNuncaUsada'; nomes: string[] }
  | { estado: 'pareada'; nomes: string[]; ultimoUso: string };

/**
 * O mínimo do ENDPOINT, nunca o da seção vizinha
 * ([RN-102](../../../../docs/business-rules/custo.md#rn-102)):
 * `RunnerDeviceKeysController` exige `developer` nas TRÊS rotas.
 */
export const PAPEL_MINIMO_PARA_LER_CHAVES: Role = 'developer';

/**
 * A tela pergunta? — `roleAtLeast` e nunca uma lista de papéis à mão. Papel
 * AUSENTE não alcança nada, e aqui isso é o certo: pedir uma listagem que a
 * api vai recusar transformaria um 403 previsível em "não sei", que é o pior
 * dos dois textos (ignorância inventada no lugar de um motivo conhecido).
 *
 * **Isto não é fronteira de segurança** — quem recusa é o `RolesGuard`, e
 * continua recusando. É a tela parando de perguntar o que a api vai negar.
 */
export function podeLerChavesDeDispositivo(papel: Role | null | undefined): boolean {
  return roleAtLeast(papel, PAPEL_MINIMO_PARA_LER_CHAVES);
}

export interface EntradaDoReconhecimento {
  /**
   * Papel efetivo de quem está olhando. **Limite declarado, e é o MESMO de
   * `ModelsSection`/`AreaModelsSection`:** o web lê aqui o papel de
   * WORKSPACE, e quem autoriza do outro lado é o papel EFETIVO do PROJETO
   * (`projectRole ?? workspaceRole`,
   * [RN-471](../../../../docs/business-rules.md#rn-471)) — uma SOBREPOSIÇÃO
   * nos dois sentidos. Por isso o 403 de verdade também é tratado abaixo: a
   * api é a autoridade, o papel de workspace é só o proxy que evita a
   * pergunta obviamente perdida.
   */
  papel: Role | null | undefined;
  /** A listagem, quando já voltou. */
  chaves: RunnerDeviceKeyListItem[] | undefined;
  /** A consulta está em voo (ou nem começou, por `enabled`). */
  carregando: boolean;
  /**
   * A consulta FALHOU — e é este campo, não o status, que decide. Erro de
   * rede não tem status nenhum, e derivar a falha de `statusDoErro != null`
   * deixaria um `TypeError: fetch failed` cair em `verificando` para sempre:
   * uma tela girando em "verificando…" é mentira por omissão depois de dez
   * segundos, e o certo ali é dizer que não sabe.
   */
  falhou?: boolean;
  /**
   * `status` HTTP do erro, quando houve um. `403` vira `semPapel` — a api
   * dizendo o que o proxy de papel não sabia; qualquer outra falha vira
   * `naoSei`.
   */
  statusDoErro?: number | null;
}

export function reconhecerAgenteDeMaquina(
  entrada: EntradaDoReconhecimento,
): ReconhecimentoDeAgenteDeMaquina {
  if (!podeLerChavesDeDispositivo(entrada.papel)) return { estado: 'semPapel' };
  if (entrada.falhou) {
    return entrada.statusDoErro === 403
      ? { estado: 'semPapel' }
      : { estado: 'naoSei' };
  }
  if (entrada.carregando || entrada.chaves === undefined) return { estado: 'verificando' };

  // Só a espécie NOVA: uma chave de PROJETO ativa também significa que alguém
  // já pareou algo, mas dizer isso aqui seria responder outra pergunta com o
  // mesmo texto. O painel do ADR 0118 é o dono daquele caso, e continua sendo.
  const deMaquina = entrada.chaves.filter((chave) => chave.especie === 'maquina');
  if (deMaquina.length === 0) return { estado: 'semChaveDeMaquina' };

  const ativas = deMaquina.filter((chave) => chave.revokedAt === null);
  if (ativas.length === 0) {
    return { estado: 'revogada', nomes: nomesDe(deMaquina) };
  }

  // O mais RECENTE entre as ativas: com N chaves de máquina (duas contas na
  // mesma máquina, ou duas máquinas), a data que interessa é a última vez em
  // que ALGUM agente usou ALGUMA delas. Somar ou mostrar a mais velha diria
  // menos do que se sabe.
  const usos = ativas
    .map((chave) => chave.lastUsedAt)
    .filter((quando): quando is string => quando !== null);
  if (usos.length === 0) {
    return { estado: 'pareadaNuncaUsada', nomes: nomesDe(ativas) };
  }

  const ultimoUso = usos.reduce((maior, atual) =>
    Date.parse(atual) > Date.parse(maior) ? atual : maior,
  );
  return { estado: 'pareada', nomes: nomesDe(ativas), ultimoUso };
}

/**
 * Sem teto e sem "…e mais N": a lista não é truncada, então não há recorte a
 * declarar ([RN-180](../../../../docs/business-rules.md#rn-180)). Se um dia
 * ela precisar de teto, o teto vem com a frase que o anuncia.
 */
function nomesDe(chaves: RunnerDeviceKeyListItem[]): string[] {
  return chaves.map((chave) => chave.name);
}

/** Os dois estados em que a tela para de mandar parear. */
export function maquinaJaPareada(
  reconhecimento: ReconhecimentoDeAgenteDeMaquina,
): boolean {
  return (
    reconhecimento.estado === 'pareada' ||
    reconhecimento.estado === 'pareadaNuncaUsada'
  );
}
