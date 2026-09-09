import type { LoadoutDefinitionRecord } from "@/lib/api-types";

/**
 * O que mudou entre duas versões de um Loadout (Fase 8C).
 *
 * Compara as duas definições por referências — nunca o snapshot resolvido —
 * e devolve uma lista de fatos: um campo que trocou, uma Skill que entrou ou
 * saiu, um pin que mudou, a política que mudou. Os nomes são resolvidos por
 * quem renderiza, a partir das listas que a tela já tem; aqui só ids, para o
 * cálculo ser puro e testável.
 */

export type LoadoutField = "name" | "agent" | "harness" | "model" | "profile";

export type LoadoutCollection = "skills" | "tools" | "mcpServers";

export type LoadoutChange =
  | {
      readonly kind: "field";
      readonly field: LoadoutField;
      readonly from: string | null;
      readonly to: string | null;
    }
  | {
      readonly kind: "added" | "removed";
      readonly collection: LoadoutCollection;
      readonly ids: readonly string[];
    }
  | {
      readonly kind: "pin";
      readonly skillId: string;
      readonly from: number | null;
      readonly to: number | null;
    }
  | { readonly kind: "policy" }
  | { readonly kind: "default"; readonly on: boolean };

function collection(
  name: LoadoutCollection,
  before: readonly string[],
  after: readonly string[],
): LoadoutChange[] {
  const changes: LoadoutChange[] = [];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((id) => !beforeSet.has(id));
  const removed = before.filter((id) => !afterSet.has(id));
  if (added.length > 0) changes.push({ kind: "added", collection: name, ids: added });
  if (removed.length > 0) changes.push({ kind: "removed", collection: name, ids: removed });
  return changes;
}

export function loadoutChanges(
  before: LoadoutDefinitionRecord,
  after: LoadoutDefinitionRecord,
): readonly LoadoutChange[] {
  const changes: LoadoutChange[] = [];

  const fields: readonly [LoadoutField, string | null, string | null][] = [
    ["name", before.name, after.name],
    ["agent", before.agentId, after.agentId],
    ["harness", before.harnessId, after.harnessId],
    ["model", before.modelId, after.modelId],
    ["profile", before.executionProfileId, after.executionProfileId],
  ];
  for (const [field, from, to] of fields) {
    if (from !== to) changes.push({ kind: "field", field, from, to });
  }

  changes.push(
    ...collection(
      "skills",
      before.skillRefs.map((ref) => ref.skillId),
      after.skillRefs.map((ref) => ref.skillId),
    ),
  );
  const pinsBefore = new Map(before.skillRefs.map((ref) => [ref.skillId, ref.pinnedVersion]));
  for (const ref of after.skillRefs) {
    if (!pinsBefore.has(ref.skillId)) continue;
    const from = pinsBefore.get(ref.skillId) ?? null;
    if (from !== ref.pinnedVersion) {
      changes.push({ kind: "pin", skillId: ref.skillId, from, to: ref.pinnedVersion });
    }
  }

  changes.push(...collection("tools", before.toolIds, after.toolIds));
  changes.push(...collection("mcpServers", before.mcpServerIds, after.mcpServerIds));

  if (
    JSON.stringify(before.knowledgePolicy) !== JSON.stringify(after.knowledgePolicy) ||
    JSON.stringify(before.contextPolicy) !== JSON.stringify(after.contextPolicy)
  ) {
    changes.push({ kind: "policy" });
  }

  if (before.isDefault !== after.isDefault) changes.push({ kind: "default", on: after.isDefault });

  return changes;
}
