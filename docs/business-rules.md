---
id: business-rules
title: Regras de negócio
sidebar_label: Regras de negócio
sidebar_position: 3
description: As regras de domínio do Brabo, numeradas, com onde vivem no código e o teste que cobre cada uma.
keywords: [regras de negócio, domínio, máquina de estados, aprovação, RBAC]
---

# Business rules

Each rule has a **statement**, **where it lives** (`file:line`), and **the
test that covers it**. If you change a rule, update the line here in the same
change — that's what
[`.docmap.yml`](https://github.com/daneiel/brabo/blob/dev/docs/.docmap.yml)
requires with `block` severity.

They all live in `apps/api/src/domain/`, which is **pure**: no IO, no
framework, no database. That's why each one has a fast, deterministic unit
test.

<!-- BEGIN:GENERATED:indice-de-rn -->
<!-- END:GENERATED:indice-de-rn -->
