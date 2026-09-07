// Lista de Expedições, o diálogo Nova Expedição e o cadastro de Equipamentos,
// Heróis e Guildas.

import {
  A_AMBER,
  A_BLUE,
  A_GREEN,
  A_NEUTRAL,
  A_VIOLET,
  BG,
  BORDER,
  CAMPANHA,
  CARD,
  DESTR,
  FG,
  INPUT,
  KINDS,
  MFG,
  MISSAO,
  MONO,
  MUTED,
  PRIMARY,
  PRIMARY_FG,
  RUN_STATUS,
  SERIF,
  SHADOW_LG,
  SHADOW_XS,
  breadcrumb,
  btn,
  card,
  chip,
  col,
  dotChip,
  envBadge,
  icon,
  inputStyle,
  mono,
  pageHeader,
  row,
  screen,
  select,
  tint,
  write,
} from "./kit.mjs";

/* ============================================== ARTBOARD 4 — lista de Expedições */
const COLS = { heroi: 180, amb: 200, status: 124, dur: 84, ini: 104 };

const RUNS = [
  [MISSAO, "BUG", "Ferreiro de Plataforma", "Claude Code", "RUNNING", "01:13", "há 1 min"],
  [
    "Trocar o glossário sem recarregar a página",
    "FEATURE",
    "Ferreiro de Plataforma",
    "Claude Code",
    "SUCCEEDED",
    "04:38",
    "há 2 h",
  ],
  [
    "Sessão do harness não é reaproveitada ao retomar",
    "BUG",
    "Batedor",
    "Codex",
    "TIMED_OUT",
    "15:00",
    "há 3 h",
  ],
  [
    "Badge de ambiente sempre visível no cockpit",
    "FEATURE",
    "Ferreiro de Plataforma",
    "Claude Code",
    "SUCCEEDED",
    "02:07",
    "há 4 h",
  ],
  [
    "Avaliar o Antigravity CLI em modo headless",
    "RESEARCH",
    "Batedor",
    "Pi",
    "CANCELLED",
    "00:52",
    "há 5 h",
  ],
  [
    "openapi.json desatualizado depois do último contrato",
    "BUG",
    "Sentinela",
    "Claude Code",
    "FAILED",
    "03:21",
    "ontem",
  ],
  [
    "Migrar os testes para embedded-postgres",
    "CHORE",
    "Ferreiro de Plataforma",
    "Codex",
    "SUCCEEDED",
    "11:44",
    "ontem",
  ],
  [
    "Catálogo de Conquistas visível desde o início",
    "FEATURE",
    "Arquiteta da Torre",
    "Claude Code",
    "SUCCEEDED",
    "06:12",
    "ontem",
  ],
  [
    "Comparar Sandcastle e execução direta por spawn",
    "RESEARCH",
    "Batedor",
    "Pi",
    "SUCCEEDED",
    "08:30",
    "há 2 dias",
  ],
];

