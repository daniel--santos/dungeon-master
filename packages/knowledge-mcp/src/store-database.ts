import {
  findKnowledgeItemRow,
  findTaskRow,
  getProjectSummary,
  getTaskDetail,
  KNOWLEDGE_FTS_CONFIG,
  knowledgeItems,
  listProjectDecisions,
  type Database,
  type KnowledgeItemRow,
} from "@dungeon-master/database";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import type { KnowledgeToolItem, KnowledgeToolStore, KnowledgeToolTaskRef } from "./store.js";

/**
 * A porta sobre o banco.
 *
 * `userId` e `projectId` entram uma vez, na construção, e toda consulta os
 * carrega no `WHERE`. Nenhuma ferramenta recebe um id de Project ou de
 * usuário como argumento — é assim que um item de outra Campanha não aparece
 * nem por acidente nem por pedido do agente.
 *
 * Só `ACTIVE`: o que está em revisão ainda não é conhecimento, o recusado nunca
 * foi, e o arquivado deixou de ser. O `SUMMARY` fica fora da busca e da leitura
 * por id porque tem porta própria (`getSummary`), e porque é a maior página do
 * Grimório e apareceria em toda busca.
 */

function toItem(row: KnowledgeItemRow): KnowledgeToolItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface DatabaseKnowledgeToolStoreOptions {
  readonly userId: string;
  readonly projectId: string;
}

export function createDatabaseKnowledgeToolStore(
  db: Database,
  options: DatabaseKnowledgeToolStoreOptions,
): KnowledgeToolStore {
  const { userId, projectId } = options;

  const escopo = () =>
    and(
      eq(knowledgeItems.userId, userId),
      eq(knowledgeItems.projectId, projectId),
      eq(knowledgeItems.status, "ACTIVE"),
    );

  return {
    async searchItems({ query, limit }) {
      // `plainto_tsquery` aceita qualquer texto do agente sem quebrar o parser;
      // a mesma consulta e a mesma configuração (`simple`) da busca da API.
      const consulta = sql`plainto_tsquery(${KNOWLEDGE_FTS_CONFIG}, ${query})`;
      const rows = await db
        .select()
        .from(knowledgeItems)
        .where(
          and(
            escopo(),
            ne(knowledgeItems.type, "SUMMARY"),
            sql`${knowledgeItems.search} @@ ${consulta}`,
          ),
        )
        .orderBy(
          sql`ts_rank(${knowledgeItems.search}, ${consulta}) desc`,
          desc(knowledgeItems.createdAt),
          desc(knowledgeItems.id),
        )
        .limit(limit);
      return rows.map(toItem);
    },

    async getItem(knowledgeItemId) {
      const row = await findKnowledgeItemRow(db, { userId, knowledgeItemId });
      if (row === null) return null;
      // Outro Project, outro estado ou o resumo: "não existe", e não "existe
      // mas não é seu". Contar sobre um item alheio já seria vazar o Grimório.
      if (row.projectId !== projectId || row.status !== "ACTIVE" || row.type === "SUMMARY") {
        return null;
      }
      return toItem(row);
    },

    async getSummary() {
      const summary = await getProjectSummary(db, { userId, projectId });
      if (summary === null) return null;
      const item = summary.item;
      return {
        item:
          item === null
            ? null
            : {
                id: item.id,
                type: item.type,
                title: item.title,
                content: item.content,
                version: item.version,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              },
        activeItemCount: summary.activeItemCount,
        promotedSinceSummary: summary.promotedSinceSummary,
      };
    },

    async listDecisions(limit) {
      const page = await listProjectDecisions(db, {
        userId,
        projectId,
        status: "ACTIVE",
        page: 1,
        pageSize: limit,
      });
      if (page === null) return [];
      return page.items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        content: item.content,
        version: item.version,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
    },

    async getTask(taskId) {
      const detail = await getTaskDetail(db, { userId, taskId });
      if (detail === null || detail.projectId !== projectId) return null;

      let parent: KnowledgeToolTaskRef | null = null;
      if (detail.parentTaskId !== null) {
        const mae = await findTaskRow(db, { userId, taskId: detail.parentTaskId });
        if (mae !== null) parent = { id: mae.id, title: mae.title, status: mae.status };
      }

      const toRef = (ref: { id: string; title: string; status: KnowledgeToolTaskRef["status"] }) =>
        ({ id: ref.id, title: ref.title, status: ref.status }) satisfies KnowledgeToolTaskRef;

      return {
        id: detail.id,
        title: detail.title,
        description: detail.description,
        kind: detail.kind,
        status: detail.status,
        priority: detail.priority,
        parent,
        dependencies: detail.dependencies.map(toRef),
        dependents: detail.dependents.map(toRef),
      };
    },
  };
}
