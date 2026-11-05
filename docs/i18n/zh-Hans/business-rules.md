---
id: business-rules
title: 业务规则
sidebar_label: 业务规则
sidebar_position: 3
description: Brabo 的领域规则，带编号，注明它们在代码中的位置以及覆盖每一条的测试。
keywords: [业务规则, 领域, 状态机, 审批, RBAC]
traducao_de: e6dc35de643740217772aa51fbe06e28020a16fb
---

# 业务规则

每条规则都有**陈述**、**所在位置**（`file:line`）和**覆盖它的测试**。如果你修改了一条规则，请在同一次变更中更新这里对应的行——这是
[`.docmap.yml`](https://github.com/daneiel/brabo/blob/dev/docs/.docmap.yml)
以 `block` 级别所要求的。

它们都位于 `apps/api/src/domain/`，该目录是**纯的**：没有 IO，没有框架，没有数据库。因此每一条都有快速、确定性的单元测试。

<!-- BEGIN:GENERATED:indice-de-rn -->
<!-- END:GENERATED:indice-de-rn -->
