/**
 * A mensagem inicial dos agentes de execução (`ToolLoop`), reconstruída DO
 * CÓDIGO do engine (AT-237, segunda rodada).
 *
 * Ela é montada em código e nunca vai ao event log, mas o produto a tem no
 * `ctx.messages` de cada iteração — então um roteador do produto a leria. O que
 * está aqui é uma PORTA dos moldes para TypeScript; o texto fixo é copiado e os
 * dados variáveis (título da tarefa e da história, requisitos, módulos) vêm de
 * onde o engine os tira: `tasks`/`stories`/`module_maps` (o engine os lê pela
 * api antes de montar o laço). Divergiu o molde do engine, divergiu isto: o
 * `kickoff.spec.ts` guarda os trechos-âncora e cita a linha de origem.
 *
 * Fora da porta, de propósito: `anamnese`, `infra-workflows` e os
 * conversacionais (Criativo, PO, Arquiteto, Dev Lead, Infra). Os primeiros têm
 * contexto montado de janelas de evento que o log não guarda; os segundos já
 * recebem a última mensagem do usuário como `pedido`.
 */
import type { Historia, Modulo, Tarefa } from './dados.ts';

const lista = (itens: readonly string[]): string => (itens.length === 0 ? '(nenhum declarado)' : itens.map((i) => `- ${i}`).join('\n'));
const listaOuNenhum = (itens: readonly string[]): string => (itens.length === 0 ? '(nenhum)' : itens.map((i) => `- ${i}`).join('\n'));

/** `apps/engine/lib/engine/dev/dev_agent_server.ex:481` (`initial_message/2`). */
export function kickoffDoDev(tarefa: Pick<Tarefa, 'title'>, historia: Pick<Historia, 'title'> | null): string {
  return (
    `Implemente a task "${tarefa.title}" da story "${historia?.title ?? ''}". ` +
    'Rode a suite de testes do projeto via `terminal` e só sinalize conclusão com ' +
    '`report_done` depois de vê-la passar (exit 0). Se não conseguir concluir, ' +
    'use `report_blocked` com o diagnóstico do que foi tentado e por que falhou.\n\n' +
    'IMPORTANTE: aja apenas por chamadas de ferramenta. Não escreva código ' +
    'nem JSON na sua resposta em texto, e não explique o que pretende fazer — ' +
    'chame `write_file` para criar cada arquivo e `terminal` para rodar a suite. ' +
    'Toda resposta sua deve conter pelo menos uma chamada de ferramenta.'
  );
}

/** `apps/engine/lib/engine/gates/qa_automacao_agent.ex:108` (`initial_message/2`). */
export function kickoffDaQaAutomacao(tarefa: Pick<Tarefa, 'title'>, historia: Pick<Historia, 'title' | 'rf' | 'rnf'> | null): string {
  const regras = [...(historia?.rf ?? []), ...(historia?.rnf ?? [])];
  const listaRegras = regras.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `Você é a subespecialidade de Automação do gate de QA da task
"${tarefa.title}" (story "${historia?.title ?? ''}"). Você NÃO escreve código:
só lê, roda a suite e emite um parecer.

Regras da story que precisam de cobertura:
${listaRegras}

Siga exatamente estes passos, um por vez, cada um com uma ferramenta:
1. \`terminal\` com o comando de teste do projeto (veja o AGENTS.md do
   repositório) e observe o código de saída.
2. \`search_workspace\` / \`read_file\` nos arquivos de teste, pra descobrir
   QUAL teste cobre CADA regra acima.
3. \`emit_qa_verdict\` com uma linha de \`coverageMatrix\` por regra —
   \`rule\` (o texto da regra), \`tests\` (os arquivos que a cobrem, lista
   vazia se nenhum) e \`covered\` (true/false).

Veredito: \`approved\` só se a suite saiu com exit 0 E toda regra tem pelo
menos um teste. Se alguma regra ficou sem teste, use
\`changes_requested\` e liste em \`itens\` exatamente quais regras faltam.

Responda SEMPRE chamando uma das ferramentas acima. Nunca chame as
funções do código que está revisando — elas não são ferramentas.
`;
}

