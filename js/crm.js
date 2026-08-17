import {
  decodificar, lerCsv, chaveDoRotulo,
} from './planilha.js';

/**
 * Importação de contatos, com padronização na entrada.
 *
 * O problema real: as listas do gabinete vêm de todo lado — a planilha da
 * campanha, a exportação do WhatsApp Business, a lista de presença de um evento,
 * a agenda do celular de alguém. Cada uma escreve telefone de um jeito, mistura
 * nome com cargo, grafa o mesmo município de três formas e repete a mesma pessoa
 * com o e-mail em maiúsculas.
 *
 * Importar sem padronizar transfere essa bagunça para dentro do sistema, onde ela
 * fica pior: "(51) 99999-9999" e "5199999999" viram dois contatos, buscar
 * "Erechim" não acha "ERECHIM/RS", e o CRM deixa de responder a única pergunta
 * que se faz dele — quem eu conheço nesta cidade.
 *
 * Por isso a padronização é na entrada, e não na exibição: o que está guardado
 * torto contamina toda consulta futura, inclusive a da ficha de apresentação e a
 * do painel por município.
 */

// ───────────────────────────── padronização ─────────────────────────────

/**
 * Telefone em forma canônica: só dígitos, com DDD, sem o zero de operadora.
 *
 * A forma guardada é a comparável; a exibição é outra questão. Guardar
 * "(51) 9 9999-9999" faria a mesma pessoa entrar duas vezes na próxima
 * importação, porque a outra lista escreve "51999999999".
 */
export function telefonePadrao(bruto, ddiPadrao = '55') {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return null;

  // "0800" e afins não são celular nem fixo com DDD: ficam como estão.
  if (/^0[3589]00/.test(d)) return d;
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.startsWith(ddiPadrao) && d.length > 11) d = d.slice(ddiPadrao.length);
  if (d.length < 10 || d.length > 11) return d || null;
  return d;
}

