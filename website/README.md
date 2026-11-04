# website

Só a árvore isolada do Redoc usada pelo gerador do site de documentação
(`scripts/docs/site/openapi.mjs`; AT-662, ADR 0253, ADR 0117). O site em si é
gerado por `pnpm docs:build` a partir de `docs/`.

```bash
cd website && pnpm install   # só na primeira vez, ou quando o lockfile mudar
```
