# A imagem de referência do agente

`agent.Dockerfile` constrói `dungeon-master-agent:0.2.0`, a imagem que o modo de execução
`DOCKER` ("Masmorra selada") usa para rodar um Run dentro de um container.

```bash
pnpm docker:build                        # constrói com a tag padrão
pnpm docker:build -- --no-cache          # ignora o cache de camadas
pnpm docker:build -- --image outra:tag   # outra tag
```

Medido em 07/09/2026, Windows 11 com Docker Desktop 29.7.2 (WSL2), na mesma máquina e na
mesma sessão, para que a comparação signifique alguma coisa:

| Medida                           | `0.1.0` (três CLIs) | `0.2.0` (com o `agy`) |
| -------------------------------- | ------------------- | --------------------- |
| Build do zero (`--no-cache`)     | 68 s                | 91 s                  |
| Tamanho da imagem                | 1,28 GB             | 1,49 GB               |
| Partida de um container (`--rm`) | 0,7 – 1,1 s         | 0,9 – 1,9 s           |

Os 210 MB e os 23 segundos a mais são o binário do Antigravity, que é um executável Go
único desse tamanho. O segundo build, com cache, é quase instantâneo; o número acima é o
pior caso, que é o que alguém enfrenta na primeira vez.

## O que está dentro

`node:24-bookworm-slim`, mais `git`, `curl`, `procps` e `ripgrep`, mais as quatro CLIs em
versão fixa — as mesmas do host em que o modo foi provado:

| CLI         | Origem                                         | Versão  |
| ----------- | ---------------------------------------------- | ------- |
| Claude Code | npm `@anthropic-ai/claude-code`                | 2.1.263 |
| Codex       | npm `@openai/codex`                            | 0.147.0 |
| Pi          | npm `@earendil-works/pi-coding-agent`          | 0.85.1  |
| Antigravity | objeto versionado do Google, SHA-512 conferido | 1.1.27  |

Subir uma versão é editar o `ARG` correspondente e reconstruir. A imagem é o registro de
qual CLI o Run usou, e é por isso que as versões são fixas: um `@latest` faria dois Runs
do mesmo dia rodarem em ferramentas diferentes sem nada no diário dizendo isso.

O Antigravity não é pacote npm, e o instalador oficial
(`curl … antigravity.google/cli/install.sh | bash`) busca **sempre o último** release, o
que quebraria essa regra. A imagem, em vez de rodar o instalador, baixa o objeto que o
manifesto dele aponta e confere o SHA-512 publicado ali:

```bash
curl -fsSL https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json
# { "version": "1.1.27", "url": "https://storage.googleapis.com/…", "sha512": "793d4b…" }
```

Subir de versão é reler esse manifesto e trocar `ANTIGRAVITY_VERSION`, `ANTIGRAVITY_URL` e
`ANTIGRAVITY_SHA512` juntos. O tarball traz um único executável chamado `antigravity`, que
é instalado como `/usr/local/bin/agy` — o nome que o instalador oficial usa e que o adapter
chama.

Esquecer uma das três linhas é o erro fácil, e ele é caro: a imagem passaria a registrar
uma versão que não é a que está lá dentro. Por isso o build termina o passo com
`test "$(agy --version)" = "${ANTIGRAVITY_VERSION}"` e morre na divergência — verificado
com `--build-arg ANTIGRAVITY_VERSION=9.9.9`, que falha o build.

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

Existe uma terceira forma, e ela é o contrário das outras duas: `fixedEnv` escreve
`-e NOME=VALOR` no argv de propósito, para **configurar** a CLI para dentro do container —
um interruptor de modo, ou um caminho do sistema de arquivos do container que o ambiente do
host não teria como conhecer. Justamente por escrever o valor no argv, **nada que seja
segredo pode ir por ali**. O caso que a criou é o Antigravity, em
[`docs/adr/0002-antigravity-em-docker.md`](../docs/adr/0002-antigravity-em-docker.md).

O Antigravity é o único dos quatro que **não** entra no modo `DOCKER`: ele guarda a
credencial no cofre do sistema operacional, e não em arquivo, e o único caminho não
interativo que existe (Application Default Credentials do Google) não foi provado de ponta
a ponta. O ADR 0002 tem o veredito, as medições e o comando exato que fecharia o gate.

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

Os diretórios de configuração das CLIs (`~/.claude`, `~/.codex`, `~/.pi/agent`, `~/.gemini`) nascem no
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
