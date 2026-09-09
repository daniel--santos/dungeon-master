import {
  RUN_RESULT_STATUS_VALUES,
  RUN_STATUS_VALUES,
  TASK_STATUS_VALUES,
  type TaskStatus,
} from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import { allowedRunTransitions, isTerminalRunStatus } from "./run-status.js";
import {
  checkRunCreation,
  type RunCreationInput,
  RUN_CREATION_TASK_STATUSES,
  taskAcceptsNewRun,
  taskStatusForRun,
  taskStatusForRunTransition,
} from "./run-task-coupling.js";
import { checkTaskTransition, type TaskNode } from "./task-rules.js";
import { canTransitionTask } from "./task-status.js";

const BASE: RunCreationInput = {
  taskStatus: "READY",
  projectId: "01996d00-0000-7000-8000-00000000aaaa",
  projectStatus: "ACTIVE",
  projectWorkspacePath: "C:\\repos\\forja",
  dependencies: [],
};

describe("taskAcceptsNewRun", () => {
  it("aceita READY e FAILED, e mais nenhum estado", () => {
    const aceitos = TASK_STATUS_VALUES.filter((status) => taskAcceptsNewRun(status));
    expect(aceitos).toEqual(["READY", "FAILED"]);
  });

  it("a lista de estados aceitos é a mesma que a recusa devolve", () => {
    expect([...RUN_CREATION_TASK_STATUSES]).toEqual(["READY", "FAILED"]);
  });
});

describe("checkRunCreation", () => {
  it("aprova uma Task READY, com Project ativo, workspace e sem dependências", () => {
    expect(checkRunCreation(BASE)).toEqual({ ok: true });
  });

  it("aprova a retentativa de uma Task FAILED", () => {
    expect(checkRunCreation({ ...BASE, taskStatus: "FAILED" })).toEqual({ ok: true });
  });

  it("recusa uma Task fora de READY e FAILED, dizendo quais valem", () => {
    const check = checkRunCreation({ ...BASE, taskStatus: "RUNNING" });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection).toEqual({
      code: "TASK_NOT_RUNNABLE",
      status: "RUNNING",
      allowed: ["READY", "FAILED"],
    });
  });

  it("recusa uma captura de Inbox, que não tem Project", () => {
    // `INBOX` já cairia em TASK_NOT_RUNNABLE; o caso interessante é uma Task
    // que passa no estado mas continua sem Project.
    const check = checkRunCreation({ ...BASE, projectId: null });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection.code).toBe("TASK_WITHOUT_PROJECT");
  });

  it("recusa um Project arquivado", () => {
    const check = checkRunCreation({ ...BASE, projectStatus: "ARCHIVED" });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection).toEqual({ code: "PROJECT_ARCHIVED", projectId: BASE.projectId });
  });

  it("recusa um Project sem workspace: não há onde o agente trabalhar", () => {
    const check = checkRunCreation({ ...BASE, projectWorkspacePath: null });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection).toEqual({
      code: "PROJECT_WITHOUT_WORKSPACE",
      projectId: BASE.projectId,
    });
  });

  it("trata caminho vazio como ausência de workspace", () => {
    const check = checkRunCreation({ ...BASE, projectWorkspacePath: "" });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection.code).toBe("PROJECT_WITHOUT_WORKSPACE");
  });

  it("recusa dependência pendente, nomeando quem bloqueia", () => {
    const check = checkRunCreation({
      ...BASE,
      dependencies: [
        { id: "a", status: "COMPLETED" },
        { id: "b", status: "RUNNING" },
        { id: "c", status: "CANCELLED" },
      ],
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection).toEqual({
      code: "DEPENDENCIES_NOT_COMPLETED",
      blocking: ["b", "c"],
    });
  });

  it("uma dependência CANCELLED continua bloqueando, como na máquina de Task", () => {
    const check = checkRunCreation({
      ...BASE,
      dependencies: [{ id: "c", status: "CANCELLED" }],
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection.code).toBe("DEPENDENCIES_NOT_COMPLETED");
  });

  it("checa o estado da Task antes das dependências", () => {
    // A ordem importa para a mensagem: dizer "faltam dependências" de uma Task
    // já em execução mandaria o usuário resolver o problema errado.
    const check = checkRunCreation({
      ...BASE,
      taskStatus: "COMPLETED",
      dependencies: [{ id: "b", status: "RUNNING" }],
    });

    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.rejection.code).toBe("TASK_NOT_RUNNABLE");
  });
});

