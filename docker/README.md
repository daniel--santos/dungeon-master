# A imagem de referência do agente

`agent.Dockerfile` constrói `dungeon-master-agent:0.1.0`, a imagem que o modo de execução
`DOCKER` ("Masmorra selada") usa para rodar um Run dentro de um container.

```bash
pnpm docker:build                        # constrói com a tag padrão
pnpm docker:build -- --no-cache          # ignora o cache de camadas
pnpm docker:build -- --image outra:tag   # outra tag
```

Medido em 07/09/2026, Windows 11 com Docker Desktop 29.7.2 (WSL2):

| Medida                           | Valor       |
| -------------------------------- | ----------- |
| Build do zero (`--no-cache`)     | 74,7 s      |
| Tamanho da imagem                | 1,28 GB     |
| Partida de um container (`--rm`) | 0,7 – 1,1 s |

O segundo build, com cache, é quase instantâneo; o número acima é o pior caso, que é o
que alguém enfrenta na primeira vez.

## O que está dentro

`node:24-bookworm-slim`, mais `git`, `procps` e `ripgrep`, mais as três CLIs em versão
fixa — as mesmas do host em que o modo foi provado:

| CLI         | Pacote npm                        | Versão  |
| ----------- | --------------------------------- | ------- |
| Claude Code | `@anthropic-ai/claude-code`       | 2.1.263 |
| Codex       | `@openai/codex`                   | 0.147.0 |
| Pi          | `@earendil-works/pi-coding-agent` | 0.85.1  |

Subir uma versão é editar o `ARG` correspondente e reconstruir. A imagem é o registro de
qual CLI o Run usou, e é por isso que as versões são fixas: um `@latest` faria dois Runs
do mesmo dia rodarem em ferramentas diferentes sem nada no diário dizendo isso.

## Nenhuma credencial mora aqui

A imagem é construível e publicável sem segredo nenhum. A credencial do harness entra em
tempo de execução, pelo mecanismo decidido em
[`docs/adr/0001-autenticacao-em-docker.md`](../docs/adr/0001-autenticacao-em-docker.md):

- **variável de ambiente** é o caminho padrão, e é o único que o sanitizador de
  credenciais sabe redigir no log — ele procura o **valor** das variáveis conhecidas, e
  um segredo que só existe dentro de um arquivo montado ele nunca viu;
- **arquivo montado read-only** é o segundo caminho, sempre um arquivo específico e
  nunca um diretório de home.

O valor de uma variável **não** entra no argv do `docker run`. O comando leva `-e NOME`
sem `=`, e o valor viaja no ambiente do processo cliente do Docker: o argv de um processo
é legível por qualquer coisa rodando na máquina.

## O contrato de UID/GID

Um arquivo escrito no bind mount sai com o dono do processo **dentro** do container. Se a
imagem for construída para um UID e o worker rodar como outro, os arquivos do worktree
saem com o dono errado — e no Linux o agente nem consegue escrever.

Por isso `AGENT_UID` e `AGENT_GID` são build args, e `pnpm docker:build` os preenche com
o UID e o GID reais do usuário no Linux e no macOS. No Windows não existe UID: o script
não passa build arg nenhum, a imagem fica com o padrão `1000:1000`, e é esse mesmo valor
que o worker passa em `--user`.

`groupmod -o` e `usermod -o` (não único) são obrigatórios: no macOS o GID primário do
usuário é 20 (`staff`), que a imagem base já entrega a `dialout`, e sem `-o` o build
falha. É o ADR 0014 do Sandcastle.

`USER` é numérico, e não `USER agent`, para que
`docker image inspect --format '{{.Config.User}}'` devolva um `UID:GID` parseável. O
preflight do runtime compara esse valor com o UID do worker e avisa quando a imagem foi
construída para outro dono, em vez de deixar o Run terminar sem espólio nenhum e sem
explicação.

Os diretórios de configuração das CLIs (`~/.claude`, `~/.codex`, `~/.pi/agent`) nascem no
build com o dono certo. Sem isso, um bind mount de **arquivo** dentro de um diretório
inexistente faz o Docker criar o pai como `root:root`, e o agente não consegue nem
atravessá-lo — é a causa-raiz B do mesmo ADR 0014.

## Por que não há `ENTRYPOINT`

O Sandcastle usa `ENTRYPOINT ["sleep","infinity"]` com `docker run -d` mais `docker exec`,
mantendo um container longevo. Aqui é um `docker run --rm` por Run, e o comando é o argv
completo da CLI — o mesmo que o adapter de host monta.

Dois motivos. O `docker exec` não aceita `-e`, e por isso o `env` do provider não chega a
um container longevo (documento técnico, seção 18.1); e o `--rm` já é metade da limpeza,
o que custa cerca de um segundo por Run.

## O que o container enxerga

Só o que foi montado de propósito:

- o **worktree do Run** em `/home/agent/workspace`, read-write;
- o `.git` do repositório pai em `/.dungeon-master-parent-git`, read-write, quando o
  checkout for um worktree — é o que faz `git status` funcionar lá dentro e o commit
  aparecer no host sem passo de sincronização;
- o arquivo de credencial, read-only, quando for esse o caminho escolhido.

Nunca o home do usuário e nunca o repositório inteiro. É a regra da seção 31 do documento
técnico, e ela é o que separa "o agente tem liberdade dentro do container" de "o agente
tem liberdade".
