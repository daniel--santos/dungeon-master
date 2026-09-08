-- Migração de dados: nenhuma mudança de schema.
--
-- A allow-list padrão do perfil "Campo aberto" deixou de ser `git` inteiro mais
-- `ls`, `cat` e `node`, e passou a ser cinco subcomandos de git. A semente só
-- insere perfil que não existe, nunca atualiza o que já está lá, então quem
-- instalou antes continuaria com `git push` e `git reset --hard` liberados —
-- exatamente os dois comandos que a mudança existe para fechar.
--
-- A condição é igualdade exata com a lista antiga, e não um `contains`: um
-- perfil que o usuário personalizou é escolha dele, e sobrescrevê-la seria
-- desfazer trabalho de gente para aplicar um padrão nosso. Quem editou a lista
-- fica como está, mesmo que ainda tenha `git` inteiro.
UPDATE "execution_profile"
SET "permission_policy" = jsonb_set(
  "permission_policy",
  '{allowedCommands}',
  '["git add", "git commit", "git status", "git diff", "git log"]'::jsonb
)
WHERE "permission_policy" -> 'allowedCommands' = '["git", "ls", "cat", "node"]'::jsonb;
