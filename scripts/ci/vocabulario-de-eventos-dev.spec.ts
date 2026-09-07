import { describe, expect, it } from 'vitest';
import { ler, tiposEmitidosPor } from '../docs/fontes.mjs';

/**
 * O vocabulário `dev.*` do ENGINE contra a lista que a API consulta.
 *
 * Por que este teste existe: `GetSessionPendingWorkUseCase` é o que impede o
 * heartbeat de 30s de fechar uma sessão com trabalho pendurado, e o QUARTO
 * sinal dele (RN-411) enxerga dev agents só pelos tipos listados em
 * `DEV_EVENT_TYPES`. Quando o engine ganhou `dev.blocked_by_container`
 * (RN-502/ADR 0143) a lista não acompanhou, e o evento ficou INVISÍVEL — a
 * api não o via nem para ignorá-lo. Numa execução real (`exp004`, sessão
 * `f782257e`) cinco dev agents subiram bloqueados por container às 22:41:38 e
 * o engine fechou a sessão às 22:42:07, 30 segundos cravados; eventos
 * continuaram chegando naquela sessão 13 e 32 minutos depois.
 *
 * O comentário da lista dizia "vocabulário completo… confirmado por leitura
 * direta do código do engine". Estava certo quando foi escrito — e é
 * exatamente esse tipo de afirmação que envelhece calada. Este teste é o que
 * a mantém verdadeira.
 *
 * Por que COMPARAR e não GERAR (o precedente de `agent-areas.ts`): das duas
 * listas, só UMA é derivável do engine. `DEV_EVENT_TYPES` é mecânica ("todo
 * tipo `dev.*` que existe"), mas `DEV_PENDING_TYPES` é JULGAMENTO — quais
 * desses estados significam "um humano precisa agir". `dev.idle` e
 * `dev.started` estão deliberadamente fora dela. Um gerador só poderia
 * escrever metade do par e teria de deixar a outra em branco, ou pior,
 * adivinhar. Comparar reprova, nomeia o tipo que falta e obriga um humano a
 * decidir a metade que é decisão — sem acrescentar passo de build nenhum.
 *
 * Por que ele vive aqui e não na suíte da api: ele lê `apps/engine/lib/**` e
 * `apps/api/src/**` como TEXTO, atravessando dois apps. `scripts/ci/` é onde
 * moram os testes que leem o repositório inteiro, e roda no CI
 * (`pnpm --filter @brabo/scripts test`, job `test-packages`). Ele reusa o
 * MESMO extrator do inventário de eventos de `docs/reference/events.md`
 * (`scripts/docs/fontes.mjs`) — um terceiro regex respondendo "o que o engine
 * emite?" seria a mesma classe de defeito que este teste pega.
 */

const CAMINHO_DO_CASO_DE_USO =
  'apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts';

/**
 * As strings de um array/Set literal declarado com `const <nome> = ` no
 * arquivo do caso de uso. Deliberadamente simples: a lista é literal por
 * construção (é o que a torna auditável), e se um dia deixar de ser, a
 * extração falha ALTO em vez de devolver uma lista curta em silêncio.
 */
function listaLiteral(fonte: string, nome: string): string[] {
  const inicio = fonte.indexOf(`const ${nome} = `);
  if (inicio === -1) {
    throw new Error(
      `${CAMINHO_DO_CASO_DE_USO}: não achei \`const ${nome} = \`. ` +
        'Se a constante mudou de nome ou de arquivo, atualize este teste — ' +
        'ele é o que impede o vocabulário `dev.*` de divergir de novo.',
    );
  }
  // `];` fecha o array literal, `]);` fecha o `new Set([…])`.
  const fecha = /\]\)?;/.exec(fonte.slice(inicio));
  if (!fecha) {
    throw new Error(
      `${CAMINHO_DO_CASO_DE_USO}: \`${nome}\` não é mais um literal de array ` +
        'fechado por `];` ou `]);`. Este teste lê a lista como TEXTO — se ela ' +
        'virou algo computado, troque a leitura em vez de apagar a checagem.',
    );
  }
  const corpo = fonte.slice(inicio, inicio + fecha.index);
  const encontrados = [...corpo.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(
    (m) => m[1] as string,
  );
  if (encontrados.length === 0) {
    throw new Error(
      `${CAMINHO_DO_CASO_DE_USO}: \`${nome}\` veio VAZIA da leitura. ` +
        'Lista vazia passaria calada em qualquer comparação — por isso falha aqui.',
    );
  }
  return encontrados;
}

describe('vocabulário `dev.*`: engine × api', () => {
  const fonte = ler(CAMINHO_DO_CASO_DE_USO);
  const doEngine = tiposEmitidosPor('engine', 'dev');
  const daApi = listaLiteral(fonte, 'DEV_EVENT_TYPES');
  const pendentes = listaLiteral(fonte, 'DEV_PENDING_TYPES');

  it('o engine emite ao menos o punhado de tipos que já conhecíamos', () => {
    // Piso, não igualdade: protege o EXTRATOR. Se o regex parar de casar
    // (arquivo movido, literal reescrito), a comparação abaixo passaria
    // comparando duas listas vazias.
    expect(doEngine).toEqual(
      expect.arrayContaining([
        'dev.started',
        'dev.working',
        'dev.idle',
        'dev.blocked',
        'dev.blocked_by_container',
      ]),
    );
    expect(doEngine.length).toBeGreaterThanOrEqual(9);
  });

  it('`DEV_EVENT_TYPES` conhece todo tipo `dev.*` que o engine emite', () => {
    const faltando = doEngine.filter((t) => !daApi.includes(t));
    expect(
      faltando,
      faltando.length === 0
        ? ''
        : `O engine emite ${faltando.join(', ')}, e \`DEV_EVENT_TYPES\` em ` +
            `${CAMINHO_DO_CASO_DE_USO} não conhece. O caso de uso CONSULTA essa ` +
            'lista: o que não está nela é invisível para o heartbeat, e a sessão ' +
            'volta a fechar em 30s com dev agent pendurado. Acrescente cada tipo ' +
            'à lista e DECIDA, um a um, se ele também entra em `DEV_PENDING_TYPES` ' +
            '(entra se significa "há trabalho rolando ou um humano precisa agir").',
    ).toEqual([]);
  });

  it('`DEV_EVENT_TYPES` não inventa tipo que o engine não emite', () => {
    const sobrando = daApi.filter((t) => !doEngine.includes(t));
    expect(
      sobrando,
      sobrando.length === 0
        ? ''
        : `\`DEV_EVENT_TYPES\` lista ${sobrando.join(', ')}, que nenhum arquivo ` +
            'de `apps/engine/lib/**/*.ex` emite. Ou o engine parou de emitir e a ' +
            'lista ficou com lixo (remova), ou o tipo foi renomeado (renomeie nos ' +
            'dois lados).',
    ).toEqual([]);
  });

  it('`DEV_PENDING_TYPES` é subconjunto de `DEV_EVENT_TYPES`', () => {
    // Tipo pendente fora da lista consultada é regra morta: o caso de uso só
    // busca eventos de `DEV_EVENT_TYPES`, então ele nunca chegaria ao `find`.
    const forade = pendentes.filter((t) => !daApi.includes(t));
    expect(
      forade,
      forade.length === 0
        ? ''
        : `${forade.join(', ')} está em \`DEV_PENDING_TYPES\` mas não em ` +
            '`DEV_EVENT_TYPES` — o caso de uso nunca consulta esse evento, ' +
            'então a regra de pendência é inerte.',
    ).toEqual([]);
  });
});
