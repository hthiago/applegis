/**
 * Leitura de planilhas exportadas de sistemas públicos.
 *
 * Os arquivos do Portal da Transparência, do Transferegov, do SIOP e do Fundo
 * Nacional de Saúde não seguem um formato só. Variam no separador (ponto e
 * vírgula quase sempre, vírgula às vezes, tabulação nos que passaram pelo
 * Excel), na codificação (muitos ainda saem em ISO-8859-1) e na escrita dos
 * números — "1.234.567,89" com ponto de milhar e vírgula decimal.
 *
 * Tudo aqui é função pura sobre texto. É a parte do caminho que dá para
 * conferir sem depender de rede nem de arquivo real, e é onde mora a maioria
 * dos erros de importação.
 */

/** Marca de ordem de bytes que o Excel escreve no começo dos CSV que gera. */
const BOM = '﻿';

/**
 * Decodifica o arquivo tentando UTF-8 e caindo para Windows-1252.
 *
 * Exportações de sistemas públicos ainda saem em ISO-8859-1 com frequência.
 * Decodificar esse conteúdo como UTF-8 não falha — devolve texto com o caractere
 * de substituição no lugar de cada acento, o que é pior do que um erro, porque
 * passa despercebido até alguém ler "SÃ£o Paulo" numa lista.
 */
export function decodificar(buffer) {
  const comoUtf8 = new TextDecoder('utf-8').decode(buffer);
  if (!comoUtf8.includes('�')) return comoUtf8;
  try {
    return new TextDecoder('windows-1252').decode(buffer);
  } catch {
    return comoUtf8;
  }
}

/**
 * Descobre o separador contando ocorrências fora de aspas na primeira linha.
 * O cabeçalho é a linha mais confiável para isso: não costuma ter texto livre.
 */
export function detectarSeparador(texto) {
  const primeira = texto.replace(BOM, '').split(/\r?\n/)[0] || '';
  const candidatos = [';', ',', '\t', '|'];
  let melhor = ';';
  let maior = 0;

  for (const sep of candidatos) {
    let fora = 0;
    let dentroDeAspas = false;
    for (const c of primeira) {
      if (c === '"') dentroDeAspas = !dentroDeAspas;
      else if (c === sep && !dentroDeAspas) fora += 1;
    }
    if (fora > maior) { maior = fora; melhor = sep; }
  }
  return melhor;
}

/**
 * Reparte o texto em linhas e colunas, respeitando aspas.
 *
 * Campos entre aspas podem conter o separador e quebras de linha — o objeto de
 * um convênio quase sempre contém as duas coisas —, então não dá para repartir
 * por linha antes de repartir por coluna.
 */
export function lerCsv(texto, separador = null) {
  const conteudo = String(texto || '').replace(BOM, '');
  const sep = separador || detectarSeparador(conteudo);

  const linhas = [];
  let campo = '';
  let linha = [];
  let dentroDeAspas = false;

  for (let i = 0; i < conteudo.length; i += 1) {
    const c = conteudo[i];

    if (dentroDeAspas) {
      if (c === '"') {
        // Aspas dobradas dentro do campo representam uma aspa literal.
        if (conteudo[i + 1] === '"') { campo += '"'; i += 1; } else dentroDeAspas = false;
      } else campo += c;
      continue;
    }

    if (c === '"') { dentroDeAspas = true; continue; }
    if (c === sep) { linha.push(campo); campo = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && conteudo[i + 1] === '\n') i += 1;
      linha.push(campo);
      linhas.push(linha);
      campo = '';
      linha = [];
      continue;
    }
    campo += c;
  }

  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }

  const uteis = linhas.filter((l) => l.some((v) => String(v).trim() !== ''));
  if (!uteis.length) return { cabecalho: [], linhas: [] };

  return {
    cabecalho: uteis[0].map((v) => v.trim()),
    linhas: uteis.slice(1),
  };
}

/** Reduz um rótulo a uma chave comparável: sem acento, sem pontuação, minúsculo. */
export function chaveDoRotulo(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Converte número escrito à brasileira.
 *
 * Cuidado com o caso ambíguo: "1.234" pode ser mil duzentos e trinta e quatro
 * ou um inteiro com separador de milhar. Quando não há vírgula decimal e o
 * grupo depois do último ponto tem exatamente três dígitos, trata-se de milhar
 * — que é a leitura certa em planilha de orçamento, onde centavos sempre vêm
 * com vírgula.
 */
export function numeroBr(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;

  let t = String(valor ?? '').trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '');
  if (!t || t === '-' || t === '--') return null;

  const negativo = /^\(.*\)$/.test(t) || t.startsWith('-');
  t = t.replace(/^[-(]|\)$/g, '');

  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');

  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/** Data em qualquer das formas que esses sistemas usam, devolvida como ISO. */
export function dataBr(valor) {
  const t = String(valor ?? '').trim();
  if (!t) return null;

  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return iso[0];

  return null;
}

/** Compara nomes ignorando acento, caixa e pontuação. */
export function mesmoNome(a, b) {
  const x = chaveDoRotulo(a);
  const y = chaveDoRotulo(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