export function buildExpedicoes() {
  const filtros =
    '<div style="' +
    row("gap: 8px; flex: none") +
    '">' +
    '<div style="' +
    inputStyle("width: 260px; color: " + MFG) +
    '">' +
    icon("search", 16) +
    '<span style="font-size: 14px; color: ' +
    MFG +
    '">Buscar por Missão</span></div>' +
    select("Campanha", CAMPANHA, 190) +
    select("Status", null, 140) +
    select("Guilda", null, 150) +
    '<button style="' +
    btn("ghost", "sm") +
    '">' +
    icon("x", 14) +
    "<span>Limpar</span></button>" +
    '<div style="flex: 1"></div>' +
    '<span style="' +
    row("gap: 7px; font-size: 12px; color: " + MFG) +
    '"><span style="width: 6px; height: 6px; border-radius: 999px; background: ' +
    A_BLUE +
    '; animation: dcpulse 1.6s ease-in-out infinite"></span>1 em andamento · 38 Expedições</span></div>';

  const headCell = (texto, w) =>
    '<span style="' +
    (w ? "width: " + w + "px; flex: none" : "flex: 1; min-width: 0") +
    "; font-size: 12px; font-weight: 500; color: " +
    MFG +
    '">' +
    texto +
    "</span>";

  const head =
    '<div style="' +
    row("height: 40px; border-bottom: 1px solid " + BORDER + "; padding: 0 16px; gap: 16px") +
    '">' +
    headCell("Missão") +
    headCell("Herói · Guilda", COLS.heroi) +
    headCell("Ambiente", COLS.amb) +
    headCell("Status", COLS.status) +
    headCell("Duração", COLS.dur) +
    headCell("Iniciada", COLS.ini) +
    "</div>";

  const body = RUNS.map((r, i) => {
    const k = KINDS[r[1]];
    const s = RUN_STATUS[r[4]];
    const ativa = r[4] === "RUNNING";
    return (
      '<div style="' +
      row(
        "height: 56px; border-bottom: 1px solid " +
          BORDER +
          "; padding: 0 16px; gap: 16px; font-size: 14px;" +
          (ativa ? " background: oklch(1 0 0 / 0.03);" : ""),
      ) +
      '">' +
      '<div style="' +
      row("gap: 9px; flex: 1; min-width: 0") +
      '">' +
      '<span style="color: ' +
      MFG +
      '; display: flex; flex: none">' +
      icon(k.icon, 14) +
      "</span>" +
      '<span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ' +
      FG +
      '">' +
      r[0] +
      "</span></div>" +
      '<div style="' +
      col("gap: 1px; width: " + COLS.heroi + "px; flex: none") +
      '">' +
      '<span style="font-size: 12.5px; color: ' +
      FG +
      '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
      r[2] +
      "</span>" +
      '<span style="font-size: 11px; color: ' +
      MFG +
      '">' +
      r[3] +
      "</span></div>" +
      '<span style="width: ' +
      COLS.amb +
      'px; flex: none">' +
      envBadge("host", "dnd", "sm") +
      "</span>" +
      '<span style="width: ' +
      COLS.status +
      'px; flex: none">' +
      dotChip(s.label, s.color, s.dim, s.pulse) +
      "</span>" +
      '<span style="width: ' +
      COLS.dur +
      "px; flex: none; font-family: " +
      MONO +
      "; font-size: 12.5px; color: " +
      (r[4] === "TIMED_OUT" ? A_AMBER : FG) +
      '">' +
      r[5] +
      "</span>" +
      '<span style="width: ' +
      COLS.ini +
      "px; flex: none; font-size: 12.5px; color: " +
      MFG +
      '">' +
      r[6] +
      "</span></div>"
    );
  }).join("");

  const footer =
    '<div style="' +
    row("justify-content: space-between; padding: 12px 16px") +
    '">' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '">Mostrando 1–9 de 38</span>' +
    '<div style="' +
    row("gap: 6px") +
    '">' +
    '<button style="' +
    btn("outline", "sm", "opacity: .5") +
    '">Anterior</button>' +
    '<button style="' +
    btn("default", "sm", "width: 32px; padding: 0") +
    '">1</button>' +
    '<button style="' +
    btn("ghost", "sm", "width: 32px; padding: 0") +
    '">2</button>' +
    '<button style="' +
    btn("ghost", "sm", "width: 32px; padding: 0") +
    '">3</button>' +
    '<button style="' +
    btn("outline", "sm") +
    '">Próxima</button></div></div>';

  const tabela =
    '<section style="' + card(col("overflow: hidden; flex: none")) + '">' + head + body + footer + "</section>";

  return write(
    "Expedicoes.dc.html",
    1440,
    900,
    screen(
      "dnd",
      "Expedições",
      1440,
      900,
      pageHeader(
        "dnd",
        "Expedições",
        "Toda tentativa de resolver uma Missão, com o que foi usado, quanto durou e como terminou.",
      ) +
        '<div style="' +
        col("gap: 16px") +
        '">' +
        filtros +
        tabela +
        "</div>",
    ),
  );
}