describe("taskStatusForRun", () => {
  it("mapeia cada estado do Run para o da Task", () => {
    expect(taskStatusForRun("CREATED")).toBeNull();
    expect(taskStatusForRun("QUEUED")).toBe("QUEUED");
    expect(taskStatusForRun("PREPARING")).toBe("RUNNING");
    expect(taskStatusForRun("RUNNING")).toBe("RUNNING");
    expect(taskStatusForRun("WAITING_APPROVAL")).toBeNull();
    expect(taskStatusForRun("FAILED")).toBe("FAILED");
    expect(taskStatusForRun("TIMED_OUT")).toBe("FAILED");
    expect(taskStatusForRun("CANCELLED")).toBe("READY");
  });

  it("em SUCCEEDED, o veredito do agente decide o destino da Task", () => {
    expect(taskStatusForRun("SUCCEEDED", "completed")).toBe("COMPLETED");
    expect(taskStatusForRun("SUCCEEDED", "blocked")).toBe("BLOCKED");
    expect(taskStatusForRun("SUCCEEDED", "failed")).toBe("FAILED");
  });

  it("SUCCEEDED sem resultado estruturado deixa a Task retentável, não concluída", () => {
    expect(taskStatusForRun("SUCCEEDED")).toBe("FAILED");
    expect(taskStatusForRun("SUCCEEDED", null)).toBe("FAILED");
  });

  it("cobre todo estado de Run, sem cair em undefined", () => {
    for (const status of RUN_STATUS_VALUES) {
      const alvo = taskStatusForRun(status);
      expect(alvo === null || TASK_STATUS_VALUES.includes(alvo), status).toBe(true);
    }
  });

  it("cobre todo veredito de resultado", () => {
    for (const resultado of RUN_RESULT_STATUS_VALUES) {
      const alvo = taskStatusForRun("SUCCEEDED", resultado);
      expect(alvo).not.toBeNull();
      expect(TASK_STATUS_VALUES).toContain(alvo);
    }
  });

  it("cancelar a execução devolve o trabalho ao quadro, e não cancela a Task", () => {
    expect(taskStatusForRun("CANCELLED")).toBe("READY");
    expect(taskStatusForRun("CANCELLED")).not.toBe("CANCELLED");
  });
});

/**
 * O acoplamento só é aplicável se a máquina de Task tiver as arestas que ele
 * exige. Este bloco é a costura entre os dois arquivos: um destino que a
 * máquina de Task não alcança viraria um `409` no meio de uma transação de
 * escrita de resultado terminal, que é o pior lugar para descobrir isso.
 */
describe("taskStatusForRunTransition", () => {
  it("não mexe na Task quando o gate devolve o Run à fila", () => {
    expect(taskStatusForRunTransition({ from: "WAITING_APPROVAL", to: "QUEUED" })).toBeNull();
  });

  it("delega à tabela por destino em todo outro par", () => {
    for (const from of RUN_STATUS_VALUES) {
      for (const to of RUN_STATUS_VALUES) {
        if (from === "WAITING_APPROVAL" && to === "QUEUED") continue;
        for (const resultStatus of [null, ...RUN_RESULT_STATUS_VALUES]) {
          expect(taskStatusForRunTransition({ from, to, resultStatus })).toBe(
            taskStatusForRun(to, resultStatus),
          );
        }
      }
    }
  });

  it("a volta do gate cancelado leva a Task de RUNNING a READY", () => {
    // Com a Task parada em RUNNING durante o gate, cancelar o Run precisa de
    // uma aresta que a máquina de Task tem.
    expect(taskStatusForRunTransition({ from: "WAITING_APPROVAL", to: "CANCELLED" })).toBe("READY");
    expect(canTransitionTask("RUNNING", "READY")).toBe(true);
  });
});

/**
 * A costura de baixo prova a **forma** do grafo; esta prova a **vizinhança**,
 * que é a metade que faltava.
 *
 * Uma Task mãe com subtarefa aberta chega a `RUNNING` como qualquer outra, e
 * `checkTaskTransition` recusa `RUNNING → COMPLETED` com `CHILDREN_NOT_SETTLED`.
 * Como a recusa acontece antes da primeira escrita da transação de desfecho, o
 * Run não fecha, `run.result` não é gravado e as propostas daquele resultado se
 * perdem. Pedir um destino que o próprio domínio recusa é o defeito; o teste
 * mora aqui porque é o acoplamento que escolhe o destino.
 */
