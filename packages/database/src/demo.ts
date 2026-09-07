import type { TaskKind, TaskPriority, TaskStatus } from "@dungeon-master/contracts";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { captureInboxTask } from "./inbox.js";
import { createProject } from "./project.js";
import { projects } from "./schema/project.js";
import { tasks } from "./schema/task.js";
import { addTaskDependency, changeTaskStatus, createTask } from "./task.js";

/**
 * Massa de demonstração: dois Projects com trabalho de verdade e uma Inbox com
 * capturas por triar.
 *
 * Existe para que quem abre a aplicação pela primeira vez veja telas com
 * conteúdo — lista, filtros, ordenação, subtarefas, dependências e diário — em
 * vez de decidir se o sistema está quebrado ou só vazio.
 *
 * **Nada aqui é `INSERT` direto.** Todo Project, toda Task, toda transição e
 * toda dependência passam pelas mesmas funções que a API usa, de modo que a
 * massa respeita a máquina de estados, as regras de subtarefa e de ciclo, e
 * gera `activity` e `dashboard_event` na mesma transação da mudança. Uma massa
 * escrita por `INSERT` seria um estado que a aplicação não sabe produzir, e o
 * primeiro bug a aparecer seria dela.
 *
 * **Idempotente.** Não há coluna de chave natural em `project` nem em `task`, e
 * inventar UUIDs fixos aqui contornaria o `newId()` que todo o resto usa. A
 * chave estável é, então, o título: um Project ou uma Task de demonstração que
 * já existe é reaproveitado, nunca recriado. Rodar duas vezes não duplica
 * nada, e as transições só são aplicadas ao que acabou de nascer — o que já
 * está no banco pertence a quem mexeu nele depois.
 */

/** Uma Task da massa. O título é a chave estável dela. */
interface DemoTaskSpec {
  readonly title: string;
  readonly description?: string;
  readonly kind: TaskKind;
  readonly priority: TaskPriority;
  /**
   * Transições aplicadas depois da criação, na ordem, pela máquina de estados.
   * Ausente deixa a Task em `READY`, que é como ela nasce.
   */
  readonly path?: readonly TaskStatus[];
  /** Título da Task mãe, que precisa vir antes desta na lista. */
  readonly parent?: string;
  /** Títulos das Tasks que esta espera, que precisam vir antes desta na lista. */
  readonly dependsOn?: readonly string[];
}

interface DemoProjectSpec {
  readonly title: string;
  readonly description: string;
  readonly tasks: readonly DemoTaskSpec[];
}

/**
 * `BLOCKED` só é alcançável a partir de `RUNNING` (máquina de estados da Fase
 * 1), então a Task travada atravessa `QUEUED` e `RUNNING` para chegar lá. A
 * travessia é o caminho legítimo, validado pelas mesmas regras de sempre; o que
 * importa é que nenhuma Task **fica** em `QUEUED` ou `RUNNING`, porque esses
 * dois só passam a significar alguma coisa com o runtime da Fase 2.
 */
const DEMO_PROJECTS: readonly DemoProjectSpec[] = [
  {
    title: "Forja de Widgets",
    description:
      "O produto novo: desenhar, fundir e publicar a primeira leva de widgets. " +
      "Serve de exemplo de projeto em andamento, com subtarefas e trabalho travado.",
    tasks: [
      {
        title: "Desenhar a bigorna",
        description: "O desenho de que todo o resto depende. Tem duas subtarefas.",
        kind: "FEATURE",
        priority: "HIGH",
      },
      {
        title: "Escolher o aço",
        kind: "CHORE",
        priority: "MEDIUM",
        parent: "Desenhar a bigorna",
        path: ["COMPLETED"],
      },
      {
        title: "Temperar a peça",
        kind: "CHORE",
        priority: "LOW",
        parent: "Desenhar a bigorna",
      },
      {
        title: "Corrigir o vazamento da fornalha",
        description: "Reaberto pela terceira vez. Trava a produção enquanto não fechar.",
        kind: "BUG",
        priority: "URGENT",
        path: ["QUEUED", "RUNNING", "BLOCKED"],
      },
      {
        title: "Catalogar as ligas disponíveis",
        kind: "RESEARCH",
        priority: "MEDIUM",
      },
      {
        title: "Aposentar o molde antigo",
        kind: "CHORE",
        priority: "LOW",
        path: ["CANCELLED"],
      },
      {
        title: "Publicar a primeira fornada",
        kind: "FEATURE",
        priority: "MEDIUM",
        dependsOn: ["Desenhar a bigorna"],
      },
    ],
  },
  {
    title: "Expedição ao Legado",
    description:
      "O sistema antigo que ninguém mais entende: mapear, reescrever e limpar. " +
      "Serve de exemplo de projeto com trabalho concluído e dependência satisfeita.",
    tasks: [
      {
        title: "Mapear o módulo de cobrança",
        kind: "RESEARCH",
        priority: "HIGH",
        path: ["COMPLETED"],
      },
      {
        title: "Reescrever o cálculo de imposto",
        description: "Só faz sentido depois do mapa. A dependência já está satisfeita.",
        kind: "FEATURE",
        priority: "HIGH",
        dependsOn: ["Mapear o módulo de cobrança"],
      },
      {
        title: "Caçar o bug do fuso horário",
        kind: "BUG",
        priority: "URGENT",
      },
      {
        title: "Remover o código morto",
        kind: "CHORE",
        priority: "LOW",
        path: ["CANCELLED"],
      },
    ],
  },
];

