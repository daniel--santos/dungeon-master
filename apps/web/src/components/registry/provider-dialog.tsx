import type { HarnessKey, ProviderKind } from "@dungeon-master/contracts";
import { KeyRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ChipInput } from "@/components/execution/chip-input";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProviderRecord } from "@/lib/api-types";
import { useHarnesses } from "@/lib/execution";
import { useGlossary } from "@/lib/glossary";
import { useCreateProvider, useUpdateProvider } from "@/lib/registry";
import { isEnvKey, PROVIDER_KIND, PROVIDER_KINDS } from "@/lib/registry-domain";

export interface ProviderDialogProps {
  /** Ausente cria; presente edita aquele Provider. */
  readonly provider?: ProviderRecord;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Cadastro de um Patronato (Fase 8C): quem serve os Patronos e como se
 * autentica.
 *
 * O que fica aqui é a **forma** da autenticação e os **nomes** das variáveis
 * que carregam a credencial. Não existe campo de valor de token: o valor
 * vive no ambiente de quem executa, e o preflight só olha se a variável
 * existe. As Guildas marcadas são as que o Patronato serve; é por elas que
 * o preflight acha o Patronato de um Equipamento sem Patrono escolhido.
 */
export function ProviderDialog({ provider, open, onOpenChange }: ProviderDialogProps) {
  const { t, format } = useGlossary();
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const harnesses = useHarnesses();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderKind>("SUBSCRIPTION");
  const [authEnvKeys, setAuthEnvKeys] = useState<readonly string[]>([]);
  const [harnessKeys, setHarnessKeys] = useState<readonly HarnessKey[]>([]);
  const [docsUrl, setDocsUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(provider?.name ?? "");
    setKind(provider?.kind ?? "SUBSCRIPTION");
    setAuthEnvKeys(provider?.authEnvKeys ?? []);
    setHarnessKeys(provider?.harnessKeys ?? []);
    setDocsUrl(provider?.docsUrl ?? "");
  }, [open, provider]);

  const pending = create.isPending || update.isPending;
  const docsOk = docsUrl.trim() === "" || /^https?:\/\//i.test(docsUrl.trim());
  const valid = name.trim() !== "" && docsOk;

  function toggleHarness(key: HarnessKey, on: boolean) {
    setHarnessKeys((current) =>
      on
        ? [...current.filter((item) => item !== key), key]
        : current.filter((item) => item !== key),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;

    const body = {
      name: name.trim(),
      kind,
      authEnvKeys: [...authEnvKeys],
      harnessKeys: [...harnessKeys],
      docsUrl: docsUrl.trim() === "" ? null : docsUrl.trim(),
    };
    const done = {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t("provider.save.done"));
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    };

    if (provider === undefined) create.mutate(body, done);
    else update.mutate({ id: provider.id, ...body }, done);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form className="flex flex-col gap-4" data-provider-form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {provider === undefined ? t("provider.create.title") : t("provider.edit.title")}
            </DialogTitle>
            <DialogDescription>{t("provider.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-name">Nome</Label>
              <Input
                autoFocus
                id="provider-name"
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                value={name}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-kind">Autenticação</Label>
              <Select
                onValueChange={(next) => {
                  setKind(next as ProviderKind);
                }}
                value={kind}
              >
                <SelectTrigger aria-label="Autenticação" id="provider-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_KINDS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(PROVIDER_KIND[item])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ChipInput
            data-provider-env-keys=""
            hint={t("provider.authEnvKeys.hint")}
            icon={KeyRound}
            label={t("provider.authEnvKeys")}
            mono
            normalize={(value) => value.toUpperCase()}
            onChange={setAuthEnvKeys}
            placeholder="Adicionar variável"
            validate={isEnvKey}
            values={authEnvKeys}
          />

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-muted-foreground pb-1.5 text-xs">
              {t("provider.harnesses")}
            </legend>
            <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
              {(harnesses.data?.items ?? []).map((harness) => (
                <label
                  key={harness.id}
                  className="flex cursor-pointer items-center gap-2.5 text-[13px]"
                  data-provider-harness={harness.key}
                >
                  <Checkbox
                    checked={harnessKeys.includes(harness.key)}
                    onCheckedChange={(checked) => {
                      toggleHarness(harness.key, checked === true);
                    }}
                  />
                  <span>{harness.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-docs">{t("provider.docsUrl")}</Label>
            <Input
              aria-invalid={!docsOk}
              className="font-mono text-[13px]"
              id="provider-docs"
              maxLength={2_000}
              onChange={(event) => {
                setDocsUrl(event.target.value);
              }}
              placeholder="https://"
              value={docsUrl}
            />
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={!valid || pending} type="submit">
              {provider === undefined
                ? format("Criar {provider}", { provider: t("entity.provider") })
                : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