/* ========================================== ARTBOARD 5 — diálogo Nova Expedição */
function fundoMissao() {
  const k = KINDS.BUG;
  const bloco = (titulo, corpo, extra = "") =>
    '<section style="' +
    card(col("gap: 9px; padding: 18px 20px; " + extra)) +
    '"><span style="font-size: 14px; font-weight: 500">' +
    titulo +
    "</span>" +
    corpo +
    "</section>";

  const p = (t) =>
    '<p style="margin: 0; font-size: 13.5px; line-height: 21px; color: ' + MFG + '">' + t + "</p>";

  const esquerda =
    '<div style="' +
    col("gap: 16px") +
    '">' +
    bloco(
      "Descrição",
      p(
        "No Windows, taskkill devolve código de saída 0 mesmo quando um filho continua vivo. A Expedição fica em RUNNING até o timeout e a trava de worktree nunca é liberada.",
      ) +
        p(
          "Reproduzir: subir o worker, disparar uma Expedição em Campo aberto, cancelar pelo cockpit e conferir a árvore.",
        ),
    ) +
    bloco(
      "Etapas da missão",
      p("Isolar o taskkill em um teste de plataforma · Confirmar término por polling · Liberar a trava no finally"),
    ) +
    bloco("Expedições", p("Nenhuma Expedição ainda para esta Missão."), "height: 150px") +
    "</div>";

  const direita =
    '<div style="' +
    col("gap: 16px") +
    '">' +
    bloco(
      "Detalhes",
      p("Campanha " + CAMPANHA + " · Monstro · Urgente · 1 de 3 etapas"),
    ) +
    bloco("Dependências", p("1 entrada · 1 saída")) +
    bloco(
      "Ambiente",
      '<div style="padding-top: 2px">' + envBadge("host", "dnd", "md") + "</div>",
    ) +
    "</div>";

  const conteudo =
    '<div style="' +
    col("gap: 10px; flex: none") +
    '">' +
    breadcrumb(["Missões", CAMPANHA, MISSAO]) +
    '<div style="' +
    row("justify-content: space-between; align-items: flex-start; gap: 24px") +
    '">' +
    '<div style="' +
    col("gap: 10px") +
    '">' +
    '<h1 style="margin: 0; font-family: ' +
    SERIF +
    "; font-size: 30px; line-height: 38px; font-weight: 600; max-width: 720px; color: " +
    FG +
    '">' +
    MISSAO +
    "</h1>" +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    chip(k.dnd, k.icon) +
    dotChip("Pronta", A_BLUE, false) +
    "</div></div>" +
    '<button style="' +
    btn("default", "default") +
    '">' +
    icon("swords", 16) +
    "<span>Nova Expedição</span></button></div></div>" +
    '<div style="display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start">' +
    esquerda +
    direita +
    "</div>";

  return screen("dnd", "Missões", 1440, 900, conteudo);
}

function campo(label, corpo, hint) {
  return (
    '<div style="' +
    col("gap: 6px") +
    '">' +
    '<span style="font-size: 12.5px; font-weight: 500; color: ' +
    FG +
    '">' +
    label +
    "</span>" +
    corpo +
    (hint
      ? '<span style="font-size: 11px; line-height: 16px; color: ' + MFG + '">' + hint + "</span>"
      : "") +
    "</div>"
  );
}

function radioOpcao(o) {
  const c = o.disabled ? MFG : o.host ? DESTR : A_BLUE;
  return (
    '<div style="' +
    row(
      "gap: 11px; align-items: flex-start; padding: 11px 13px; border-radius: 10px; border: 1px solid " +
        (o.on ? tint(c, "45%") : BORDER) +
        "; background: " +
        (o.on ? tint(c, "9%") : "transparent") +
        ";" +
        (o.disabled ? " opacity: .5;" : ""),
    ) +
    '">' +
    '<span style="' +
    row(
      "justify-content: center; width: 16px; height: 16px; flex: none; margin-top: 1px; border-radius: 999px; border: 1px solid " +
        (o.on ? c : INPUT) +
        ";",
    ) +
    '">' +
    (o.on
      ? '<span style="width: 8px; height: 8px; border-radius: 999px; background: ' + c + '"></span>'
      : "") +
    "</span>" +
    '<div style="' +
    col("gap: 4px; flex: 1; min-width: 0") +
    '">' +
    '<div style="' +
    row("gap: 8px; flex-wrap: wrap") +
    '">' +
    '<span style="font-size: 13.5px; font-weight: 500; color: ' +
    FG +
    '">' +
    o.nome +
    "</span>" +
    (o.aviso
      ? '<span style="font-size: 13.5px; color: ' +
        MFG +
        '">·</span><span style="font-size: 13.5px; color: ' +
        c +
        '">' +
        o.aviso +
        "</span>"
      : "") +
    (o.tag
      ? '<span style="' +
        row(
          "height: 18px; padding: 0 7px; border-radius: 999px; border: 1px solid " +
            BORDER +
            "; font-size: 10.5px; color: " +
            MFG +
            ";",
        ) +
        '">' +
        o.tag +
        "</span>"
      : "") +
    "</div>" +
    '<span style="font-size: 11.5px; color: ' +
    MFG +
    '">' +
    o.nota +
    "</span></div>" +
    '<span style="' +
    row(
      "height: 20px; padding: 0 6px; flex: none; border-radius: 6px; border: 1px solid " +
        tint(c, "40%") +
        "; background: " +
        tint(c, "12%") +
        "; font-family: " +
        MONO +
        "; font-size: 10px; letter-spacing: 0.04em; color: " +
        c +
        ";",
    ) +
    '">' +
    o.canonico +
    "</span></div>"
  );
}

