/**
 * Os tipos de ação para os quais a api NUNCA grava o padrão de "Sempre
 * permitir" (AT-320, RN-642) — a tela não oferece o botão para eles, porque o
 * clique seria recusado com 400.
 *
 * A FONTE é `TIPOS_SEM_SEMPRE_PERMITIR` em
 * `apps/api/src/domain/actions/sempre-permitir.ts`; esta é a cópia que o web
 * consegue importar, e `sempre-permitir.test.ts` a confere contra aquele
 * arquivo — tipo novo lá sem vir para cá reprova. Não edite uma sem a outra.
 *
 * Comando de TERMINAL (`git push` digitado, `sudo`) não entra aqui: a api o
 * julga pelo que o comando faz, e repetir esse parser na tela seria uma
 * segunda régua. Ali o botão continua, e a recusa da api chega com o motivo.
 */
export const TIPOS_SEM_SEMPRE_PERMITIR: readonly string[] = [
  'git_push',
  'pr_open',
  'git_merge',
  'container_remove',
  'instruction_patch',
  'parallelize',
  'raise_max_parallel',
];

export function podeOferecerSemprePermitir(actionType: string): boolean {
  return !TIPOS_SEM_SEMPRE_PERMITIR.includes(actionType);
}
