-- Fase 3: o harness Antigravity nasce ligado, com a matriz que o spike mediu.
--
-- Migração de dados, e não de schema, pelo mesmo motivo da 0008: `db:seed` é
-- idempotente pela chave natural e **respeita o que já existe**. Um banco
-- semeado antes da Fase 3 manteria `ANTIGRAVITY` desligado para sempre, e o
-- adapter ficaria implementado e inalcançável pela interface.
--
-- O critério de "não foi o usuário que mexeu" é a matriz antiga inteira: só a
-- linha que ainda carrega exatamente o que a semente da Fase 2 escreveu é
-- tocada. Quem desligou o harness depois de ele já estar ligado, ou ajustou a
-- matriz à mão, fica como está.

UPDATE "harness"
SET
  "enabled" = true,
  -- Três campos caem em relação ao que a semente prometia antes de existir
  -- adapter, e os três para menos:
  --
  -- `nativePermissions` -> false. O `agy` 1.1.27 tem allow-list de comando em
  -- `settings.json` (`permissions.allow`, com regras `command(git)`), mas em
  -- modo headless (`-p`) ela não é consultada: todo `run_command` é auto-negado
  -- nos quatro valores de `toolPermission`, com as regras carregadas. O único
  -- interruptor que funciona sem interface é `--dangerously-skip-permissions`,
  -- que libera tudo. Não há degrau de allow-list para traduzir.
  --
  -- `agentSelection` -> false. A flag `--agent` existe, mas `agy agents` não
  -- lista agente nenhum, e a matriz só promete o que a suíte exercita.
  --
  -- `dockerExecution` fica em false. A credencial do `agy` vem do chaveiro do
  -- sistema, e levá-la para dentro de um container é o gate da Fase 3D.
  "capabilities" = jsonb_set(
    jsonb_set("capabilities", '{nativePermissions}', 'false'::jsonb),
    '{agentSelection}',
    'false'::jsonb
  ),
  "updated_at" = now()
WHERE
  "key" = 'ANTIGRAVITY'
  AND "enabled" = false
  AND "capabilities" = jsonb_build_object(
    'streaming', true,
    'structuredOutput', true,
    'resume', true,
    'multiTurnProcess', false,
    'toolEvents', true,
    'tokenUsage', true,
    'modelSelection', true,
    'agentSelection', true,
    'nativePermissions', true,
    'hostExecution', true,
    'dockerExecution', false
  );
