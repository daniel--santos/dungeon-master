CREATE TYPE "public"."mcp_transport" AS ENUM('STDIO', 'HTTP');--> statement-breakpoint
CREATE TYPE "public"."provider_kind" AS ENUM('SUBSCRIPTION', 'API_KEY', 'LOCAL');--> statement-breakpoint
CREATE TYPE "public"."tool_kind" AS ENUM('COMMAND', 'MCP_TOOL');--> statement-breakpoint
CREATE TABLE "mcp_server" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"transport" "mcp_transport" NOT NULL,
	"command" text,
	"args" jsonb NOT NULL,
	"url" text,
	"env_keys" jsonb NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_server_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "mcp_server_transport_shape_ck" CHECK (("transport" = 'STDIO' and "command" is not null and "url" is null) or ("transport" = 'HTTP' and "url" is not null and "command" is null))
);
--> statement-breakpoint
CREATE TABLE "provider" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "provider_kind" NOT NULL,
	"auth_env_keys" jsonb NOT NULL,
	"harness_keys" jsonb NOT NULL,
	"docs_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_user_name_uq" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "skill_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"changelog" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_version_skill_version_uq" UNIQUE("skill_id","version"),
	CONSTRAINT "skill_version_positive_ck" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "skill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "skill_latest_version_positive_ck" CHECK ("latest_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "tool" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "tool_kind" NOT NULL,
	"command" text,
	"mcp_server_id" uuid,
	"tool_name" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_user_name_uq" UNIQUE("user_id","name"),
	CONSTRAINT "tool_kind_shape_ck" CHECK (("kind" = 'COMMAND' and "command" is not null and "mcp_server_id" is null and "tool_name" is null) or ("kind" = 'MCP_TOOL' and "mcp_server_id" is not null and "tool_name" is not null and "command" is null))
);
--> statement-breakpoint
CREATE TABLE "loadout_mcp" (
	"user_id" uuid NOT NULL,
	"loadout_id" uuid NOT NULL,
	"mcp_server_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "loadout_mcp_pk" PRIMARY KEY("loadout_id","mcp_server_id")
);
--> statement-breakpoint
CREATE TABLE "loadout_skill" (
	"user_id" uuid NOT NULL,
	"loadout_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"pinned_version" integer,
	"position" integer NOT NULL,
	CONSTRAINT "loadout_skill_pk" PRIMARY KEY("loadout_id","skill_id"),
	CONSTRAINT "loadout_skill_pin_positive_ck" CHECK ("pinned_version" is null or "pinned_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "loadout_tool" (
	"user_id" uuid NOT NULL,
	"loadout_id" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "loadout_tool_pk" PRIMARY KEY("loadout_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "loadout_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"loadout_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loadout_version_loadout_version_uq" UNIQUE("loadout_id","version"),
	CONSTRAINT "loadout_version_positive_ck" CHECK ("version" > 0)
);
--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "provider_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_server" ADD CONSTRAINT "mcp_server_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider" ADD CONSTRAINT "provider_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version" ADD CONSTRAINT "skill_version_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill" ADD CONSTRAINT "skill_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool" ADD CONSTRAINT "tool_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool" ADD CONSTRAINT "tool_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_mcp" ADD CONSTRAINT "loadout_mcp_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_mcp" ADD CONSTRAINT "loadout_mcp_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_mcp" ADD CONSTRAINT "loadout_mcp_mcp_server_id_mcp_server_id_fk" FOREIGN KEY ("mcp_server_id") REFERENCES "public"."mcp_server"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_skill" ADD CONSTRAINT "loadout_skill_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_skill" ADD CONSTRAINT "loadout_skill_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_skill" ADD CONSTRAINT "loadout_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_tool" ADD CONSTRAINT "loadout_tool_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_tool" ADD CONSTRAINT "loadout_tool_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_tool" ADD CONSTRAINT "loadout_tool_tool_id_tool_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tool"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_version" ADD CONSTRAINT "loadout_version_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loadout_version" ADD CONSTRAINT "loadout_version_loadout_id_loadout_id_fk" FOREIGN KEY ("loadout_id") REFERENCES "public"."loadout"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tool_mcp_server_idx" ON "tool" USING btree ("mcp_server_id");--> statement-breakpoint
CREATE INDEX "loadout_mcp_server_idx" ON "loadout_mcp" USING btree ("mcp_server_id");--> statement-breakpoint
CREATE INDEX "loadout_skill_skill_idx" ON "loadout_skill" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "loadout_tool_tool_idx" ON "loadout_tool" USING btree ("tool_id");--> statement-breakpoint
ALTER TABLE "model" ADD CONSTRAINT "model_provider_id_provider_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_provider_idx" ON "model" USING btree ("provider_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Migração de dados (escrita à mão; o gerador só emite o diff de schema acima).
--
-- O que estava em `jsonb` no Loadout vira linha nos registros da Fase 8A:
--
-- 1. `harness.capabilities` ganha `mcpServers` e `forkSession`, que o contrato
--    passou a exigir. O que o preflight do Worker já gravou vence; o que falta
--    recebe o valor que o adapter de cada Harness declara hoje.
-- 2. Cada string de `loadout.skills` vira uma Skill (uma por nome, dentro do
--    usuário) com conteúdo vazio na versão 1, e uma linha em `loadout_skill`
--    sem pin, na ordem do array.
-- 3. Cada string de `loadout.tools` vira uma Tool `COMMAND` cujo comando é o
--    próprio nome: era o único sentido que a Fase 2 dava à lista.
-- 4. Cada `McpServerRef` inline vira um `mcp_server`: o `target` do `STDIO` é
--    quebrado por espaço em comando e argumentos, como o Worker fazia; o do
--    `HTTP` vira `url`. Servidores iguais em Loadouts diferentes viram uma
--    linha só; nomes iguais com definição diferente ganham sufixo `-2`, `-3`.
-- 5. `loadout_version` recebe uma linha por Loadout com a versão atual e a
--    definição por referências, para o histórico começar de onde está.
--
-- Os ids são UUIDv7, como manda a seção 4 do CLAUDE.md, mas gerados aqui em SQL
-- porque a migração não tem `newId()`: a função temporária põe os 48 bits de
-- milissegundos na frente de um v4 e marca a versão 7. Ela morre com a sessão.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.dm_uuid_v7() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;--> statement-breakpoint
UPDATE "harness"
SET "capabilities" = jsonb_build_object(
  'mcpServers', ("key" IN ('CLAUDE_CODE', 'CODEX')),
  'forkSession', ("key" = 'CLAUDE_CODE')
) || "capabilities"
WHERE NOT ("capabilities" ? 'mcpServers') OR NOT ("capabilities" ? 'forkSession');--> statement-breakpoint
INSERT INTO "skill" ("id", "user_id", "name", "description", "latest_version", "created_at", "updated_at")
SELECT
  pg_temp.dm_uuid_v7(),
  s."user_id",
  s."name",
  'Criada pela migração 0015 a partir do nome que o Loadout guardava. Sem conteúdo até alguém publicar uma versão.',
  1,
  now(),
  now()
FROM (
  SELECT DISTINCT l."user_id", left(trim(x.value), 200) AS "name"
  FROM "loadout" l
  CROSS JOIN LATERAL jsonb_array_elements_text(l."skills") AS x(value)
  WHERE trim(x.value) <> ''
) s
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "skill_version" ("id", "user_id", "skill_id", "version", "content", "changelog", "created_at")
SELECT
  pg_temp.dm_uuid_v7(),
  sk."user_id",
  sk."id",
  1,
  '',
  'Versão inicial criada pela migração 0015: o Loadout só guardava o nome.',
  now()
FROM "skill" sk
WHERE NOT EXISTS (SELECT 1 FROM "skill_version" v WHERE v."skill_id" = sk."id");--> statement-breakpoint
INSERT INTO "loadout_skill" ("user_id", "loadout_id", "skill_id", "pinned_version", "position")
SELECT l."user_id", l."id", sk."id", NULL, (x.ordinality - 1)::integer
FROM "loadout" l
CROSS JOIN LATERAL jsonb_array_elements_text(l."skills") WITH ORDINALITY AS x(value, ordinality)
JOIN "skill" sk ON sk."user_id" = l."user_id" AND sk."name" = left(trim(x.value), 200)
WHERE trim(x.value) <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "tool" ("id", "user_id", "name", "kind", "command", "mcp_server_id", "tool_name", "description", "created_at", "updated_at")
SELECT
  pg_temp.dm_uuid_v7(),
  t."user_id",
  t."name",
  'COMMAND',
  t."name",
  NULL,
  NULL,
  'Criada pela migração 0015 a partir do nome que o Loadout guardava, como comando liberado.',
  now(),
  now()
FROM (
  SELECT DISTINCT l."user_id", left(trim(x.value), 200) AS "name"
  FROM "loadout" l
  CROSS JOIN LATERAL jsonb_array_elements_text(l."tools") AS x(value)
  WHERE trim(x.value) <> ''
) t
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "loadout_tool" ("user_id", "loadout_id", "tool_id", "position")
SELECT l."user_id", l."id", tl."id", (x.ordinality - 1)::integer
FROM "loadout" l
CROSS JOIN LATERAL jsonb_array_elements_text(l."tools") WITH ORDINALITY AS x(value, ordinality)
JOIN "tool" tl ON tl."user_id" = l."user_id" AND tl."name" = left(trim(x.value), 200)
WHERE trim(x.value) <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint
WITH refs AS (
  SELECT
    l."user_id",
    l."id" AS loadout_id,
    l."created_at",
    x.ordinality,
    left(trim(x.value ->> 'name'), 63) AS "name",
    CASE WHEN x.value ->> 'transport' = 'HTTP' THEN 'HTTP' ELSE 'STDIO' END AS transport,
    coalesce(trim(x.value ->> 'target'), '') AS target
  FROM "loadout" l
  CROSS JOIN LATERAL jsonb_array_elements(l."mcp_servers") WITH ORDINALITY AS x(value, ordinality)
  WHERE coalesce(trim(x.value ->> 'name'), '') <> ''
),
groups AS (
  SELECT "user_id", "name", transport, target, min("created_at") AS first_seen
  FROM refs
  GROUP BY "user_id", "name", transport, target
),
named AS (
  SELECT
    "user_id", "name", transport, target,
    CASE WHEN rn = 1 THEN "name" ELSE "name" || '-' || rn::text END AS server_name
  FROM (
    SELECT g.*, row_number() OVER (PARTITION BY g."user_id", g."name" ORDER BY g.first_seen, g.transport, g.target) AS rn
    FROM groups g
  ) ranked
),
inserted AS (
  INSERT INTO "mcp_server" ("id", "user_id", "name", "transport", "command", "args", "url", "env_keys", "read_only", "built_in", "description", "created_at", "updated_at")
  SELECT
    pg_temp.dm_uuid_v7(),
    n."user_id",
    n.server_name,
    n.transport::"mcp_transport",
    CASE WHEN n.transport = 'HTTP' THEN NULL ELSE coalesce((regexp_split_to_array(n.target, '\s+'))[1], '') END,
    CASE WHEN n.transport = 'HTTP' THEN '[]'::jsonb ELSE coalesce(to_jsonb((regexp_split_to_array(n.target, '\s+'))[2:]), '[]'::jsonb) END,
    CASE WHEN n.transport = 'HTTP' THEN n.target ELSE NULL END,
    '[]'::jsonb,
    false,
    false,
    'Criado pela migração 0015 a partir do servidor inline do Loadout.',
    now(),
    now()
  FROM named n
  RETURNING "id", "user_id", "name"
)
INSERT INTO "loadout_mcp" ("user_id", "loadout_id", "mcp_server_id", "position")
SELECT r."user_id", r.loadout_id, i."id", (r.ordinality - 1)::integer
FROM refs r
JOIN named n
  ON n."user_id" = r."user_id" AND n."name" = r."name" AND n.transport = r.transport AND n.target = r.target
JOIN inserted i ON i."user_id" = n."user_id" AND i."name" = n.server_name
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "loadout_version" ("id", "user_id", "loadout_id", "version", "definition", "created_at")
SELECT
  pg_temp.dm_uuid_v7(),
  l."user_id",
  l."id",
  l."version",
  jsonb_build_object(
    'name', l."name",
    'agentId', l."agent_id",
    'harnessId', l."harness_id",
    'modelId', l."model_id",
    'executionProfileId', l."execution_profile_id",
    'skillRefs', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('skillId', ls."skill_id", 'pinnedVersion', ls."pinned_version") ORDER BY ls."position")
       FROM "loadout_skill" ls WHERE ls."loadout_id" = l."id"),
      '[]'::jsonb
    ),
    'toolIds', coalesce(
      (SELECT jsonb_agg(lt."tool_id" ORDER BY lt."position") FROM "loadout_tool" lt WHERE lt."loadout_id" = l."id"),
      '[]'::jsonb
    ),
    'mcpServerIds', coalesce(
      (SELECT jsonb_agg(lm."mcp_server_id" ORDER BY lm."position") FROM "loadout_mcp" lm WHERE lm."loadout_id" = l."id"),
      '[]'::jsonb
    ),
    'knowledgePolicy', l."knowledge_policy",
    'contextPolicy', l."context_policy",
    'isDefault', l."is_default"
  ),
  l."updated_at"
FROM "loadout" l
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP FUNCTION pg_temp.dm_uuid_v7();--> statement-breakpoint
ALTER TABLE "loadout" DROP COLUMN "skills";--> statement-breakpoint
ALTER TABLE "loadout" DROP COLUMN "tools";--> statement-breakpoint
ALTER TABLE "loadout" DROP COLUMN "mcp_servers";