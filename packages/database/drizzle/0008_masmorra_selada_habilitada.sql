-- Fase 2C: o perfil "Masmorra selada" nasce ligado.
--
-- Migração de dados, e não de schema. Ela existe porque `db:seed` é idempotente
-- pela chave natural e **respeita o que já existe**: quem editou o nome de um
-- perfil ou desligou um harness fez isso de propósito, e a semente não desfaz.
-- A consequência é que um banco semeado antes desta fase manteria a "Masmorra
-- selada" desligada para sempre, e o modo `DOCKER` ficaria implementado e
-- inalcançável pela interface.
--
-- O critério de "não foi o usuário que mexeu" é estreito de propósito: só o
-- perfil ainda idêntico à semente antiga — mesmo nome, modo `DOCKER`,
-- `SANDBOX_ENFORCED`, desligado, não padrão e com a política de permissão
-- default — é tocado. Um perfil que alguém já ajustou fica como está.

UPDATE "execution_profile"
SET
  "enabled" = true,
  -- `commandExecution: ALL` com `enforcement = SANDBOX_ENFORCED` é o que concede
  -- `bypass` sem o opt-in inseguro: dentro do container quem impõe a fronteira é
  -- o container, e não a CLI. `allow_unsafe_bypass` continua ausente de
  -- propósito — ele é a porta de bypass *sem* isolamento.
  "permission_policy" = jsonb_build_object(
    'workspaceWrite', true,
    'commandExecution', 'ALL',
    'allowedCommands', '[]'::jsonb,
    'deniedCommands', '[]'::jsonb
  ),
  "updated_at" = now()
WHERE
  "name" = 'Masmorra selada'
  AND "mode" = 'DOCKER'
  AND "enforcement" = 'SANDBOX_ENFORCED'
  AND "enabled" = false
  AND "is_default" = false
  -- `DEFAULT_PERMISSION_POLICY`, que é com o que a semente antiga criou o perfil.
  AND "permission_policy" = jsonb_build_object(
    'workspaceWrite', true,
    'commandExecution', 'ALLOWLIST',
    'allowedCommands', '[]'::jsonb,
    'deniedCommands', '[]'::jsonb
  );

--> statement-breakpoint

-- A matriz de capabilities acerta o eixo `dockerExecution`, que até aqui era uma
-- promessa da semente e não um fato do código.
--
-- O ADR 0001 decidiu quem entra: **Claude Code** e **Pi** têm caminho de
-- credencial provado dentro do container e ganham adapter (`claude-code@docker`,
-- `pi@docker`); o **Codex** ficou experimental, porque o único caminho provado
-- nele é montar `~/.codex/auth.json`, cujo conteúdo o sanitizador de credenciais
-- não sabe redigir. Não existe `codex@docker`.
--
-- Sem isto, a interface ofereceria "Masmorra selada" para o Codex e o Run seria
-- recusado na partida; e esconderia a opção do Claude Code, que funciona. O
-- preflight de boot do Worker regrava esta coluna a partir do adapter, mas só
-- quando o Worker sobe: quem abrir a tela de Guildas antes disso precisa ver a
-- verdade.
--
-- Só o campo `dockerExecution` é tocado, e só nas linhas que ainda carregam o
-- valor anterior.
UPDATE "harness"
SET
  "capabilities" = jsonb_set("capabilities", '{dockerExecution}', 'true'::jsonb),
  "updated_at" = now()
WHERE
  "key" IN ('CLAUDE_CODE', 'PI')
  AND "capabilities" ->> 'dockerExecution' = 'false';

--> statement-breakpoint

UPDATE "harness"
SET
  "capabilities" = jsonb_set("capabilities", '{dockerExecution}', 'false'::jsonb),
  "updated_at" = now()
WHERE
  "key" = 'CODEX'
  AND "capabilities" ->> 'dockerExecution' = 'true';
