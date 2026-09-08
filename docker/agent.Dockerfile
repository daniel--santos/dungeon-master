# Imagem de referência do agente para o modo de execução DOCKER ("Masmorra selada").
#
# O contrato desta imagem está documentado em `docker/README.md`. O resumo:
#
# - **Nenhuma credencial mora aqui.** A imagem é construída sem segredo nenhum e
#   pode ser publicada. A credencial do harness entra em tempo de execução, pelo
#   mecanismo decidido no ADR `docs/adr/0001-autenticacao-em-docker.md`.
# - **UID/GID são build args**, no contrato do Sandcastle (`.sandcastle/Dockerfile`,
#   ADR 0005 e ADR 0014 de lá): o usuário `node` da imagem base é renomeado para
#   `agent` e realinhado, de modo que os arquivos escritos no bind mount saiam com
#   o dono certo **sem `chown` em tempo de execução**. `groupmod -o` e `usermod -o`
#   são obrigatórios: no macOS o GID primário do usuário é 20 (`staff`), que a
#   imagem base já entrega a `dialout`, e sem `-o` o build morre.
# - **`USER` é numérico**, e não `USER agent`, para que
#   `docker image inspect --format '{{.Config.User}}'` devolva um `UID:GID`
#   parseável. O preflight do runtime compara esse valor com o UID do worker e
#   avisa quando a imagem foi construída para outro dono.
#
# Origem da técnica: `@ai-hero/sandcastle` v0.12.0, `.sandcastle/Dockerfile`
# (MIT, © 2026 Matt Pocock) — https://github.com/mattpocock/sandcastle
# Changes: base Node 24 em vez de 22; CLIs instaladas por npm com versão fixa em
# vez de instalador remoto; `gh` removido; `ENTRYPOINT ["sleep","infinity"]`
# removido porque aqui o container é de uma execução só (`docker run --rm`), e não
# um container longevo com `docker exec`; diretórios de configuração das CLIs
# criados no build para que um file mount não os crie como `root:root`.
# Veja `THIRD_PARTY_NOTICES.md`.

FROM node:24-bookworm-slim

# Alinhamento de dono com o host. No Windows não existe UID, e o worker manda
# 1000:1000; no Linux e no macOS o worker manda o UID/GID reais.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Versões fixas. Subir uma versão é editar aqui e reconstruir: a imagem é o
# registro de qual CLI o Run usou.
ARG CLAUDE_CODE_VERSION=2.1.263
ARG CODEX_VERSION=0.147.0
ARG PI_VERSION=0.85.1

# `git` é requisito do modo: o worktree do Run chega por bind mount e o agente
# commita lá dentro. `procps` entrega o `ps` que o diagnóstico usa. `ripgrep` é
# dependência de fato das três CLIs para busca em código.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    procps \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

# As CLIs ficam em `/usr/local`, propriedade do root: o agente as executa e não
# consegue reescrevê-las de dentro do container.
RUN npm install -g --no-fund --no-audit \
    "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    "@openai/codex@${CODEX_VERSION}" \
    "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  && npm cache clean --force

# Renomeia `node` para `agent` e realinha UID/GID. `-o` (não único) é obrigatório;
# veja o cabeçalho.
RUN groupmod -o -g "${AGENT_GID}" node \
  && usermod -o -u "${AGENT_UID}" -g "${AGENT_GID}" -d /home/agent -m -l agent node

# Os diretórios de configuração nascem aqui, com o dono certo, porque um bind
# mount de arquivo dentro de um diretório inexistente faz o Docker criar o pai
# como `root:root` e o agente não consegue nem atravessá-lo.
RUN mkdir -p \
    /home/agent/workspace \
    /home/agent/.claude \
    /home/agent/.codex \
    /home/agent/.pi/agent \
    /home/agent/.config \
  && chown -R "${AGENT_UID}:${AGENT_GID}" /home/agent

USER ${AGENT_UID}:${AGENT_GID}

# `HOME` explícito: com `--user <uid>` o Docker não consulta `/etc/passwd`, e sem
# isto `HOME` viraria `/` e `git config --global` falharia.
ENV HOME=/home/agent \
    npm_config_update_notifier=false \
    CI=1

# O git precisa ser avisado de que estes dois diretórios são confiáveis, senão
# recusa o repositório com "detected dubious ownership" e o agente não commita.
#
# A causa é do bind mount, e não nossa: no Windows, o Docker Desktop apresenta
# todo arquivo montado como `root:root` com modo 0777 dentro do container,
# independentemente da permissão no host (medido em 07/09/2026 com o Docker
# Desktop 29.7.2 sobre WSL2). O processo do agente é uid 1000, vê um repositório
# de outro dono, e o git para — mesmo podendo escrever, porque o modo é 0777.
#
# Os dois caminhos são pontos de montagem fixos **desta** imagem, e não caminhos
# do host: a exceção é estreita e não vale para nada que o usuário monte por
# conta. As alternativas seriam piores — rodar como root, ou o `chown -R` de
# partida que o ADR 0005 do Sandcastle removeu justamente por ser caro e
# destrutivo.
RUN git config --global --add safe.directory /home/agent/workspace \
  && git config --global --add safe.directory /.dungeon-master-parent-git \
  && git config --global --add safe.directory '/.dungeon-master-parent-git/*'

# O worktree do Run é montado aqui. O `-w` do `docker run` repete o caminho, mas
# deixar o padrão certo torna a imagem utilizável à mão para depurar.
WORKDIR /home/agent/workspace

# Sem `ENTRYPOINT`: o comando do Run é o argv completo da CLI, montado pelo mesmo
# adapter que roda no host.
CMD ["bash"]
