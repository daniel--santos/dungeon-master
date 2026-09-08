import { statSync } from "node:fs";
import { join } from "node:path";

import { isInside, normalizeAbsolutePath } from "@dungeon-master/platform";

import type { ArtifactProbe } from "./ports.js";

/**
 * O `artifactExists` de verdade: `stat` no checkout do Run.
 *
 * Síncrono porque os predicados do domínio são funções puras e síncronas;
 * um `stat` local é barato o bastante. Um caminho que resolva para fora do
 * checkout responde `false` — o contrato já recusa `..` em texto, mas a
 * checagem sobre o caminho resolvido é a que vale para o disco.
 */
export function createFileSystemArtifactProbe(checkoutPath: string): ArtifactProbe {
  const root = normalizeAbsolutePath(checkoutPath);
  return (relativePath) => {
    try {
      const resolved = normalizeAbsolutePath(join(root, relativePath));
      if (!isInside(root, resolved)) return false;
      return statSync(resolved).isFile();
    } catch {
      return false;
    }
  };
}
