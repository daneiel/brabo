/**
 * As FONTES do inventário de variáveis de ambiente de
 * `docs/reference/configuration.md` — onde o gerador procura, com que padrão,
 * e com que ESCOPO (`produto` ou `ferramenta`).
 *
 * Mora fora de `generate.mjs` por um motivo só (AT-124): o que decide se uma
 * variável nova é VISTA é esta lista de globs e filtros, e ela precisa de um
 * teste que a prove contra o repositório de verdade
 * (`fontes-de-env.spec.ts`). Dentro de um script que roda no topo do módulo,
 * ela só se provava por mutação à mão.
 *
 * `arquivos` é o de `./fontes.mjs` (`git ls-files`): só o VERSIONADO entra, e
 * arquivo novo só é visto depois de `git add`.
 *
 * @param {(glob: string) => string[]} arquivos
 * @returns {[string, string[], RegExp, 'produto' | 'ferramenta'][]}
 */
export function fontesDoInventarioDeEnv(arquivos) {
  return [
    // DOIS globs para a api pelo mesmo motivo do broker, logo abaixo: o `**/`
    // do pathspec do git exige pelo menos um nível de diretório, então os
    // arquivos que moram direto em `apps/api/src/` escapavam. O preço estava
    // medido e pago: `API_JSON_BODY_LIMIT` (`apps/api/src/main.ts:59`) é
    // variável de PRODUTO — o teto do corpo JSON que a api aceita — e não
    // aparecia em inventário nenhum.
    ['api',
      [...arquivos('apps/api/src/*.ts'), ...arquivos('apps/api/src/**/*.ts')]
        .filter((f) => !f.includes('.spec.')),
      /process\.env\.([A-Z_0-9]{3,})/g, 'produto'],
    ['engine', [...arquivos('apps/engine/lib/**/*.ex'), ...arquivos('apps/engine/config/*.exs')],
      /System\.(?:get_env|fetch_env!?)\("([A-Z_0-9]{3,})"/g, 'produto'],
    ['web', arquivos('apps/web/src/**/*.ts*'), /import\.meta\.env\.(VITE_[A-Z_0-9]+)/g, 'produto'],
    // O broker (ADR 0130) entra porque é SERVIÇO da instalação: o que ele lê
    // do ambiente é configuração de quem opera, igual à da api e à do engine.
    // `apps/runner` continua de FORA de propósito — ele roda na máquina do
    // usuário e é configurado por flag e por arquivo na pasta do projeto, não
    // pelo `.env` do deploy.
    // DOIS globs, e não um: o `**/` do pathspec do git exige PELO MENOS um
    // nível de diretório, então `apps/broker/src/**/*.ts` devolve VAZIO
    // enquanto todos os arquivos do broker moram direto em `src/`. Um
    // inventário que nasce vazio não avisa: ele passa verde.
    ['broker',
      [...arquivos('apps/broker/src/*.ts'), ...arquivos('apps/broker/src/**/*.ts')]
        .filter((f) => !f.includes('.spec.')),
      /env\.([A-Z_0-9]{3,})/g, 'produto'],
    // As duas fontes de FERRAMENTA. Ficaram de fora até 2026-09-12 e o
    // inventário passou verde o tempo todo — cinco variáveis lidas de verdade,
    // nenhuma citada em `configuration.md`. Caem na MESMA armadilha do `**/`:
    // `seed-golden-set-qa.ts` mora direto em `apps/api/scripts/` e
    // `playwright.config.ts` direto em `e2e/`, então são dois globs cada.
    //
    // `e2e/` não é membro do workspace (ADR 0120, mesmo desenho do
    // `website/`), e foi por isso que escapou da varredura — mas o gerador
    // LÊ arquivo, não pacote, e membership não muda nada aqui.
    ['api/scripts',
      [...arquivos('apps/api/scripts/*.ts'), ...arquivos('apps/api/scripts/**/*.ts')]
        .filter((f) => !f.includes('.spec.')),
      /process\.env\.([A-Z_0-9]{3,})/g, 'ferramenta'],
    //
    // Em `e2e/` o filtro de `.spec.` NÃO se aplica, e isso foi MEDIDO (AT-124,
    // 2026-09-25): nas outras fontes o spec é teste de unidade AO LADO do
    // código que lê o ambiente, mas em `e2e/` o spec É o código — os testes do
    // Playwright (`e2e/testes/*.spec.ts`) rodam contra o compose de produção e
    // leem dele o que precisarem. Com o filtro, uma `process.env.X` nova num
    // teste de `e2e/` passava pelo `docs:check` verde, sem linha nem marca de
    // lacuna, mesmo com o arquivo versionado.
    ['e2e',
      [...arquivos('e2e/*.ts'), ...arquivos('e2e/**/*.ts')],
      /process\.env\.([A-Z_0-9]{3,})/g, 'ferramenta'],
  ];
}
