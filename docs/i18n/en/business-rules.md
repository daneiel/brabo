---
id: business-rules
title: Business rules
sidebar_label: Business rules
sidebar_position: 3
description: Brabo's domain rules, numbered, with where they live in the code and the test that covers each one.
keywords: [business rules, domain, state machine, approval, RBAC]
traducao_de: e6dc35de643740217772aa51fbe06e28020a16fb
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
