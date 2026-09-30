/**
 * Reconhece o caminho VIRTUAL de um binário do `bun build --compile` (ADR
 * 0112) — o `import.meta.url` de todo módulo embutido e o `process.argv[1]`
 * apontam para dentro do bundle, nunca para o disco.
 *
 * São DUAS formas, uma por família de SO, e só a primeira era reconhecida
 * (AT-343): em Linux/macOS o prefixo é `/$bunfs/root/`, no Windows é
 * `B:\~BUN\root\` — e o `import.meta.url` vira `file:///B:/~BUN/root/...`.
 * Sem a segunda, o binário de Windows achava que NÃO era binário compilado,
 * caía no `realpathSync(process.argv[1])` do fim de `index.ts` e morria com
 * `ENOENT` antes de `main()`, código 1 no lugar do 2 do uso.
 *
 * Aceita URL (`file:///...`), caminho com `/` e caminho com `\`. `~BUN` é
 * exigido como SEGMENTO inteiro, para uma pasta de usuário chamada
 * `x~BUN` não ser confundida.
 */
export function ehCaminhoDoBinarioCompilado(caminhoOuUrl: string | undefined): boolean {
  if (!caminhoOuUrl) return false;
  // Uma URL pode trazer o `~` como `%7E` e o `$` como `%24` — decodifica
  // antes de comparar; sequência malformada fica como veio.
  let texto = caminhoOuUrl;
  try {
    texto = decodeURIComponent(caminhoOuUrl);
  } catch {
    // mantém o original
  }
  if (texto.includes('/$bunfs/')) return true;
  // Com ou sem os dois-pontos da letra: o ensaio de Windows (run
  // 36779817686) mostrou `B/~BUN/root/...` no lugar de `B:/~BUN/root/...`.
  return /(^|[\\/])~BUN[\\/]root([\\/]|$)/.test(texto);
}

/**
 * A pergunta inteira, com as DUAS testemunhas: o `import.meta.url` do módulo
 * que pergunta e o `process.argv[1]`. O `index.ts` já olhava as duas, e o
 * `native-pty-loader.ts` só a primeira — no Windows o `uso` passava (pela
 * segunda) e o `--self-test-pty` caía no `import('node-pty')` comum,
 * `Cannot find package 'node-pty'` (AT-343). Uma função só, para os dois
 * lugares não voltarem a divergir.
 */
export function rodandoComoBinarioCompilado(
  urlDoModulo: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  return ehCaminhoDoBinarioCompilado(urlDoModulo) || ehCaminhoDoBinarioCompilado(argv1);
}