export function buildNovaExpedicao() {
  const k = KINDS.BUG;

  const cabecalho =
    '<div style="' +
    col("gap: 6px") +
    '">' +
    '<div style="' +
    row("justify-content: space-between; align-items: flex-start; gap: 16px") +
    '">' +
    '<h2 style="margin: 0; font-size: 18px; line-height: 22px; font-weight: 600; color: ' +
    FG +
    '">Nova Expedição</h2>' +
    '<span style="color: ' +
    MFG +
    '; display: flex; opacity: .7">' +
    icon("x", 16) +
    "</span></div>" +
    '<p style="margin: 0; font-size: 13.5px; line-height: 20px; color: ' +
    MFG +
    '">Escolha o Equipamento e o ambiente. O prompt vem montado do título e da descrição da Missão — edite antes de partir.</p>' +
    "</div>";

  const missaoLinha =
    '<div style="' +
    row(
      "gap: 9px; padding: 9px 12px; border-radius: 10px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.035);",
    ) +
    '">' +
    chip(k.dnd, k.icon) +
    '<span style="flex: 1; min-width: 0; font-size: 13px; color: ' +
    FG +
    '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
    MISSAO +
    "</span>" +
    '<span style="font-size: 11.5px; color: ' +
    DESTR +
    '; flex: none">Urgente</span></div>';

  const equipamento = campo(
    "Equipamento",
    '<div style="' +
      row(
        "gap: 12px; padding: 11px 12px; border-radius: 10px; border: 1px solid " +
          INPUT +
          "; background: oklch(1 0 0 / 0.045);",
      ) +
      '">' +
      '<span style="' +
      row(
        "justify-content: center; width: 34px; height: 34px; flex: none; border-radius: 9px; border: 1px solid " +
          BORDER +
          "; background: " +
          tint(A_VIOLET, "12%") +
          "; color: " +
          A_VIOLET +
          ";",
      ) +
      '">' +
      icon("package", 17) +
      "</span>" +
      '<div style="' +
      col("gap: 2px; flex: 1; min-width: 0") +
      '">' +
      '<span style="font-size: 13.5px; font-weight: 500; color: ' +
      FG +
      '">Forja de Plataforma</span>' +
      '<span style="font-size: 11.5px; color: ' +
      MFG +
      '">Ferreiro de Plataforma · Engenheiro · Claude Code · Claude Opus 5</span></div>' +
      '<button style="' +
      btn("outline", "sm") +
      '">Trocar</button></div>',
    "3 Habilidades, 6 Itens e 1 Relíquia vão junto. O perfil de execução do Equipamento é Campo aberto · worktree por Expedição.",
  );

  const ambiente = campo(
    "Ambiente",
    '<div style="' +
      col("gap: 8px") +
      '">' +
      radioOpcao({
        on: true,
        host: true,
        nome: "Campo aberto",
        aviso: "sem isolamento",
        nota: "Mais rápido, sem custo de partida. O Herói roda direto na sua máquina.",
        canonico: "HOST · UNISOLATED",
      }) +
      radioOpcao({
        on: false,
        disabled: true,
        nome: "Masmorra selada",
        tag: "Fase 2C",
        nota: "Isolada, com custo extra para subir o container. Ainda não disponível.",
        canonico: "DOCKER · ISOLATED",
      }) +
      "</div>",
  );

  const aceite =
    '<div style="' +
    row(
      "gap: 11px; align-items: flex-start; padding: 12px 13px; border-radius: 10px; border: 1px solid " +
        tint(DESTR, "38%") +
        "; background: " +
        tint(DESTR, "9%") +
        ";",
    ) +
    '">' +
    '<span style="' +
    row(
      "justify-content: center; width: 16px; height: 16px; flex: none; margin-top: 1px; border-radius: 5px; background: " +
        DESTR +
        "; color: " +
        BG +
        ";",
    ) +
    '">' +
    icon("check", 11, "", 3.2) +
    "</span>" +
    '<div style="' +
    col("gap: 5px; flex: 1; min-width: 0") +
    '">' +
    '<span style="font-size: 12.5px; line-height: 18px; color: ' +
    FG +
    '">Entendo que o Herói vai rodar direto na minha máquina, com acesso ao disco e à rede, sem isolamento.</span>' +
    '<span style="font-size: 11px; line-height: 16px; color: ' +
    MFG +
    '">A Expedição usa um worktree próprio (' +
    mono(".runs/exp-244", FG, "font-size: 10.5px") +
    "), que separa as alterações mas não é um sandbox. As permissões ficam com a CLI: pedimos " +
    mono("advisory", MFG, "font-size: 10.5px") +
    ", quem aplica é " +
    mono("harness-native", A_AMBER, "font-size: 10.5px") +
    ".</span></div></div>";

  const prompt = campo(
    "Prompt",
    '<div style="' +
      col(
        "gap: 8px; padding: 11px 12px; border-radius: 10px; border: 1px solid " +
          INPUT +
          "; background: oklch(1 0 0 / 0.045); height: 132px;",
      ) +
      '">' +
      '<span style="font-size: 12.5px; line-height: 19px; color: ' +
      FG +
      '">' +
      MISSAO +
      "</span>" +
      '<span style="font-size: 12.5px; line-height: 19px; color: ' +
      MFG +
      '">No Windows, taskkill devolve código de saída 0 mesmo quando um filho continua vivo. A Expedição fica em RUNNING até o timeout e a trava de worktree nunca é liberada. Confirmar o término por polling antes de marcar a Expedição como Retirada, e liberar a trava no finally.<span style="display: inline-block; width: 1.5px; height: 14px; background: ' +
      FG +
      '; vertical-align: -2px; margin-left: 1px"></span></span></div>',
    "Montado do título e da descrição da Missão. O que você escrever aqui é o que a Guilda recebe.",
  );

  const rodape =
    '<div style="' +
    row("justify-content: space-between; gap: 12px; padding-top: 2px") +
    '">' +
    '<span style="' +
    row("gap: 6px; font-size: 11.5px; color: " + MFG) +
    '">' +
    icon("git-branch", 13) +
    "<span>Worktree novo em " +
    mono(".runs/exp-244", MFG, "font-size: 10.5px") +
    "</span></span>" +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<button style="' +
    btn("outline", "default") +
    '">Cancelar</button>' +
    '<button style="' +
    btn("default", "default") +
    '">' +
    icon("swords", 16) +
    "<span>Partir</span></button></div></div>";

  const dialogo =
    '<div style="' +
    col(
      "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 680px; gap: 16px; padding: 24px; border-radius: 10px; border: 1px solid " +
        BORDER +
        "; background: " +
        BG +
        "; box-shadow: " +
        SHADOW_LG +
        ";",
    ) +
    '">' +
    cabecalho +
    missaoLinha +
    equipamento +
    ambiente +
    aceite +
    prompt +
    rodape +
    "</div>";

  const body =
    '<div style="position: relative; width: 1440px; height: 900px; overflow: hidden">' +
    fundoMissao() +
    '<div style="position: absolute; inset: 0; background: rgb(0 0 0 / 0.5)"></div>' +
    dialogo +
    "</div>";

  return write("NovaExpedicao.dc.html", 1440, 900, body);
}

