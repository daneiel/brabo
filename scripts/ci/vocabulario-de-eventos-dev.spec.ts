import { describe, expect, it } from 'vitest';
import { ler, tiposEmitidosPor } from '../docs/fontes.mjs';

/**
 * O vocabulário `dev.*` do ENGINE contra as listas que o resto do produto
 * consulta — a da API (heartbeat de sessão) e a do WEB (painel do time).
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
 * decidir a metade que é decisão — sem acrescentar passo de build nenhum. O
 * mesmo vale, com força ainda maior, para o WEB: o estado que um evento
 * significa no painel (`aguardando` × `falhou` × `trabalhando`) é julgamento
 * pelo qual nenhum gerador pode responder.
 *
 * Por que ele vive aqui e não na suíte da api (ou do web): ele lê
 * `apps/engine/lib/**`, `apps/api/src/**` e `apps/web/src/**` como TEXTO,
 * atravessando três apps. `scripts/ci/` é onde moram os testes que leem o
 * repositório inteiro, e roda no CI (`pnpm --filter @brabo/scripts test`, job
 * `test-packages`). Ele reusa o MESMO extrator do inventário de eventos de
 * `docs/reference/events.md` (`scripts/docs/fontes.mjs`) — um terceiro regex
 * respondendo "o que o engine emite?" seria a mesma classe de defeito que
 * este teste pega.
 */

const CAMINHO_DO_CASO_DE_USO =
  'apps/api/src/application/use-cases/sessions/get-session-pending-work.use-case.ts';

const CAMINHO_DO_PAINEL = 'apps/web/src/lib/agent-status.ts';

/**
 * O CORPO TEXTUAL de um literal declarado com `const <nome>` — array, `Set`
 * ou objeto. Deliberadamente simples: as listas são literais por construção
 * (é o que as torna auditáveis), e se um dia deixarem de ser, a extração
 * falha ALTO em vez de devolver uma lista curta em silêncio.
 */
function corpoDoLiteral(caminho: string, fonte: string, nome: string): string {
  const decl = new RegExp(`const ${nome}\\b`).exec(fonte);
  if (!decl) {
    throw new Error(
      `${caminho}: não achei \`const ${nome}\`. ` +
        'Se a constante mudou de nome ou de arquivo, atualize este teste — ' +
        'ele é o que impede o vocabulário `dev.*` de divergir de novo.',
    );
  }
  // `];` fecha o array literal, `]);` o `new Set([…])`, `};` o objeto.
  const resto = fonte.slice(decl.index);
  const fecha = /[\]}]\)?;/.exec(resto);
  if (!fecha) {
    throw new Error(
      `${caminho}: \`${nome}\` não é mais um literal fechado por \`];\`, ` +
        '`]);` ou `};`. Este teste lê a lista como TEXTO — se ela virou algo ' +
        'computado, troque a leitura em vez de apagar a checagem.',
    );
  }
  return resto.slice(0, fecha.index);
}

