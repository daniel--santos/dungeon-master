import type { CommandAccess } from "@dungeon-master/contracts";
import { Ban, KeyRound, SlidersHorizontal, Terminal, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ChipInput } from "@/components/execution/chip-input";
import type { ExecutionProfileRecord } from "@/lib/api-types";
import { EnforcementText } from "@/components/execution/chips";
import { EnvBadge } from "@/components/execution/env-badge";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WORKSPACE_STRATEGY } from "@/lib/execution-domain";
import { useExecutionProfiles, useUpdateExecutionProfile } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * Os perfis de execução: onde e sob quais regras um Run roda.
 *
 * `mode` e `workspaceStrategy` são eixos ortogonais — worktree não é backend de
 * execução —, e por isso aparecem lado a lado em vez de num campo só. O
 * `enforcement` fica ao lado das políticas de propósito: é ele que diz se o que
 * está escrito abaixo é uma barreira ou um pedido.
 */
export function ProfilePanel() {
  const { t, format } = useGlossary();
  const profiles = useExecutionProfiles();
  const [editing, setEditing] = useState<ExecutionProfileRecord | null>(null);

  const items = profiles.data?.items ?? [];

  return (
    <Panel className="flex flex-col px-5 pt-4 pb-3.5">
      <div className="flex items-center justify-between pb-1.5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal aria-hidden className="text-muted-foreground size-3.75" />
          <span className="text-sm font-medium">{t("entity.executionProfile.plural")}</span>
        </div>
        <span className="text-muted-foreground text-xs">
          {format("Cadastro fechado desta fase: {n} perfis", { n: items.length })}
        </span>
      </div>

      {profiles.isPending && <p className="text-muted-foreground py-6 text-sm">Lendo…</p>}
      {profiles.error !== null && (
        <p className="text-destructive py-6 text-sm">{profiles.error.message}</p>
      )}

      {items.map((profile, index) => (
        <ProfileRow
          key={profile.id}
          first={index === 0}
          onEdit={() => {
            setEditing(profile);
          }}
          profile={profile}
        />
      ))}

      <ProfileDialog
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        profile={editing}
      />
    </Panel>
  );
}

function ProfileRow({
  profile,
  first,
  onEdit,
}: {
  profile: ExecutionProfileRecord;
  first: boolean;
  onEdit: () => void;
}) {
  const { t, format } = useGlossary();
  // O perfil Docker nasce desligado e é ligado na Fase 2C, quando existir um
  // adapter que saiba subir o container.
  const waitingPhase = profile.mode === "DOCKER" && !profile.enabled;

  return (
    <div
      className={cn("flex flex-col gap-2 py-3", !first && "border-border border-t")}
      data-execution-profile={profile.name}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          className={cn("text-[13px] font-medium", !profile.enabled && "text-muted-foreground")}
        >
          {profile.name}
        </span>
        {profile.isDefault && <span className="text-muted-foreground text-[10px]">padrão</span>}

        <div className="flex-1" />

        {waitingPhase && (
          <span className="border-border text-muted-foreground inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[10.5px]">
            <Ban aria-hidden className="size-2.75" />
            <span>Fase 2C</span>
          </span>
        )}

        <Button disabled={waitingPhase} onClick={onEdit} size="sm" variant="ghost">
          Editar políticas
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <EnvBadge mode={profile.mode} size="sm" />
        <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <span>Workspace</span>
          <span className="text-foreground">
            {t(WORKSPACE_STRATEGY[profile.workspaceStrategy])}
          </span>
        </span>
        <span className="text-[11px]">
          <EnforcementText level={profile.enforcement} />
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span>
          {format("Comandos: {access}", { access: profile.permissionPolicy.commandExecution })}
          {profile.permissionPolicy.commandExecution === "ALLOWLIST" &&
            format(" · {n} liberados", { n: profile.permissionPolicy.allowedCommands.length })}
        </span>
        <span>
          {format("Ambiente: {n} variáveis{path}", {
            n: profile.environmentPolicy.allowedVariables.length,
            path: profile.environmentPolicy.inheritPath ? " + PATH" : "",
          })}
        </span>
        <span>{format("Rede: {access}", { access: profile.networkPolicy.access })}</span>
      </div>
    </div>
  );
}

const COMMAND_ACCESS: readonly CommandAccess[] = ["NONE", "ALLOWLIST", "ALL"];