/* ======================================= ARTBOARD 6 — Equipamentos, Heróis, Guildas */
const LOADOUTS = [
  ["Forja de Plataforma", "Ferreiro de Plataforma · Claude Code", "v4", true],
  ["Planta da Torre", "Arquiteta da Torre · Claude Code", "v2", false],
  ["Vigília de Revisão", "Sentinela · Codex", "v3", false],
  ["Batida de Reconhecimento", "Batedor · Pi", "v1", false],
];

const HEROIS = [
  [
    "Arquiteta da Torre",
    "Arquiteto",
    "Desenha antes de escrever. Propõe o contrato, aponta o que quebra e para antes de implementar.",
  ],
  [
    "Ferreiro de Plataforma",
    "Engenheiro",
    "Implementa e testa no mesmo passo. Não abre uma segunda frente sem fechar a primeira.",
  ],
  [
    "Sentinela",
    "Revisor",
    "Lê o diff inteiro antes de opinar. Separa o que é defeito do que é gosto, e diz qual é qual.",
  ],
  [
    "Batedor",
    "Explorador",
    "Vai ver como é. Volta com fatos, versões e caminhos de arquivo, nunca com uma recomendação sozinha.",
  ],
];

const GUILDAS = [
  [
    "Claude Code",
    "claude 2.1.263",
    [1, 1, 1, 1, 1],
    null,
  ],
  ["Codex", "codex 0.55.0", [1, 1, 1, 1, 1], null],
  ["Pi", "pi 0.9.2", [0, 1, 1, 0, 1], null],
  ["Antigravity", "não instalada", [-1, -1, -1, -1, -1], "Fase 3"],
];

