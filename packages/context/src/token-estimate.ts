// Adapted from TencentDB Agent Memory — MemoryCore/src/offload/fast-token-estimate.ts@3efcd31
// Copyright (c) 2026 Tencent. Licensed under the MIT License.
// Changes: a tabela binária de custo por caractere CJK (`cjk_token_table.bin`,
// lida do disco por `readFileSync`) não veio — o pacote é puro e não toca
// arquivo —, então todo Han usa a constante de 1,3 token que o original já
// usava quando a tabela não estava disponível. Os imports de `fs`, `path` e
// `url` saíram com ela. `fastEstimateMessages` deixou de aceitar `any[]` e
// passou a receber `readonly unknown[]`. Comentários traduzidos; o algoritmo
// de classificação por codepoint e os coeficientes por categoria são os do
// original.

/**
 * Estimador rápido de tokens — port em TypeScript de
 * `token_count/fast_token_estimate.py`. Mira a codificação `cl100k_base`
 * (GPT-4, Claude, DeepSeek, GLM, MiniMax).
 *
 * Precisão: erro de ~2–7% na maioria das línguas (medido contra o tiktoken).
 * Velocidade: ~5 ms por 100 mil caracteres (contra 3–10 s do tiktoken).
 *
 * Algoritmo: uma passada de classificação de caracteres com coeficientes por
 * categoria. Sem BPE, sem regex de split — só aritmética sobre codepoints.
 *
 * É o que o orçamento de contexto usa (planejamento v0.4, Fase 7): a
 * estimativa precisa ser barata porque roda para cada item candidato, e a
 * margem de erro é absorvida pelo orçamento, que é um teto e não uma conta.
 */

/** Custo por caractere Han quando não há tabela: o mesmo fallback do original. */
const CJK_FALLBACK_TOKENS = 1.3;

// ─── Classificação de caracteres ───────────────────────────────────────────

function isLatinLetter(cp: number): boolean {
  return (
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0x00c0 && cp <= 0x00ff && cp !== 0x00d7 && cp !== 0x00f7) ||
    (cp >= 0x0100 && cp <= 0x024f)
  );
}

function isCjkHan(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff)
  );
}

function isKana(cp: number): boolean {
  return (cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff);
}

function isHangul(cp: number): boolean {
  return (
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0x1100 && cp <= 0x11ff) ||
    (cp >= 0x3130 && cp <= 0x318f)
  );
}

function isCyrillic(cp: number): boolean {
  return (cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x0500 && cp <= 0x052f);
}