/** As capturas por triar. Cada uma é uma Task em `INBOX`, sem Project. */
const DEMO_CAPTURES: readonly string[] = [
  "Perguntar ao time qual formato de relatório eles realmente leem",
  "Investigar o alerta de latência que só aparece de madrugada",
  "Rever a documentação de onboarding antes do próximo mês",
];

export interface DemoSeedResult {
  readonly projectsCreated: number;
  readonly projectsTotal: number;
  readonly tasksCreated: number;
  readonly tasksTotal: number;
  /** Quantas das Tasks são capturas na Inbox. */
  readonly capturesTotal: number;
}

/**
 * Desembrulha o retorno de uma escrita do repositório, ou explode dizendo o quê.
 *
 * O seed é a única chamada dessas funções que não tem para quem devolver um
 * status HTTP: aqui, "não existe" e "regra recusou" são as duas formas de a
 * massa estar mal escrita, e as duas precisam parar o comando com a linha certa
 * no erro em vez de deixar o banco meio semeado em silêncio.
 */
function exigirOk<V, F>(
  result: { ok: true; value: V } | { ok: false; failure: F } | null,
  what: string,
): V {
  if (result === null) throw new Error(`Massa de demonstração: ${what} não foi encontrado.`);
  if (!result.ok) {
    throw new Error(`Massa de demonstração: ${what} recusado — ${JSON.stringify(result.failure)}.`);
  }
  return result.value;
}

function exigir<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Massa de demonstração: ${what} não foi encontrado.`);
  return value;
}

async function ensureProject(
  db: Database,
  userId: string,
  spec: DemoProjectSpec,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.title, spec.title)));

  if (existing !== undefined) return { id: existing.id, created: false };

  const created = await createProject(db, {
    userId,
    title: spec.title,
    description: spec.description,
  });

  return { id: created.id, created: true };
}

async function ensureTask(
  db: Database,
  userId: string,
  projectId: string,
  spec: DemoTaskSpec,
  parentTaskId: string | null,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), eq(tasks.projectId, projectId), eq(tasks.title, spec.title)),
    );

  if (existing !== undefined) return { id: existing.id, created: false };

  const created = exigirOk(
    await createTask(db, {
      userId,
      projectId,
      parentTaskId,
      title: spec.title,
      description: spec.description ?? null,
      kind: spec.kind,
      priority: spec.priority,
    }),
    `a criação de "${spec.title}"`,
  );

  return { id: created.id, created: true };
}

async function ensureCapture(
  db: Database,
  userId: string,
  text: string,
): Promise<{ id: string; created: boolean }> {
  // Sem Project: uma captura é uma Task em `INBOX`, e é justamente o Project
  // que promover acrescenta. A busca inclui as já promovidas ou descartadas,
  // porque a chave é o texto e o objetivo é não duplicá-lo nunca.
  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.title, text)));

  if (existing !== undefined) return { id: existing.id, created: false };

  const created = await captureInboxTask(db, { userId, text });
  return { id: created.id, created: true };
}

/**
 * Cria (ou reaproveita) a massa de demonstração deste usuário.
 *
 * As transições e as dependências só são aplicadas ao que acabou de nascer:
 * uma Task que já existia pode ter sido movida por quem estava usando o
 * sistema, e o seed não desfaz o trabalho de ninguém.
 */
export async function seedDemoData(
  db: Database,
  input: { userId: string },
): Promise<DemoSeedResult> {
  const { userId } = input;

  let projectsCreated = 0;
  let tasksCreated = 0;

  for (const projectSpec of DEMO_PROJECTS) {
    const project = await ensureProject(db, userId, projectSpec);
    if (project.created) projectsCreated += 1;

    const porTitulo = new Map<string, string>();

    for (const taskSpec of projectSpec.tasks) {
      const parentTaskId =
        taskSpec.parent === undefined
          ? null
          : exigir(porTitulo.get(taskSpec.parent), `a Task mãe "${taskSpec.parent}"`);

      const task = await ensureTask(db, userId, project.id, taskSpec, parentTaskId);
      porTitulo.set(taskSpec.title, task.id);

      // Uma Task que já existia pode ter sido movida por quem estava usando o
      // sistema: reaplicar o caminho dela desfaria esse trabalho, e a segunda
      // transição seria recusada de qualquer jeito por um estado terminal.
      if (!task.created) continue;
      tasksCreated += 1;

      for (const dependsOnTitle of taskSpec.dependsOn ?? []) {
        const dependsOnTaskId = exigir(
          porTitulo.get(dependsOnTitle),
          `a dependência "${dependsOnTitle}"`,
        );

        exigirOk(
          await addTaskDependency(db, { userId, taskId: task.id, dependsOnTaskId }),
          `a dependência de "${taskSpec.title}" em "${dependsOnTitle}"`,
        );
      }

      for (const to of taskSpec.path ?? []) {
        exigirOk(
          await changeTaskStatus(db, { userId, taskId: task.id, to }),
          `a transição de "${taskSpec.title}" para ${to}`,
        );
      }
    }
  }

  for (const text of DEMO_CAPTURES) {
    const capture = await ensureCapture(db, userId, text);
    if (capture.created) tasksCreated += 1;
  }

  const tasksTotal = DEMO_PROJECTS.reduce((total, spec) => total + spec.tasks.length, 0);

  return {
    projectsCreated,
    projectsTotal: DEMO_PROJECTS.length,
    tasksCreated,
    tasksTotal: tasksTotal + DEMO_CAPTURES.length,
    capturesTotal: DEMO_CAPTURES.length,
  };
}
