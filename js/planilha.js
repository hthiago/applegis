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

/** Reparte uma linha em campos, respeitando aspas. */
export function dividirLinha(linha, sep) {
  const campos = [];
  let campo = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (dentroDeAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') { campo += '"'; i += 1; } else dentroDeAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { dentroDeAspas = true; continue; }
    if (c === sep) { campos.push(campo); campo = ''; continue; }
    campo += c;
  }
  campos.push(campo);
  return campos;
}

/**
 * Descobre a codificação do arquivo antes de começar a ler.
 *
 * Decidir pelo primeiro pedaço não serve: o cabeçalho do TSE é ASCII puro
 * ("NM_UE;DS_CARGO;…"), que é válido nas duas codificações. A escolha caía em
 * UTF-8 e os acentos das primeiras cidades viravam losango — "SÃO JOSÉ" virava
 * "S?O JOS?" e a chave do município saía diferente da que já estava guardada.
 *
 * Então a decisão espera a primeira evidência de verdade: o primeiro pedaço com
 * byte alto. Se ele decodificar como UTF-8 e produzir caractere acentuado, é
 * UTF-8; se estourar, é windows-1252. Byte alto na fronteira do pedaço não
 * decide nada — fica pendente no decodificador e a evidência vem na rodada
 * seguinte, que é justamente o que o modo `stream` existe para fazer.
 */
export async function descobrirCodificacao(arquivo, pedaco) {
  const sonda = new TextDecoder('utf-8', { fatal: true });
  for (let inicio = 0; inicio < arquivo.size; inicio += pedaco) {
    const bytes = new Uint8Array(await arquivo.slice(inicio, inicio + pedaco).arrayBuffer());
    if (!bytes.some((b) => b > 127)) continue;
    try {
      const texto = sonda.decode(bytes, { stream: true });
      for (const c of texto) if (c.charCodeAt(0) > 127) return 'utf-8';
    } catch {
      return 'windows-1252';
    }
  }
  return 'utf-8';
}

/**
 * Lê uma planilha grande sem carregá-la inteira na memória.
 *
 * `lerCsv` monta a matriz completa, o que serve para as exportações de dezenas
 * de milhares de linhas — e derruba a aba nos arquivos do TSE. A votação por
 * município e zona de um estado tem mais de um milhão de linhas: o arquivo em
 * texto vira uma string do dobro do tamanho, e a matriz de campos vira dezenas
 * de milhões de strings. A página não trava, ela morre.
 *
 * Aqui o arquivo é lido em pedaços, decodificado em fluxo e entregue linha a
 * linha a quem chamou, que soma o que interessa e descarta o resto. O uso de
 * memória passa a ser o do resultado, não o do arquivo.
 *
 * O `await` de cada pedaço devolve o quadro ao navegador de propósito: sem ele a
 * aba congela por minutos e o sistema operacional oferece encerrá-la, que é
 * exatamente o que se está tentando evitar.
 */