const CAPS = ["retomar", "saída estruturada", "eventos de Item", "uso", "cancelamento"];

export function buildEquipamentos() {
  const listaItem = (l) =>
    '<div style="' +
    row(
      "gap: 11px; padding: 11px 12px; border-radius: 10px; border: 1px solid " +
        (l[3] ? INPUT : "transparent") +
        "; background: " +
        (l[3] ? "oklch(1 0 0 / 0.06)" : "transparent") +
        ";",
    ) +
    '">' +
    '<span style="' +
    row(
      "justify-content: center; width: 30px; height: 30px; flex: none; border-radius: 8px; border: 1px solid " +
        BORDER +
        "; background: " +
        tint(A_VIOLET, l[3] ? "14%" : "8%") +
        "; color: " +
        (l[3] ? A_VIOLET : MFG) +
        ";",
    ) +
    '">' +
    icon("package", 15) +
    "</span>" +
    '<div style="' +
    col("gap: 1px; flex: 1; min-width: 0") +
    '">' +
    '<span style="font-size: 13px; font-weight: ' +
    (l[3] ? "500" : "400") +
    "; color: " +
    FG +
    '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
    l[0] +
    "</span>" +
    '<span style="font-size: 11px; color: ' +
    MFG +
    '; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">' +
    l[1] +
    "</span></div>" +
    '<span style="font-family: ' +
    MONO +
    "; font-size: 10.5px; color: " +
    MFG +
    '; flex: none">' +
    l[2] +
    "</span></div>";

  const lista =
    '<section style="' +
    card(col("gap: 4px; padding: 12px")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; padding: 2px 4px 8px") +
    '">' +
    '<span style="font-size: 13px; font-weight: 500">4 Equipamentos</span>' +
    '<span style="font-size: 11px; color: ' +
    MFG +
    '">1 em uso agora</span></div>' +
    LOADOUTS.map(listaItem).join("") +
    '<div style="' +
    row("gap: 8px; padding: 8px 4px 2px") +
    '">' +
    '<button style="' +
    btn("outline", "sm", "width: 100%") +
    '">' +
    icon("plus", 14) +
    "<span>Novo Equipamento</span></button></div>" +
    "</section>";

  const chipsCampo = (label, itens, iconName) =>
    '<div style="' +
    col("gap: 6px") +
    '">' +
    '<span style="font-size: 12px; color: ' +
    MFG +
    '">' +
    label +
    "</span>" +
    '<div style="' +
    row("gap: 6px; flex-wrap: wrap") +
    '">' +
    itens.map((t) => chip(t, iconName)).join("") +
    '<span style="' +
    row(
      "gap: 4px; height: 22px; padding: 0 8px; border-radius: 8px; border: 1px dashed " +
        INPUT +
        "; font-size: 12px; color: " +
        MFG +
        ";",
    ) +
    '">' +
    icon("plus", 12) +
    "<span>Adicionar</span></span></div></div>";

  const perfilResumo =
    '<div style="' +
    row(
      "gap: 14px; flex-wrap: wrap; padding: 10px 12px; border-radius: 10px; border: 1px solid " +
        BORDER +
        "; background: oklch(1 0 0 / 0.03);",
    ) +
    '">' +
    [
      ["mode", "host", DESTR],
      ["workspaceStrategy", "git-worktree", FG],
      ["permissionPolicy", "advisory", MFG],
      ["environmentPolicy", "allow-list", MFG],
      ["networkPolicy", "sem restrição", DESTR],
    ]
      .map(
        (p) =>
          '<span style="' +
          row("gap: 6px") +
          '"><span style="font-size: 11px; color: ' +
          MFG +
          '">' +
          p[0] +
          "</span>" +
          mono(p[1], p[2], "font-size: 10.5px") +
          "</span>",
      )
      .join("") +
    "</div>";

  const formulario =
    '<section style="' +
    card(col("gap: 16px; padding: 18px 20px 20px")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; align-items: flex-start") +
    '">' +
    '<div style="' +
    col("gap: 3px") +
    '">' +
    '<span style="font-size: 15px; font-weight: 600">Forja de Plataforma</span>' +
    '<span style="font-size: 11.5px; color: ' +
    MFG +
    '">Usado em 14 Expedições · 11 Vitórias</span></div>' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<button style="' +
    btn("ghost", "sm") +
    '">Duplicar</button>' +
    '<button style="' +
    btn("default", "sm") +
    '">Salvar</button></div></div>' +
    '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 20px">' +
    campo("Nome", '<div style="' + inputStyle("width: 100%") + '">Forja de Plataforma</div>') +
    campo(
      "Versão",
      '<div style="' +
        row("gap: 8px") +
        '"><div style="' +
        inputStyle("width: 90px; font-family: " + MONO + "; font-size: 13px") +
        '">v4</div><span style="font-size: 11.5px; color: ' +
        MFG +
        '; align-self: center">Congelada em cada Expedição que a usou</span></div>',
    ) +
    campo("Herói", select("Herói", "Ferreiro de Plataforma · Engenheiro", "100%")) +
    campo("Guilda", select("Guilda", "Claude Code", "100%")) +
    campo("Patrono", select("Patrono", "Claude Opus 5", "100%")) +
    campo("Perfil de execução", select("Perfil", "Campo aberto · worktree por Expedição", "100%")) +
    "</div>" +
    perfilResumo +
    '<div style="' +
    col("gap: 12px") +
    '">' +
    chipsCampo("Habilidades", ["Testes de plataforma", "Windows e macOS", "Git worktree"], "wand-sparkles") +
    chipsCampo("Itens", ["Ler", "Editar", "Buscar", "Shell", "Git", "Testes"], "wrench") +
    chipsCampo("Relíquias", ["Postgres local"], "gem") +
    "</div>" +
    "</section>";

  /* ------------------------------------------------------------- Heróis */
  const heroiLinha = (h, i) =>
    '<div style="' +
    row(
      "gap: 12px; align-items: flex-start; padding: 12px 0;" +
        (i === 0 ? "" : " border-top: 1px solid " + BORDER + ";"),
    ) +
    '">' +
    '<span style="' +
    row(
      "justify-content: center; width: 32px; height: 32px; flex: none; border-radius: 999px; border: 1px solid " +
        BORDER +
        "; background: " +
        MUTED +
        "; color: " +
        FG +
        "; font-size: 11px; font-weight: 600;",
    ) +
    '">' +
    h[0]
      .split(" ")[0]
      .slice(0, 2)
      .toUpperCase() +
    "</span>" +
    '<div style="' +
    col("gap: 3px; flex: 1; min-width: 0") +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '">' +
    '<span style="font-size: 13px; font-weight: 500">' +
    h[0] +
    "</span>" +
    chip(h[1], "shield") +
    "</div>" +
    '<span style="font-size: 11.5px; line-height: 17px; color: ' +
    MFG +
    '">' +
    h[2] +
    "</span></div>" +
    '<span style="color: ' +
    MFG +
    '; display: flex; flex: none; margin-top: 6px">' +
    icon("square-pen", 14) +
    "</span></div>";

  const herois =
    '<section style="' +
    card(col("gap: 0; padding: 16px 20px 14px")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; padding-bottom: 6px") +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '"><span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("users", 15) +
    '</span><span style="font-size: 14px; font-weight: 500">Heróis</span></div>' +
    '<span style="font-size: 11.5px; color: ' +
    MFG +
    '">Classe e instruções · 4 cadastrados</span></div>' +
    HEROIS.map(heroiLinha).join("") +
    "</section>";

  /* ------------------------------------------------------------ Guildas */
  const capItem = (nome, estado) => {
    const c = estado === 1 ? A_GREEN : estado === 0 ? MFG : MFG;
    const ic = estado === 1 ? "check" : estado === 0 ? "x" : "minus";
    return (
      '<span style="' +
      row("gap: 5px; font-size: 11px; color: " + (estado === 1 ? FG : MFG)) +
      '"><span style="color: ' +
      c +
      '; display: flex; flex: none">' +
      icon(ic, 12, "", 2.4) +
      "</span>" +
      nome +
      "</span>"
    );
  };

  const guildaLinha = (g, i) =>
    '<div style="' +
    col(
      "gap: 8px; padding: 12px 0;" +
        (i === 0 ? "" : " border-top: 1px solid " + BORDER + ";") +
        (g[3] ? " opacity: .5;" : ""),
    ) +
    '">' +
    '<div style="' +
    row("gap: 10px") +
    '">' +
    '<span style="color: ' +
    MFG +
    '; display: flex; flex: none">' +
    icon("shield", 15) +
    "</span>" +
    '<span style="font-size: 13px; font-weight: 500">' +
    g[0] +
    "</span>" +
    mono(g[1], MFG, "font-size: 10.5px") +
    '<span style="flex: 1"></span>' +
    (g[3]
      ? '<span style="' +
        row(
          "gap: 5px; height: 20px; padding: 0 8px; border-radius: 999px; border: 1px solid " +
            BORDER +
            "; font-size: 10.5px; color: " +
            MFG +
            ";",
        ) +
        '">' +
        icon("ban", 11) +
        g[3] +
        "</span>"
      : '<span style="font-size: 11px; color: ' + MFG + '">preflight ok</span>') +
    "</div>" +
    '<div style="' +
    row("gap: 14px; flex-wrap: wrap; padding-left: 25px") +
    '">' +
    CAPS.map((c, j) => capItem(c, g[2][j])).join("") +
    "</div></div>";

  const guildas =
    '<section style="' +
    card(col("gap: 0; padding: 16px 20px 14px")) +
    '">' +
    '<div style="' +
    row("justify-content: space-between; padding-bottom: 6px") +
    '">' +
    '<div style="' +
    row("gap: 8px") +
    '"><span style="color: ' +
    MFG +
    '; display: flex">' +
    icon("shield-check", 15) +
    '</span><span style="font-size: 14px; font-weight: 500">Guildas</span></div>' +
    '<span style="font-size: 11.5px; color: ' +
    MFG +
    '">Versão instalada e capabilities do preflight</span></div>' +
    GUILDAS.map(guildaLinha).join("") +
    "</section>";

  const conteudo =
    pageHeader(
      "dnd",
      "Equipamentos",
      "O que um Herói leva para a Expedição: a Guilda, o Patrono, o perfil de execução e o que ele pode usar.",
      '<button style="' +
        btn("default", "default") +
        '">' +
        icon("plus", 16) +
        "<span>Novo Equipamento</span></button>",
    ) +
    '<div style="display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 20px; align-items: start; flex: none">' +
    lista +
    formulario +
    "</div>" +
    '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; flex: none">' +
    herois +
    guildas +
    "</div>";

  return write("Equipamentos.dc.html", 1440, 1160, screen("dnd", "Equipamentos", 1440, 1160, conteudo));
}
