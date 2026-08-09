/**
 * Como uma sessão se chama na tela.
 *
 * O defeito que isto fecha é de DUPLICAÇÃO, não de aparência: `id.slice(0, 8)`
 * estava escrito inline em cinco lugares (`SessionPage` três vezes,
 * `ProjectSessionsTab` e `ProjectInsightsTab`), sem helper nenhum — enquanto o
 * equivalente de projeto já morava em `project-label.ts`. Cinco cópias da mesma
 * regra de truncagem significam que mudar a forma do rótulo é mudar cinco
 * arquivos, e que basta esquecer um para a mesma sessão aparecer com dois
 * rótulos diferentes em duas telas.
 *
 * A porta para o NOME AMIGÁVEL foi aberta aqui pela FASE 16 (`rotuloDaSessao`
 * aceita um nome opcional e degrada para a hashtag sozinha quando não há), e a
 * FASE 20 a atravessou: `sessions.name` existe no banco (RN-098) e chega ao
 * `Session` do `api-types`. A aposta de centralizar antes se confirmou — a
 * composição já estava escrita e testada aqui, e a fase do nome só teve de
 * PASSAR o campo nas telas em que ele aparece, sem tocar na regra.
 *
 * O que NÃO mudou, e é o ponto da RN-098: a hashtag nunca sai. Um nome
 * escolhido por pessoa não é único e não se cola numa URL.
 */

/** Quantos caracteres do uuid entram no rótulo. */
const CARACTERES = 8;

/**
 * Teto do nome amigável, em caracteres.
 *
 * Quem RECUSA é a api (`LIMITE_NOME_DA_SESSAO` no DTO): aqui o número serve
 * para o campo parar de aceitar antes de o servidor dizer não — digitar 200
 * caracteres e levar 400 no fim é pior que não caber. Vive num lugar só no
 * web pelo motivo de sempre: dois `maxLength={80}` inline divergem no dia em
 * que o teto mudar.
 */
export const LIMITE_DO_NOME = 80;

/**
 * O prefixo cru do id, sem cerquilha.
 *
 * Existe separado da hashtag porque a faixa de análises dos Insights escreve
 * `sessão a1b2c3d4` — sem `#`, ao contrário das outras quatro. Uniformizar
 * seria mudança visível, e esta entrega não muda o que se vê; o que importa é
 * a regra de truncagem viver num lugar só.
 */
export function idCurtoDaSessao(sessionId: string): string {
  return sessionId.slice(0, CARACTERES);
}

/** `#a1b2c3d4` — a forma curta que o produto usa para APONTAR uma sessão. */
export function hashtagDaSessao(sessionId: string): string {
  return `#${idCurtoDaSessao(sessionId)}`;
}

/**
 * O rótulo composto: `<nome> · #a1b2c3d4`, ou só a hashtag quando não há nome.
 *
 * A hashtag NUNCA some — é ela que se cola numa URL ou num comando, e um nome
 * escolhido pela pessoa não é único. Nome em branco (ou só espaço) conta como
 * ausente: um rótulo `" · #a1b2c3d4"` seria pior que a hashtag sozinha.
 */
export function rotuloDaSessao(sessionId: string, nome?: string | null): string {
  const hashtag = hashtagDaSessao(sessionId);
  const limpo = nome?.trim();
  return limpo ? `${limpo} · ${hashtag}` : hashtag;
}