/**
 * A edição das duas políticas que a Fase 2B usa de verdade.
 *
 * A política de rede fica de fora porque só é imposta em `SANDBOX_ENFORCED`, e
 * oferecer um campo que não muda nada seria mentir sobre o que o produto faz.
 */
function ProfileDialog({
  profile,
  onOpenChange,
}: {
  profile: ExecutionProfileRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, format } = useGlossary();
  const update = useUpdateExecutionProfile();

  const [workspaceWrite, setWorkspaceWrite] = useState(true);
  const [commandExecution, setCommandExecution] = useState<CommandAccess>("ALLOWLIST");
  const [allowedCommands, setAllowedCommands] = useState<readonly string[]>([]);
  const [deniedCommands, setDeniedCommands] = useState<readonly string[]>([]);
  const [allowedVariables, setAllowedVariables] = useState<readonly string[]>([]);
  const [inheritPath, setInheritPath] = useState(true);

  useEffect(() => {
    if (profile === null) return;
    setWorkspaceWrite(profile.permissionPolicy.workspaceWrite);
    setCommandExecution(profile.permissionPolicy.commandExecution);
    setAllowedCommands(profile.permissionPolicy.allowedCommands);
    setDeniedCommands(profile.permissionPolicy.deniedCommands);
    setAllowedVariables(profile.environmentPolicy.allowedVariables);
    setInheritPath(profile.environmentPolicy.inheritPath);
  }, [profile]);

  function save() {
    if (profile === null) return;
    update.mutate(
      {
        id: profile.id,
        permissionPolicy: {
          workspaceWrite,
          commandExecution,
          allowedCommands: [...allowedCommands],
          deniedCommands: [...deniedCommands],
        },
        environmentPolicy: { allowedVariables: [...allowedVariables], inheritPath },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
        onError: (error: Error) => {
          toast.error(error.message);
        },
      },
    );
  }

  return (
    <Dialog open={profile !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{profile?.name ?? ""}</DialogTitle>
          <DialogDescription>
            {profile === null
              ? ""
              : format(
                  "O que o {agent} pode fazer, e o que chega ao processo dele. O quanto disso é imposto depende do enforcement do perfil.",
                  { agent: t("entity.agent") },
                )}
          </DialogDescription>
        </DialogHeader>

        {profile !== null && (
          <div className="flex flex-col gap-5">
            <div className="border-border flex flex-wrap items-center gap-3 rounded-lg border bg-white/[0.03] px-3 py-2.5">
              <EnvBadge mode={profile.mode} size="sm" />
              <span className="text-[11px]">
                <EnforcementText level={profile.enforcement} />
              </span>
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium">Permissões</span>

              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox
                  checked={workspaceWrite}
                  onCheckedChange={(checked) => {
                    setWorkspaceWrite(checked === true);
                  }}
                />
                <span>Escrever no workspace</span>
              </label>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="profile-commands">Rodar comandos</Label>
                <Select
                  value={commandExecution}
                  onValueChange={(next) => {
                    setCommandExecution(next as CommandAccess);
                  }}
                >
                  <SelectTrigger aria-label="Rodar comandos" className="w-52" id="profile-commands">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMAND_ACCESS.map((access) => (
                      <SelectItem key={access} value={access}>
                        {access}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {commandExecution === "ALLOWLIST" && (
                <ChipInput
                  icon={Terminal}
                  label="Comandos liberados"
                  onChange={setAllowedCommands}
                  placeholder="Adicionar"
                  values={allowedCommands}
                />
              )}

              <ChipInput
                icon={Wrench}
                label="Comandos recusados"
                onChange={setDeniedCommands}
                placeholder="Adicionar"
                values={deniedCommands}
              />
            </div>

            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium">Ambiente</span>
              <p className="text-muted-foreground text-xs leading-4.5">
                Allow-list de variáveis. O que não está aqui não chega ao processo do agente.
              </p>

              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox
                  checked={inheritPath}
                  onCheckedChange={(checked) => {
                    setInheritPath(checked === true);
                  }}
                />
                <span>
                  Repassar <code className="font-mono text-[12px]">PATH</code>
                </span>
              </label>

              <ChipInput
                icon={KeyRound}
                label="Variáveis repassadas"
                onChange={setAllowedVariables}
                placeholder="Adicionar"
                values={allowedVariables}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={update.isPending} onClick={save}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