function isArabic(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

function isGreek(cp: number): boolean {
  return (cp >= 0x0370 && cp <= 0x03ff) || (cp >= 0x1f00 && cp <= 0x1fff);
}

// ─── O estimador ───────────────────────────────────────────────────────────

/**
 * Estima a contagem de tokens de um texto sem codificar BPE.
 *
 * Mira `cl100k_base`. Erro tipicamente abaixo de 5% para código e inglês, e
 * abaixo de 10% para CJK e texto misto.
 */
export function fastEstimateTokens(text: string): number {
  if (!text) return 0;

  const n = text.length;
  let tokens = 0.0;
  let i = 0;

  // Pré-varredura: detecta latim não inglês (francês, espanhol, português...).
  let accentCount = 0;
  let latinCount = 0;
  const sampleEnd = Math.min(n, 50_000);
  for (let s = 0; s < sampleEnd; s++) {
    const cp = text.charCodeAt(s);
    if (
      cp >= 0x80 &&
      cp <= 0x024f &&
      ((cp >= 0x00c0 && cp <= 0x00ff && cp !== 0x00d7 && cp !== 0x00f7) ||
        (cp >= 0x0100 && cp <= 0x024f))
    ) {
      accentCount++;
    }
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
      latinCount++;
    }
  }
  const isNonEnglishLatin = latinCount > 100 && accentCount > latinCount * 0.005;

  while (i < n) {
    const cp = text.charCodeAt(i);

    // ── Palavra latina ──
    if (isLatinLetter(cp)) {
      let j = i + 1;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (isLatinLetter(c)) {
          j++;
        } else if (c === 0x27 && j + 1 < n && isLatinLetter(text.charCodeAt(j + 1))) {
          j += 2;
        } else {
          break;
        }
      }
      const wl = j - i;

      // A palavra tem caracteres acentuados?
      let hasAccent = false;
      if (isNonEnglishLatin) {
        for (let k = i; k < j; k++) {
          if (text.charCodeAt(k) >= 0x80) {
            hasAccent = true;
            break;
          }
        }
        if (!hasAccent) {
          // Olha a vizinhança.
          const lo = Math.max(0, i - 100);
          const hi = Math.min(n, j + 100);
          for (let k = lo; k < hi; k++) {
            const cc = text.charCodeAt(k);
            if (cc >= 0x00c0 && cc <= 0x024f && cc !== 0x00d7 && cc !== 0x00f7) {
              hasAccent = true;
              break;
            }
          }
        }
      }

      if (hasAccent) {
        // Palavras latinas não inglesas custam mais tokens.
        if (wl <= 3) tokens += 1.0;
        else if (wl <= 5) tokens += 1.35;
        else if (wl <= 7) tokens += 1.85;
        else if (wl <= 9) tokens += 2.5;
        else if (wl <= 12) tokens += 3.2;
        else tokens += 3.2 + (wl - 12) * 0.32;
      } else {
        // Palavra inglesa.
        if (wl <= 4) tokens += 1.0;
        else if (wl <= 8) tokens += 1.1;
        else if (wl <= 13) tokens += 1.5;
        else tokens += 1.5 + (wl - 13) * 0.3;
      }
      i = j;
      continue;
    }

    // ── Han (CJK) ──
    if (isCjkHan(cp)) {
      let j = i + 1;
      let segTokens = CJK_FALLBACK_TOKENS;
      while (j < n && isCjkHan(text.charCodeAt(j))) {
        segTokens += CJK_FALLBACK_TOKENS;
        j++;
      }
      const run = j - i;
      // O BPE funde caracteres CJK adjacentes; segmentos longos fundem mais.
      if (run >= 4) segTokens *= 0.94;
      else if (run >= 2) segTokens *= 0.97;
      tokens += segTokens;
      i = j;
      continue;
    }

    // ── Kana ──
    if (isKana(cp)) {
      let j = i + 1;
      while (j < n && isKana(text.charCodeAt(j))) j++;
      const run = j - i;
      if (run === 1) tokens += 1.0;
      else if (run === 2) tokens += 1.6;
      else if (run === 3) tokens += 2.65;
      else if (run === 4) tokens += 3.7;
      else if (run <= 6) tokens += run * 0.93;
      else tokens += run * 0.95;
      i = j;
      continue;
    }

    // ── Hangul ──
    if (isHangul(cp)) {
      tokens += 1.4;
      i++;
      continue;
    }

    // ── Cirílico ──
    if (isCyrillic(cp)) {
      let j = i + 1;
      while (j < n && isCyrillic(text.charCodeAt(j))) j++;
      tokens += (j - i) * 0.55;
      i = j;
      continue;
    }

    // ── Árabe ──
    if (isArabic(cp)) {
      let j = i + 1;
      while (j < n && isArabic(text.charCodeAt(j))) j++;
      tokens += (j - i) * 0.82;
      i = j;
      continue;
    }

    // ── Grego ──
    if (isGreek(cp)) {
      let j = i + 1;
      while (j < n && isGreek(text.charCodeAt(j))) j++;
      tokens += (j - i) * 0.85;
      i = j;
      continue;
    }

    // ── Dígitos (com vírgulas e pontos) ──
    if (cp >= 0x30 && cp <= 0x39) {
      let j = i + 1;
      let digits = 1;
      let commas = 0;
      let dots = 0;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c >= 0x30 && c <= 0x39) {
          digits++;
          j++;
        } else if (
          c === 0x2c &&
          j + 1 < n &&
          text.charCodeAt(j + 1) >= 0x30 &&
          text.charCodeAt(j + 1) <= 0x39
        ) {
          commas++;
          j += 2;
          digits++;
        } else if (
          c === 0x2e &&
          j + 1 < n &&
          text.charCodeAt(j + 1) >= 0x30 &&
          text.charCodeAt(j + 1) <= 0x39
        ) {
          dots++;
          j += 2;
          digits++;
        } else {
          break;
        }
      }
      if (digits <= 3 && commas === 0 && dots === 0) tokens += 1.0;
      else if (commas > 0) tokens += commas * 2 + 1.0;
      else if (dots > 0) tokens += Math.max(2.0, digits / 3.0 + dots * 1.5);
      else tokens += Math.max(1.0, digits / 2.5);
      i = j;
      continue;
    }

    // ── Espaço e tabulação ──
    if (cp === 0x20 || cp === 0x09) {
      i++;
      continue;
    }

    // ── Quebra de linha ──
    if (cp === 0x0a || cp === 0x0d) {
      tokens += 1.0;
      i++;
      continue;
    }

    // ── Pontuação de largura inteira ──
    if (
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0xff00 && cp <= 0xffef) ||
      cp === 0x2018 ||
      cp === 0x2019 ||
      cp === 0x201c ||
      cp === 0x201d ||
      cp === 0x2014 ||
      cp === 0x2026 ||
      cp === 0x2013
    ) {
      tokens += 1.0;
      i++;
      continue;
    }

    // ── Pontuação ASCII ──
    if (cp >= 0x21 && cp <= 0x7e) {
      tokens += 0.6;
      i++;
      continue;
    }

    // ── Outros (emoji etc.) ──
    if (cp > 0x7f) {
      tokens += 2.5;
      i++;
      continue;
    }

    i++;
  }

  return Math.max(1, Math.round(tokens));
}

/**
 * Estima os tokens de uma lista de mensagens, serializando cada uma em JSON
 * (o mesmo que `buildTiktokenContextSnapshot` faz, com a estimativa rápida no
 * lugar do tiktoken).
 */
export function fastEstimateMessages(
  messages: readonly unknown[],
  jsonReplacer?: (key: string, value: unknown) => unknown,
): number {
  let total = 0;
  for (const msg of messages) {
    const str = JSON.stringify(msg, jsonReplacer);
    total += fastEstimateTokens(str);
  }
  // Sobrecarga do array JSON.
  total += Math.ceil(messages.length * 0.5);
  return total;
}