describe("o desfecho de um Run de Task mãe com subtarefa aberta", () => {
  const FILHA_ABERTA: readonly TaskNode[] = [{ id: "T-filha", status: "READY" }];
  const FILHAS_ASSENTADAS: readonly TaskNode[] = [
    { id: "T-feita", status: "COMPLETED" },
    { id: "T-descartada", status: "CANCELLED" },
  ];

  it("com filha aberta, não pede COMPLETED: pede um destino que a máquina aceita", () => {
    const alvo = taskStatusForRunTransition({
      from: "RUNNING",
      to: "SUCCEEDED",
      resultStatus: "completed",
      children: FILHA_ABERTA,
    });

    expect(alvo).toBe("BLOCKED");
    if (alvo === null) return;
    expect(checkTaskTransition({ from: "RUNNING", to: alvo, children: FILHA_ABERTA })).toEqual({
      ok: true,
    });
  });

  it("com as filhas assentadas, o veredito completed continua concluindo a mãe", () => {
    const alvo = taskStatusForRunTransition({
      from: "RUNNING",
      to: "SUCCEEDED",
      resultStatus: "completed",
      children: FILHAS_ASSENTADAS,
    });

    expect(alvo).toBe("COMPLETED");
    if (alvo === null) return;
    expect(checkTaskTransition({ from: "RUNNING", to: alvo, children: FILHAS_ASSENTADAS })).toEqual(
      {
        ok: true,
      },
    );
  });

  it("sem filhas, o destino é o da tabela, como sempre foi", () => {
    expect(taskStatusForRunTransition({ from: "RUNNING", to: "SUCCEEDED" })).toBe("FAILED");
    expect(
      taskStatusForRunTransition({ from: "RUNNING", to: "SUCCEEDED", resultStatus: "completed" }),
    ).toBe("COMPLETED");
    expect(
      taskStatusForRunTransition({
        from: "RUNNING",
        to: "SUCCEEDED",
        resultStatus: "completed",
        children: [],
      }),
    ).toBe("COMPLETED");
  });

  it("só COMPLETED é afetado: os outros vereditos passam intactos", () => {
    for (const resultStatus of RUN_RESULT_STATUS_VALUES) {
      const comFilha = taskStatusForRunTransition({
        from: "RUNNING",
        to: "SUCCEEDED",
        resultStatus,
        children: FILHA_ABERTA,
      });

      if (resultStatus === "completed") continue;
      expect(comFilha, resultStatus).toBe(taskStatusForRun("SUCCEEDED", resultStatus));
    }
  });

  it("todo desfecho de um Run em voo cabe na máquina, com filha aberta", () => {
    const desfechos = allowedRunTransitions("RUNNING").filter(isTerminalRunStatus);

    for (const to of desfechos) {
      for (const resultStatus of [null, ...RUN_RESULT_STATUS_VALUES]) {
        const alvo = taskStatusForRunTransition({
          from: "RUNNING",
          to,
          resultStatus,
          children: FILHA_ABERTA,
        });
        if (alvo === null || alvo === "RUNNING") continue;

        expect(
          checkTaskTransition({ from: "RUNNING", to: alvo, children: FILHA_ABERTA }),
          `${to} + ${resultStatus ?? "sem resultado"} → ${alvo}`,
        ).toEqual({ ok: true });
      }
    }
  });
});

describe("as arestas que o acoplamento exige existem na máquina de Task", () => {
  const CAMINHOS: ReadonlyArray<readonly [TaskStatus, TaskStatus, string]> = [
    ["READY", "QUEUED", "criar Run a partir de READY"],
    ["FAILED", "QUEUED", "criar Run a partir de FAILED (retentativa)"],
    ["QUEUED", "RUNNING", "Run entra em PREPARING"],
    ["RUNNING", "COMPLETED", "Run SUCCEEDED com resultado completed"],
    ["RUNNING", "BLOCKED", "Run SUCCEEDED com resultado blocked"],
    ["RUNNING", "FAILED", "Run SUCCEEDED com resultado failed, ou Run FAILED/TIMED_OUT"],
    ["RUNNING", "READY", "Run CANCELLED em execução"],
    ["QUEUED", "READY", "Run CANCELLED antes de rodar"],
  ];

  it.each(CAMINHOS)("%s → %s (%s)", (from, to) => {
    expect(canTransitionTask(from, to)).toBe(true);
  });
});