export async function lerCsvEmFluxo(arquivo, aoRegistro, {
  aoAndar = null, pedaco = 4 * 1024 * 1024,
} = {}) {
  const total = arquivo.size;
  let decodificador = null;
  let separador = null;
  let cabecalho = null;
  let registros = 0;
  let resto = '';

  const entregar = (linha) => {
    if (!linha.trim()) return;
    if (separador === null) separador = detectarSeparador(linha);
    const campos = dividirLinha(linha, separador);
    if (!cabecalho) { cabecalho = campos.map((v) => v.replace(BOM, '').trim()); return; }
    registros += 1;
    aoRegistro(campos, cabecalho, registros);
  };

  // Uma linha completa sempre termina fora de aspas, então o que sobra de um
  // pedaço começa em fronteira de registro: dá para reiniciar o estado de aspas
  // a cada rodada sem risco de partir um campo ao meio.
  const consumir = (texto, ultimo) => {
    let inicio = 0;
    let dentroDeAspas = false;
    for (let i = 0; i < texto.length; i += 1) {
      const c = texto[i];
      if (c === '"') { dentroDeAspas = !dentroDeAspas; continue; }
      if (dentroDeAspas) continue;
      if (c === '\n' || c === '\r') {
        entregar(texto.slice(inicio, i));
        if (c === '\r' && texto[i + 1] === '\n') i += 1;
        inicio = i + 1;
      }
    }
    resto = texto.slice(inicio);
    if (ultimo && resto) { entregar(resto); resto = ''; }
  };

  decodificador = new TextDecoder(await descobrirCodificacao(arquivo, pedaco));

  for (let inicio = 0; inicio < total; inicio += pedaco) {
    const buffer = await arquivo.slice(inicio, inicio + pedaco).arrayBuffer();
    const texto = decodificador.decode(buffer, { stream: inicio + pedaco < total });
    consumir(resto + texto, false);
    if (aoAndar) aoAndar(Math.min(inicio + pedaco, total), total, registros);
    await new Promise((r) => { setTimeout(r, 0); });
  }
  consumir(resto, true);

  return { cabecalho: cabecalho || [], registros };
}

/**
 * Lê um .xlsx — sem biblioteca, sem etapa de compilação.
 *
 * Isto faltava, e faltava caro: quem exporta de um painel do governo recebe
 * .xlsx, não .csv. O leitor antigo tratava tudo como texto, então um .xlsx
 * chegava como lixo binário e a mensagem dizia "o arquivo está vazio ou não é
 * uma planilha de texto" — que é verdade e não ajuda em nada, porque o arquivo
 * estava certo e a ferramenta é que não sabia abri-lo.
 *
 * Um .xlsx é um ZIP com XML dentro. O navegador já descompacta (DecompressionStream)
 * e o XML da planilha é regular o bastante para ser lido sem um analisador
 * completo. Zero dependência: o projeto inteiro se publica copiando a pasta, e
 * uma biblioteca aqui custaria isso.
 */
function lerZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const vista = new DataView(buffer);
  // O diretório central, no fim do arquivo, é a fonte confiável de tamanhos e
  // posições: no cabeçalho local eles podem vir zerados quando o gravador usa
  // descritor de dados, e foi assim que a primeira versão leu metade dos nomes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i -= 1) {
    if (vista.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('O arquivo não é um .xlsx válido (não achei o índice do ZIP).');

  const total = vista.getUint16(eocd + 10, true);
  let p = vista.getUint32(eocd + 16, true);
  const entradas = [];
  for (let i = 0; i < total; i += 1) {
    if (vista.getUint32(p, true) !== 0x02014b50) break;
    const metodo = vista.getUint16(p + 10, true);
    const comprimido = vista.getUint32(p + 20, true);
    const nomeTam = vista.getUint16(p + 28, true);
    const extraTam = vista.getUint16(p + 30, true);
    const comentarioTam = vista.getUint16(p + 32, true);
    const inicio = vista.getUint32(p + 42, true);
    const nome = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nomeTam));
    entradas.push({ nome, metodo, comprimido, inicio });
    p += 46 + nomeTam + extraTam + comentarioTam;
  }
  return { bytes, vista, entradas };
}

async function extrair(zip, nome) {
  const e = zip.entradas.find((x) => x.nome === nome);
  if (!e) return null;
  // O cabeçalho local tem tamanho variável e é onde os dados começam de fato.
  const nomeTam = zip.vista.getUint16(e.inicio + 26, true);
  const extraTam = zip.vista.getUint16(e.inicio + 28, true);
  const dados = zip.bytes.subarray(
    e.inicio + 30 + nomeTam + extraTam,
    e.inicio + 30 + nomeTam + extraTam + e.comprimido,
  );
  if (e.metodo === 0) return new TextDecoder('utf-8').decode(dados);
  const fluxo = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(fluxo).text();
}

