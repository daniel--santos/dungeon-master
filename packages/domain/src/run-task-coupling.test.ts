import {
  RUN_RESULT_STATUS_VALUES,
  RUN_STATUS_VALUES,
  TASK_STATUS_VALUES,
  type TaskStatus,
} from "@dungeon-master/contracts";
import { describe, expect, it } from "vitest";

import {
  checkRunCreation,
  type RunCreationInput,
  RUN_CREATION_TASK_STATUSES,
  taskAcceptsNewRun,
  taskStatusForRun,
  taskStatusForRunTransition,
} from "./run-task-coupling.js";
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
