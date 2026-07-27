# Descrição

<!-- O que muda e por quê. Se houver issue de alinhamento, é ela que carrega o
contexto — aqui basta o resumo. -->

Closes #

## Tipo de mudança

- [ ] Correção de bug
- [ ] Funcionalidade
- [ ] Documentação
- [ ] Infraestrutura / CI
- [ ] Refactor sem mudança de comportamento
- [ ] **Breaking change** — quebra comportamento existente

## Como testar

<!-- Passos para quem revisa reproduzir. Comando de teste específico, se houver:
     pnpm --filter api test -- rate-limit -->

## Screenshots

<!-- Só se mexeu em UI. Antes e depois ajuda mais que só o depois. -->

## Definition of Done

- [ ] Testes passando — caminho feliz **e** ao menos um caso de falha
- [ ] Lint limpo
- [ ] **Atualizei a documentação afetada** (ver [`docs/.docmap.yml`](../docs/.docmap.yml)) — o diff da doc está neste PR
- [ ] `CHANGELOG.md` tocado, se o comportamento observável mudou
- [ ] `pnpm docs:build` sem link quebrado
- [ ] ADR novo, se a mudança é estrutural (nenhum ADR aceito foi editado)
- [ ] Nenhum segredo no diff

## Licença

- [ ] Concordo em licenciar esta contribuição sob a [MIT](../LICENSE) do projeto

<!-- PR mira `dev`, nunca `main`. Merge em branch protegida é sempre manual. -->