/** As strings `<a>.<b>` de um literal de array/Set. Vazio é erro. */
function listaLiteral(caminho: string, fonte: string, nome: string): string[] {
  const corpo = corpoDoLiteral(caminho, fonte, nome);
  const encontrados = [...corpo.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(
    (m) => m[1] as string,
  );
  if (encontrados.length === 0) {
    throw new Error(
      `${caminho}: \`${nome}\` veio VAZIA da leitura. ` +
        'Lista vazia passaria calada em qualquer comparação — por isso falha aqui.',
    );
  }
  return encontrados;
}

/**
 * As CHAVES `<a>.<b>` de um literal de objeto. `vazioOk` existe para a lista
 * de exceções do painel, cuja resposta certa hoje é justamente estar vazia —
 * e vazia ali não esconde nada: é o mapa ao lado que precisa estar cheio.
 */
function chavesDoMapa(
  caminho: string,
  fonte: string,
  nome: string,
  { vazioOk = false } = {},
): string[] {
  const corpo = corpoDoLiteral(caminho, fonte, nome);
  const encontradas = [...corpo.matchAll(/'([a-z_]+\.[a-z_]+)'\s*:/g)].map(
    (m) => m[1] as string,
  );
  if (encontradas.length === 0 && !vazioOk) {
    throw new Error(
      `${caminho}: \`${nome}\` veio VAZIO da leitura. ` +
        'Mapa vazio passaria calado em qualquer comparação — por isso falha aqui.',
    );
  }
  return encontradas;
}

/**
 * A pergunta que os dois lados fazem, isolada porque é a única lógica aqui e
 * porque a lista de exceções do painel está VAZIA hoje: sem esta função
 * separada, o caminho "declarado deliberadamente fora" não teria como ser
 * provado antes de alguém precisar dele.
 */
export function semDecisao(
  doEngine: readonly string[],
  decididos: readonly string[],
  fora: readonly string[] = [],
): string[] {
  return doEngine.filter((t) => !decididos.includes(t) && !fora.includes(t));
}

describe('vocabulário `dev.*`: engine × api', () => {
  const fonte = ler(CAMINHO_DO_CASO_DE_USO);
  const doEngine = tiposEmitidosPor('engine', 'dev');
  const daApi = listaLiteral(CAMINHO_DO_CASO_DE_USO, fonte, 'DEV_EVENT_TYPES');
  const pendentes = listaLiteral(
    CAMINHO_DO_CASO_DE_USO,
    fonte,
    'DEV_PENDING_TYPES',
  );

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
    const faltando = semDecisao(doEngine, daApi);
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

/**
 * A MESMA deriva, do outro lado — e o caso do web NÃO é idêntico ao da api.
 *
 * Na api, todo tipo `dev.*` tem de ser conhecido: o heartbeat precisa VER o
 * evento nem que seja para ignorá-lo. No painel, um tipo pode legitimamente
 * não interessar. O que é inaceitável é ele ficar de fora por ESQUECIMENTO —
 * era o `default: return 'trabalhando'` do `switch` antigo, que fez o painel
 * dizer que cinco dev agents do `exp004` trabalhavam enquanto esperavam,
 * parados, um humano subir o container.
 *
 * Por isso a exigência aqui é uma DECISÃO EXPLÍCITA por tipo, em um de dois
 * lugares que se leem:
 *
 *   - `DEV_STATUS_EVENTS`, que deixou de ser lista e virou MAPA
 *     `tipo -> AgentStatus`. Escolher o mapa foi metade da correção: numa
 *     lista, "estar presente" e "ter um estado decidido" eram duas coisas
 *     separadas, e era no vão entre elas que o `default` morava. No mapa a
 *     chave É a decisão — não há como acrescentar um tipo sem responder o
 *     que ele significa, e o teste abaixo só precisa cobrir a outra metade:
 *     o tipo que ninguém acrescentou.
 *   - `DEV_STATUS_EVENTS_FORA`, `tipo -> motivo`, para o que o painel decide
 *     ignorar. Está vazio hoje, e é essa a resposta certa; existe para que a
 *     saída seja DECLARAR, nunca omitir — e `semDecisao` acima é testada com
 *     dados fabricados justamente porque, vazia, essa metade não seria
 *     exercitada por dado real nenhum.
 */
describe('vocabulário `dev.*`: engine × web (painel do time)', () => {
  const fonte = ler(CAMINHO_DO_PAINEL);
  const doEngine = tiposEmitidosPor('engine', 'dev');
  const mapeados = chavesDoMapa(CAMINHO_DO_PAINEL, fonte, 'DEV_STATUS_EVENTS');
  const fora = chavesDoMapa(CAMINHO_DO_PAINEL, fonte, 'DEV_STATUS_EVENTS_FORA', {
    vazioOk: true,
  });

  it('todo tipo `dev.*` do engine tem decisão no painel — mapeado ou declarado fora', () => {
    const semDecidir = semDecisao(doEngine, mapeados, fora);
    expect(
      semDecidir,
      semDecidir.length === 0
        ? ''
        : `O engine emite ${semDecidir.join(', ')} e o painel não decidiu o que ` +
            `isso significa. Em ${CAMINHO_DO_PAINEL}, ou acrescente cada tipo a ` +
            '`DEV_STATUS_EVENTS` com o `AgentStatus` que ele significa ' +
            '(`aguardando` quando o agente depende de algo FORA dele — gate, ' +
            'aprovação, container; `falhou`, `ocioso`, `travado`, `trabalhando` ' +
            'nos outros casos), ou declare-o em `DEV_STATUS_EVENTS_FORA` com o ' +
            'motivo de o painel ignorá-lo. Não deixe passar calado: foi assim ' +
            'que `dev.blocked_by_container` virou "trabalhando" no `exp004`.',
    ).toEqual([]);
  });

  it('o painel não mapeia tipo `dev.*` que o engine não emite', () => {
    const sobrando = [...mapeados, ...fora].filter(
      (t) => t.startsWith('dev.') && !doEngine.includes(t),
    );
    expect(
      sobrando,
      sobrando.length === 0
        ? ''
        : `${CAMINHO_DO_PAINEL} decide sobre ${sobrando.join(', ')}, que nenhum ` +
            'arquivo de `apps/engine/lib/**/*.ex` emite. Ou o engine parou de ' +
            'emitir e a decisão ficou órfã (remova), ou o tipo foi renomeado ' +
            '(renomeie nos dois lados).',
    ).toEqual([]);
  });

  it('nenhum tipo está mapeado E declarado fora ao mesmo tempo', () => {
    // Contradição silenciosa: o mapa venceria (é ele que `devStatus` lê) e a
    // declaração de exceção ficaria mentindo para quem a lesse.
    const nosDois = mapeados.filter((t) => fora.includes(t));
    expect(
      nosDois,
      nosDois.length === 0
        ? ''
        : `${nosDois.join(', ')} está em \`DEV_STATUS_EVENTS\` e em ` +
            '`DEV_STATUS_EVENTS_FORA`. O mapa vence na prática — apague a ' +
            'declaração de exceção, que só serve para enganar quem lê.',
    ).toEqual([]);
  });
});

describe('semDecisao — a válvula da exceção, provada com dados fabricados', () => {
  // `DEV_STATUS_EVENTS_FORA` está vazio, então nenhum dado REAL exercita o
  // caminho "declarado fora". Sem estes três casos, ele só seria descoberto
  // quebrado no dia em que alguém precisasse dele.
  it('acusa o tipo que ninguém decidiu', () => {
    expect(semDecisao(['dev.a', 'dev.b'], ['dev.a'])).toEqual(['dev.b']);
  });

  it('aceita o tipo declarado deliberadamente fora', () => {
    expect(semDecisao(['dev.a', 'dev.b'], ['dev.a'], ['dev.b'])).toEqual([]);
  });

  it('não inventa pendência quando tudo está decidido', () => {
    expect(semDecisao(['dev.a'], ['dev.a'], [])).toEqual([]);
  });
});