const descreverModulos = (mods: readonly Modulo[]): string =>
  mods.length === 0
    ? '(sem module_map)'
    : mods.map((m) => `- ${m.name} (${m.stack ?? '?'}): ${m.responsibility ?? ''}`).join('\n');

/**
 * `apps/engine/lib/engine/gates/qa_estrategia_agent.ex:93`. A história que o
 * gate avalia NÃO é recuperável do event log (o pedido chega por chamada
 * interna), então título/descrição/requisitos saem como o molde os mostraria
 * vazios; o mapa de módulos e o texto fixo são o que o log permite.
 */
export function kickoffDaQaEstrategia(historia: Historia | null, modulos: readonly Modulo[]): string {
  return `Você é a QA-estratégia (docs/fluxo.yml, segundo momento do qa-lead):
avalia a IMPLEMENTABILIDADE de uma story ANTES do dev agent escrever
código. Você NÃO escreve código nem roda testes — só lê o que já
existe e registra um PLANO DE TESTE.

STORY: ${historia?.title ?? '(story não recuperável do event log)'}
${historia?.description ?? ''}

Requisitos funcionais:
${lista(historia?.rf ?? [])}

Requisitos não funcionais:
${lista(historia?.rnf ?? [])}

Definition of done:
${lista(historia?.dod ?? [])}

MÓDULOS do projeto:
${descreverModulos(modulos)}

Use \`read_file\`/\`search_workspace\` para entender o que já existe
(padrões de teste do projeto, o módulo que a story toca), \`rag_search\`
para achar convenção/ADR já indexado sobre o assunto, e então
\`emit_plano_de_teste\` com:
- \`planoDeTeste\`: síntese do que precisa ser verificado;
- \`criteriosExecutaveis\`: os critérios de aceite reescritos de forma
  VERIFICÁVEL (ex.: "dado X, quando Y, então Z" em vez de prosa vaga);
- \`estrategiaDeAutomacao\`: GENÉRICA e curta — que NÍVEL de teste
  (unidade/integração/e2e) e ONDE, sem escolher framework específico.

Responda SEMPRE chamando \`emit_plano_de_teste\`.
`;
}

/** `apps/engine/lib/engine/gates/appsec_agent.ex:79` — mesma limitação de história da QA-estratégia. */
export function kickoffDoAppsec(historia: Historia | null, modulos: readonly Modulo[]): string {
  return `Você é o appsec — o SecOps num segundo momento, de DESIGN, ANTES de
existir código ou PR para a story "${historia?.title ?? '(story não recuperável do event log)'}". Você
NÃO escreve código e NÃO roda scanner (gitleaks/semgrep são o SecOps
de PR, determinístico, que roda depois, sobre o diff real): só
raciocina sobre o desenho abaixo e emite um checklist STRIDE-lite.

Story:
${historia?.description ?? ''}

Requisitos funcionais:
${listaOuNenhum(historia?.rf ?? [])}

Requisitos não funcionais:
${listaOuNenhum(historia?.rnf ?? [])}

Módulos do module_map vigente que esta story toca:
${descreverModulos(modulos)}

Para cada uma das seis categorias STRIDE — Spoofing, Tampering,
Repudiation, Information disclosure, Denial of service, Elevation of
privilege — avalie se o desenho acima introduz risco, e o que fazer a
respeito. "Nenhum risco óbvio" é resposta válida para uma categoria;
não invente ameaça só para preencher.

Use \`read_file\`/\`search_workspace\` se precisar examinar um ADR ou
código existente (opcional — o contexto acima já é a base), ou
\`rag_search\` para achar ADR/regra de negócio de segurança já indexado
sobre o assunto. Termine
SEMPRE chamando \`emit_threat_model\` com \`threatModel\` (o checklist nas
seis categorias), \`requisitosSeguranca\` (o que a implementação vai ter
que fazer por causa disto) e \`riscos\` (o que sobrevive mesmo assim —
lista vazia é resposta válida).

Responda SEMPRE chamando uma das ferramentas acima.
`;
}