/** Desfaz as entidades do XML. São poucas e fixas — não vale um analisador. */
function semEntidades(t) {
  return String(t)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** A coluna de uma célula ("BC12" → 54), para não perder célula vazia no meio. */
export function indiceDaColuna(referencia) {
  const letras = /^([A-Z]+)/.exec(String(referencia || '').toUpperCase());
  if (!letras) return null;
  let n = 0;
  for (const c of letras[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export async function lerXlsx(buffer) {
  const zip = lerZip(buffer);

  // Os textos ficam numa tabela à parte, e a célula guarda só o índice dela.
  const textos = [];
  const compartilhados = await extrair(zip, 'xl/sharedStrings.xml');
  if (compartilhados) {
    for (const si of compartilhados.split('<si>').slice(1)) {
      // Texto com formatação vem partido em vários <t>; juntar é o certo.
      const pedacos = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => semEntidades(m[1]));
      textos.push(pedacos.join(''));
    }
  }

  const primeira = zip.entradas.find((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.nome));
  if (!primeira) throw new Error('O .xlsx não tem nenhuma planilha dentro.');
  const folha = await extrair(zip, primeira.nome);

  const linhas = [];
  for (const bruto of folha.split(/<row[\s>]/).slice(1)) {
    const celulas = [];
    // A célula vazia vem autofechada — `<c r="B1" s="4"/>` — e a forma com
    // conteúdo precisa ser testada DEPOIS dela. Na ordem inversa, `[^>]*`
    // engolia a própria barra: a vazia era lida como abertura e consumia a
    // célula seguinte como conteúdo. O efeito era uma coluna sumir e o valor
    // dela aparecer na anterior — deslocamento silencioso, sem erro nenhum, em
    // qualquer planilha com buraco no meio.
    for (const m of bruto.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const atributos = m[1] ?? m[2] ?? '';
      const corpo = m[3] ?? '';
      const onde = indiceDaColuna(/r="([A-Z]+\d+)"/.exec(atributos)?.[1]);
      const tipo = /t="([^"]+)"/.exec(atributos)?.[1];
      let valor = '';
      if (tipo === 'inlineStr') {
        valor = [...corpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => semEntidades(x[1])).join('');
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1];
        if (v != null) valor = tipo === 's' ? (textos[Number(v)] ?? '') : semEntidades(v);
      }
      const i = onde == null ? celulas.length : onde;
      while (celulas.length < i) celulas.push('');
      celulas[i] = valor;
    }
    linhas.push(celulas);
  }

  const uteis = linhas.filter((l) => l.some((v) => String(v).trim() !== ''));
  if (!uteis.length) return { cabecalho: [], linhas: [] };
  return { cabecalho: uteis[0].map((v) => String(v).trim()), linhas: uteis.slice(1) };
}

/** É um .xlsx? Os dois primeiros bytes de todo ZIP são "PK". */
export function pareceXlsx(arquivo, buffer) {
  if (/\.xlsx?$/i.test(arquivo?.name || '')) {
    const b = new Uint8Array(buffer);
    return b[0] === 0x50 && b[1] === 0x4b;
  }
  const b = new Uint8Array(buffer);
  return b[0] === 0x50 && b[1] === 0x4b;
}

/** Lê a planilha seja ela texto ou .xlsx — quem exporta de painel recebe .xlsx. */
export async function lerPlanilha(arquivo) {
  const buffer = await arquivo.arrayBuffer();
  if (pareceXlsx(arquivo, buffer)) return lerXlsx(buffer);
  return lerCsv(decodificar(buffer));
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

/**
 * O nome como as bases federais o gravam: caixa alta, sem acento.
 *
 * O Portal da Transparência guarda "VINICIUS GURGEL" e casa o filtro pela forma
 * exata — mandar "Vinícius Gurgel" devolve zero registros, sem erro nenhum, o
 * que parece ausência de emendas e não é.
 */
export function nomeParaBusca(nome) {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compara nomes ignorando acento, caixa e pontuação. */
export function mesmoNome(a, b) {
  const x = chaveDoRotulo(a);
  const y = chaveDoRotulo(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
