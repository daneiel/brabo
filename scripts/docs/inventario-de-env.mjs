/**
 * O inventário de variáveis de ambiente de `docs/reference/configuration.md`
 * como PORTÃO (AT-211).
 *
 * Até 2026-09-27 a variável lida no código e sem descrição na prosa virava
 * ⚠️ dentro do bloco gerado, e o `--check` só reprovava o bloco DESATUALIZADO:
 * depois de `pnpm docs:generate` a marca ficava commitada e o check passava.
 * Foi assim que `HUGGINGFACE_API_TOKEN` e `HUGGINGFACE_HUB_URL` ficaram meses
 * no inventário sem uma linha de prosa. A decisão do mantenedor foi reprovar,
 * e para TODAS as fontes — `produto` e `ferramenta` —, porque uma variável de
 * ferramenta sem descrição é o mesmo defeito para quem desenvolve.
 *
 * O que CONTA como descrição é o nome entre crases na prosa FORA do bloco
 * gerado (`nomesCitados`). Um `> **TODO(humano):**` na linha que cita a
 * variável também conta, e de propósito: a regra de docs é "nunca inventar
 * conteúdo; sem informação, TODO(humano)". Se o TODO reprovasse, o portão
 * empurraria quem não sabe o que a variável faz a INVENTAR uma descrição para
 * passar — o pior resultado possível. O TODO é lacuna DECLARADA, com a
 * pergunta escrita e um lugar certo; o ⚠️ é lacuna CALADA. O check relata o
 * TODO numa linha própria, sem reprovar.
 *
 * Mora fora de `generate.mjs` pelo mesmo motivo de `fontes-de-env.mjs`: o que
 * decide se reprova precisa de um teste por mutação (`inventario-de-env.spec.ts`),
 * e dentro de um script que roda no topo do módulo isso só se provava à mão.
 */

export const DESTINO = 'docs/reference/configuration.md';
export const ID_DO_BLOCO = 'env-inventario';

/**
 * Onde, em `configuration.md`, mora a tabela de cada fonte — é o que a
 * mensagem de reprovação manda escrever. Fonte nova sem entrada aqui cai no
 * genérico, nunca some da mensagem.
 */
export const SECAO_POR_FONTE = {
  api: '## api',
  engine: '## engine',
  web: '## web',
  broker: '## Container broker',
  'api/scripts': '## Tooling variables (not product)',
  e2e: '## Tooling variables (not product)',
};

/**
 * Nomes citados na prosa, incluindo a abreviação `PREFIXO_A` / `_B`, que é
 * idioma legítimo de tabela ("`POSTGRES_HOST` / `_USER` / `_PASSWORD`").
 * Sem expandir isso o checker acusa falso-positivo, e falso-positivo treina
 * quem lê a ignorar o aviso — que é o pior resultado possível pra um check.
 *
 * @param {string} doc
 * @returns {Set<string>}
 */
export function nomesCitados(doc) {
  const citados = new Set();
  for (const m of doc.matchAll(/`([A-Z][A-Z_0-9]{2,})`((?:\s*\/\s*`_[A-Z_0-9]+`)+)/g)) {
    const base = m[1];
    citados.add(base);
    for (const s of m[2].matchAll(/`(_[A-Z_0-9]+)`/g)) {
      // `PSYCHOLOGIST_BUDGET_MICROS_LEVE` / `_PESADA` → troca o último trecho.
      citados.add(base.replace(/_[A-Z0-9]+$/, s[1]));
      // `POSTGRES_HOST` / `_USER` → também vale como prefixo + sufixo.
      citados.add(base.split('_')[0] + s[1]);
    }
  }
  for (const m of doc.matchAll(/`([A-Z][A-Z_0-9]{2,})`/g)) citados.add(m[1]);
  return citados;
}

/**
 * Variáveis cuja ÚNICA citação na prosa está numa linha com `TODO(humano)`:
 * descritas por uma pergunta, não por uma resposta.
 *
 * @param {string} prosa
 * @param {Iterable<string>} nomes
 * @returns {Set<string>}
 */
export function soComTodo(prosa, nomes) {
  const linhas = prosa.split('\n');
  const pendentes = new Set();
  for (const nome of nomes) {
    const citam = linhas.filter((l) => l.includes(`\`${nome}\``));
    if (citam.length > 0 && citam.every((l) => l.includes('TODO(humano)'))) pendentes.add(nome);
  }
  return pendentes;
}

/**
 * O inventário inteiro, a partir das fontes e da PROSA (o documento já sem o
 * bloco gerado — senão a marca de lacuna conta como citação e o check se
 * auto-satisfaz).
 *
 * @param {[string, string[], RegExp, 'produto' | 'ferramenta'][]} fontes
 * @param {(padrao: RegExp, caminhos: string[]) => Map<string, Set<string>>} grep
 * @param {string} prosa
 */
export function inventariar(fontes, grep, prosa) {
  const citados = nomesCitados(prosa);
  const porFonte = [];
  const lacunas = [];
  let total = 0;

  for (const [app, caminhos, padrao, escopo] of fontes) {
    const achados = [...grep(padrao, caminhos).entries()].sort(([a], [b]) => a.localeCompare(b));
    total += achados.length;
    const variaveis = achados.map(([nome, arqs]) => {
      const arquivo = [...arqs][0];
      const documentada = citados.has(nome);
      if (!documentada) lacunas.push({ nome, arquivo, app, escopo });
      return { nome, arquivo, documentada };
    });
    porFonte.push({ app, escopo, variaveis });
  }

  const documentadas = porFonte.flatMap((f) => f.variaveis.filter((v) => v.documentada).map((v) => v.nome));
  const comTodo = [...soComTodo(prosa, new Set(documentadas))].sort();

  return { porFonte, total, lacunas, comTodo };
}

/**
 * A linha de reprovação: a variável, o arquivo que a lê e ONDE escrever.
 *
 * @param {{ nome: string, arquivo: string, app: string, escopo: string }} lacuna
 */
export function mensagemDaLacuna({ nome, arquivo, app, escopo }) {
  const secao = SECAO_POR_FONTE[app] ?? `a seção da fonte \`${app}\``;
  return (
    `  SEM DESC. ${nome} (${app}, ${escopo}) — lida em ${arquivo}, sem descrição em ${DESTINO}.\n` +
    `            Escreva uma linha com \`${nome}\` na tabela de "${secao}", FORA do bloco\n` +
    `            ${ID_DO_BLOCO}: o que ela faz, o default e quando importa. Sem informação,\n` +
    '            a linha que a cita leva `**TODO(humano):** <pergunta>` — nunca invente.'
  );
}