/** Como o telefone aparece na tela, a partir da forma guardada. */
export function telefoneVisivel(padrao) {
  const d = String(padrao ?? '').replace(/\D/g, '');
  // 0800 não tem DDD: formatado como celular virava "(08) 00123-4567", que não é
  // telefone nenhum.
  if (/^0[3589]00/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`.trim();
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || null;
}

/** E-mail comparável: minúsculo e sem espaço. Duas grafias, uma pessoa. */
export function emailPadrao(bruto) {
  const t = String(bruto ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(t) ? t : null;
}

/**
 * Nome em caixa de título, respeitando as partículas.
 *
 * As listas chegam em CAIXA ALTA quase sempre, e "MARIA DAS DORES DE SOUZA" numa
 * ficha impressa parece grito. As partículas ficam minúsculas porque é assim que
 * se escreve nome próprio em português — e é assim que a pessoa reconhece o seu.
 */
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'la', 'y']);

/**
 * Siglas que não viram nome próprio.
 *
 * É lista, não regra: não há como deduzir com segurança que "APAE" é sigla e
 * "Alto" não é. Uma lista curta acerta os casos que aparecem de fato nas listas
 * de um gabinete, e o que ficar de fora sai em caixa de título — errado de um
 * jeito visível e fácil de corrigir à mão, não silencioso.
 */
const SIGLAS = new Set(['APAE', 'ONG', 'CDL', 'CTG', 'UBS', 'SAMU', 'EMEI', 'EMEF', 'EMEB',
  'CRAS', 'CREAS', 'PM', 'BM', 'UPA', 'SUS', 'RS', 'SC', 'PR', 'ACI', 'CIC', 'OAB', 'MDB',
  'PT', 'PL', 'PP', 'PSD', 'PSDB', 'PDT', 'PSB', 'PSOL', 'PCdoB', 'AABB', 'STR']);

export function nomePadrao(bruto) {
  const limpo = String(bruto ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return null;
  // Nome já em caixa mista provavelmente foi digitado por alguém: não se mexe.
  if (/[a-záàâãéêíóôõúç]/.test(limpo) && /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(limpo)) return limpo;

  return limpo.split(' ').map((bruta, i) => {
    const p = bruta.toLowerCase();
    // Sigla continua sigla: "APAE DE ERECHIM" não é "Apae de Erechim".
    if (SIGLAS.has(bruta.toUpperCase())) return bruta.toUpperCase();
    if (i > 0 && PARTICULAS.has(p)) return p;
    if (/^[ivxlcdm]+$/.test(p) && p.length <= 4) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

/**
 * Município e UF, que chegam grudados de meia dúzia de formas.
 *
 * "ERECHIM/RS", "Erechim - RS", "Erechim (RS)" e "ERECHIM RS" são a mesma
 * cidade. Sem separar, o painel por município e a ficha de apresentação passam a
 * ter quatro Erechins, cada um com um pedaço dos contatos.
 */
const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

export function localPadrao(bruto, ufDaColuna = null) {
  const t = String(bruto ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return { municipio: null, uf: ufDaColuna || null };

  // Com separador explícito, as duas últimas letras são a UF sem dúvida.
  const comSeparador = /^(.+?)\s*[-/(,]\s*([A-Za-z]{2})\)?$/.exec(t);
  if (comSeparador && comSeparador[1].trim().length >= 3) {
    return { municipio: nomePadrao(comSeparador[1].trim()), uf: comSeparador[2].toUpperCase() };
  }

  // Sem separador, só se a última PALAVRA inteira for uma UF de verdade.
  // A regra anterior recortava duas letras de onde estivessem, e "SANTA MARIA DO
  // HERVAL" virava a cidade "Santa Maria do Herv" no estado "AL" — um município
  // inventado, que ainda estragaria o agrupamento por cidade.
  const palavras = t.split(' ');
  const ultima = palavras[palavras.length - 1].replace(/[^A-Za-z]/g, '').toUpperCase();
  if (palavras.length > 1 && ultima.length === 2 && UFS.has(ultima)) {
    return { municipio: nomePadrao(palavras.slice(0, -1).join(' ')), uf: ultima };
  }
  return { municipio: nomePadrao(t), uf: ufDaColuna || null };
}

/**
 * A categoria, deduzida do que a lista disser.
 *
 * O CRM precisa da categoria para filtrar, e nenhuma lista de fora usa o mesmo
 * vocabulário. Sem dedução, tudo entraria como "cidadão" e a categoria deixaria
 * de distinguir qualquer coisa — que é o mesmo defeito dos filtros de orçamento.
 */
const CATEGORIAS = [
  { v: 'prefeitura', re: /prefeit|prefeito|vice-?prefeito|secret[áa]ri[oa]\s+municipal/i },
  { v: 'vereador', re: /vereador|c[âa]mara\s+municipal|presidente\s+da\s+c[âa]mara/i },
  { v: 'lideranca', re: /lideran|deputad|senador|dirigente|presidente\s+(?:do|de)\s+partido|militante/i },
  { v: 'entidade', re: /associa|sindicat|coopera|apae|clube|igreja|pastor|padre|ong|entidade|c[âa]mara\s+de\s+dirigentes/i },
  { v: 'empresa', re: /empres|ltda|s\.?a\.?$|comerci|ind[úu]stria|loja|agroneg/i },
  { v: 'orgao', re: /[óo]rg[ãa]o|minist[ée]rio|autarquia|delegacia|brigada|pol[íi]cia|hospital|escola|universidade/i },
];

export function categoriaDe(...textos) {
  const t = textos.filter(Boolean).join(' ');
  return (CATEGORIAS.find((c) => c.re.test(t)) || {}).v || 'cidadao';
}

// ─────────────────────────── leitura da planilha ───────────────────────────

/** Sinônimos de coluna, porque cada lista nomeia do seu jeito. */
const COLUNAS = {
  nome: ['nome', 'nome completo', 'contato', 'razao social', 'nome do contato', 'first name', 'full name'],
  cargo: ['cargo', 'funcao', 'ocupacao', 'profissao', 'title', 'job title'],
  telefone: ['telefone', 'celular', 'fone', 'whatsapp', 'telefone 1', 'phone', 'mobile phone', 'contato telefonico'],
  telefone2: ['telefone 2', 'telefone alternativo', 'outro telefone', 'home phone'],
  email: ['email', 'e mail', 'endereco de email', 'e mail address', 'email address'],
  municipio: ['municipio', 'cidade', 'localidade', 'city', 'municipio uf', 'cidade uf'],
  uf: ['uf', 'estado', 'sigla uf', 'state'],
  categoria: ['categoria', 'tipo', 'segmento', 'grupo', 'classificacao'],
  temas: ['temas', 'tema', 'interesse', 'interesses', 'assunto', 'tags', 'pauta'],
  observacoes: ['observacoes', 'observacao', 'notas', 'nota', 'obs', 'notes', 'comentarios'],
};

export function mapearColunasDeContato(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};
  for (const [campo, sinonimos] of Object.entries(COLUNAS)) {
    let i = chaves.findIndex((c) => sinonimos.includes(c));
    if (i === -1) i = chaves.findIndex((c) => sinonimos.some((sn) => c.includes(sn)));
    if (i !== -1) mapa[campo] = i;
  }
  return mapa;
}

/**
 * A chave de um contato.
 *
 * O telefone padronizado identifica melhor que o nome — homônimo é comum, e a
 * mesma pessoa aparece como "José Silva" numa lista e "Jose da Silva" na outra.
 * Sem telefone, o e-mail; sem os dois, nome mais município, que é o par que o
 * gabinete usa para saber se já conhece alguém.
 */
export function chaveDoContato({ telefone, email, nome, municipio }) {
  const limpo = (v) => String(v ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (telefone) return `t-${String(telefone).replace(/\D/g, '')}`;
  if (email) return `e-${limpo(email)}`;
  if (nome) return `n-${limpo(nome)}-${limpo(municipio).slice(0, 24)}`;
  return null;
}

/** Uma linha da planilha virada contato padronizado. */
export function contatoDaLinha(linha, mapa, { ufPadrao = null } = {}) {
  const campo = (nome) => (mapa[nome] === undefined ? null : String(linha[mapa[nome]] ?? '').trim());

  const nomeBruto = campo('nome');
  const cargo = campo('cargo');
  const local = localPadrao(campo('municipio'), (campo('uf') || ufPadrao || '').toUpperCase() || null);
  const telefone = telefonePadrao(campo('telefone')) || telefonePadrao(campo('telefone2'));

  const temas = (campo('temas') || '')
    .split(/[;,|/]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);

  return {
    nome: nomePadrao(nomeBruto),
    cargo: cargo || null,
    categoria: categoriaDe(campo('categoria'), cargo, nomeBruto),
    municipio: local.municipio,
    uf: local.uf,
    telefone,
    email: emailPadrao(campo('email')),
    temas: temas.length ? temas : null,
    observacoes: campo('observacoes') || null,
    fonte: 'planilha importada',
  };
}

/**
 * Lê a planilha, padroniza e concilia com o que já existe.
 *
 * Conciliar em vez de acrescentar: reimportar a mesma lista é o caso comum — a
 * pessoa exporta de novo depois de atualizar dois telefones — e uma importação
 * que só insere transformaria o CRM em três cópias da mesma base em um mês.
 *
 * O que já está preenchido não é apagado por vazio: a planilha da campanha não
 * tem o e-mail que o assessor anotou no ano passado, e deixá-la sobrescrever com
 * nada perderia o trabalho de quem alimentou o sistema à mão.
 */
export async function importarContatos(arquivo, { ufPadrao = null } = {}) {
  const texto = decodificar(await arquivo.arrayBuffer());
  const { cabecalho, linhas } = lerCsv(texto);
  if (!cabecalho.length) throw new Error('O arquivo está vazio ou não é uma planilha de texto.');

  const mapa = mapearColunasDeContato(cabecalho);
  if (mapa.nome === undefined) {
    throw new Error(`Não encontrei a coluna de nome em "${cabecalho.slice(0, 6).join(', ')}…". A planilha precisa ter ao menos o nome do contato.`);
  }

  const { salvarEmLote, listar } = await import('./dados.js');
  const existentes = new Map((await listar('contatos', { recarregar: true })).map((c) => [c.id, c]));

  const funil = {
    linhas: linhas.length,
    novos: 0,
    atualizados: 0,
    semChave: 0,
    semTelefone: 0,
    porCategoria: {},
    colunasLidas: Object.keys(mapa),
    colunasIgnoradas: cabecalho.filter((r, i) => !Object.values(mapa).includes(i) && String(r).trim()),
  };

  const registros = [];
  const vistos = new Set();

  for (const linha of linhas) {
    const contato = contatoDaLinha(linha, mapa, { ufPadrao });
    if (!contato.nome && !contato.telefone && !contato.email) continue;

    const id = chaveDoContato(contato);
    if (!id) { funil.semChave += 1; continue; }
    if (vistos.has(id)) continue;
    vistos.add(id);
    if (!contato.telefone) funil.semTelefone += 1;
    funil.porCategoria[contato.categoria] = (funil.porCategoria[contato.categoria] || 0) + 1;

    const anterior = existentes.get(id);
    const dados = {};
    for (const [k, v] of Object.entries(contato)) {
      if (v === null || v === undefined || v === '') continue;
      dados[k] = v;
    }
    // As observações se somam em vez de substituir: são anotação de gente, e a
    // da planilha não invalida a que o gabinete escreveu.
    if (anterior?.observacoes && dados.observacoes && !anterior.observacoes.includes(dados.observacoes)) {
      dados.observacoes = `${anterior.observacoes}\n${dados.observacoes}`;
    }
    dados.importadoEm = new Date().toISOString().slice(0, 10);

    if (anterior) funil.atualizados += 1;
    else funil.novos += 1;
    registros.push({ id, dados });
  }

  if (registros.length) {
    const gravacao = await salvarEmLote('contatos', registros);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }
  return funil;
}
