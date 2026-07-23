# Notas do design-sync

- 2026-07-23: Projeto `368b0431-c98f-4b29-9cb3-b633c058e3df` ("Brabo Design
  System") criado vazio, sem sync ainda — este repo não tem nenhum código
  de design system (`design/` é só um placeholder, sem `package.json`,
  `dist/` ou Storybook). Quando o design system real for implementado
  (em `design/` ou em outro repo), rode `/design-sync` de novo para
  fazer o import de verdade.
- O projeto `1c960ca8-5e00-4558-8ced-80dfbdf01027` ("Brabo Design
  System", mesmo nome) é do tipo `PROJECT_TYPE_PROJECT` (projeto comum),
  não `PROJECT_TYPE_DESIGN_SYSTEM` — não pode ser usado como alvo de
  sync (o tipo é definido na criação e não muda depois). Não confundir
  os dois.
