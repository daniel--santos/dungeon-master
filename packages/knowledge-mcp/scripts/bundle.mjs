// Empacota o servidor num arquivo só, para ser montado dentro do container.
// Roda depois do `tsc`: a função de empacotar mora em `src/bundle.ts` e é a
// mesma que o teste de stdio usa, para o que se testa ser o que se entrega.
import { bundleKnowledgeMcp, defaultBundleOutfile } from "../dist/bundle.js";

const outfile = defaultBundleOutfile();
await bundleKnowledgeMcp({ outfile });
console.log(`knowledge-mcp: bundle escrito em ${outfile}`);
