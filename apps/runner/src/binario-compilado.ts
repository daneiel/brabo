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
  if (caminhoOuUrl.includes('/$bunfs/')) return true;
  return /(^|[\\/])~BUN[\\/]root([\\/]|$)/.test(caminhoOuUrl);
}
