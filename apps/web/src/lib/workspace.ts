import type { WorkspaceKind } from "@dungeon-master/contracts";
import type { GlossaryKey } from "@dungeon-master/glossary";

/**
 * O workspace de um Project, do lado da tela.
 *
 * Como em `lib/domain.ts`, aqui só moram **chaves** de glossário e aritmética
 * sobre o contrato: nenhum label escrito à mão.
 */

export const WORKSPACE_KIND: Record<WorkspaceKind, GlossaryKey> = {
  GIT_REPO: "workspaceKind.gitRepo",
  FOLDER: "workspaceKind.folder",
};

export const WORKSPACE_KINDS = Object.keys(WORKSPACE_KIND) as readonly WorkspaceKind[];

/**
 * O caminho **parece** absoluto?
 *
 * A autoridade é a API: ela normaliza com `@dungeon-master/platform` e confere
 * no disco antes de gravar, e é de lá que vem o `detail` mostrado no campo. Esta
 * checagem existe só para pegar o erro mais comum — digitar `./repos/forja` — sem
 * uma ida ao servidor, e por isso aceita as duas famílias de caminho: o browser
 * não sabe em qual sistema operacional a API está rodando.
 */
export function looksAbsolutePath(candidate: string): boolean {
  const value = candidate.trim();
  if (value === "") return false;

  // POSIX, unidade do Windows (`D:\` ou `D:/`) e caminho UNC (`\\servidor`).
  return /^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

/** Um Project só aceita Run quando tem para onde mandar o agente trabalhar. */
export function hasWorkspace(project: { readonly workspacePath: string | null }): boolean {
  return project.workspacePath !== null && project.workspacePath !== "";
}
