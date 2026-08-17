import { decodificar, lerCsv, chaveDoRotulo, numeroBr } from './planilha.js';
import { nomePadrao } from './crm.js';

/**
 * Votação por município, a partir da planilha do TSE.
 *
 * Por planilha, e não por API: o TSE publica os resultados em arquivos abertos
 * no repositório de dados eleitorais, e é de lá que sai o número que o gabinete
 * usa. Escrever um leitor para uma API que eu não consigo alcançar daqui já
 * custou caro neste projeto — e aqui não haveria ganho, porque o arquivo é
 * publicado uma vez a cada eleição e não muda depois.
 *
 * O que este arquivo faz: reconhece o formato do TSE pelo cabeçalho, filtra pelo
 * nome ou número do parlamentar, soma os votos por município e devolve a
 * colocação dele em cada um. É a diferença entre "fomos bem ali" e um número.
 */

/** Colunas do TSE, que mudam de nome entre as eleições. */
const COLUNAS = {
  municipio: ['nm municipio', 'nome municipio', 'municipio', 'nm ue'],
  uf: ['sg uf', 'uf', 'sigla uf'],
  candidato: ['nm votavel', 'nm candidato', 'nome candidato', 'nm urna candidato', 'nome urna'],
  // O nome de urna à parte do nome de registro: numa ficha de apresentação vale
  // o nome pelo qual a cidade conhece a pessoa, não o que está na certidão.
  urna: ['nm urna candidato', 'nome urna', 'nm urna'],
  numero: ['nr votavel', 'nr candidato', 'numero candidato'],
  partido: ['sg partido', 'sigla partido', 'partido'],
  cargo: ['ds cargo', 'cargo', 'descricao cargo'],
  situacao: ['ds sit tot turno', 'situacao totalizacao', 'ds sit totalizacao', 'sit tot turno'],
  votos: ['qt votos', 'qtde votos', 'quantidade votos', 'qt voto', 'votos'],
  ano: ['ano eleicao', 'ano'],
};

export function mapearColunasDoTse(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};
  for (const [campo, nomes] of Object.entries(COLUNAS)) {
    let i = chaves.findIndex((c) => nomes.includes(c));
    if (i === -1) i = chaves.findIndex((c) => nomes.some((n) => c.includes(n)));
    if (i !== -1) mapa[campo] = i;
  }
  return mapa;
}

const semAcento = (t) => String(t ?? '').toUpperCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Compara nomes de urna com o nome do parlamentar.
 *
 * O TSE grava o nome de urna — "MARCEL VAN HATTEM" —, que raramente é igual ao
 * nome cadastrado no gabinete. Exigir igualdade exata devolveria zero votos sem
 * erro nenhum, que é o pior modo de falhar: parece resposta.
 */
export function mesmoCandidato(daUrna, procurado) {
  const a = semAcento(daUrna);
  const b = semAcento(procurado);
  if (!a || !b) return false;
  if (a === b) return true;
  // Todas as palavras do nome procurado aparecem no nome de urna, ou o
  // contrário: cobre "Marcel van Hattem" contra "MARCEL VAN HATTEM" e contra
  // "MARCEL VANHATTEM".
  const partes = (t) => t.split(' ').filter((p) => p.length > 2);
  const contem = (x, y) => partes(y).every((p) => x.includes(p));
  return contem(a, b) || contem(b, a);
}

/**
 * Soma os votos por município e ordena.
 *
 * A colocação sai da mesma leitura: quantos candidatos ao mesmo cargo tiveram
 * mais votos naquela cidade. É o número que diz se aquele é um reduto ou um
 * lugar a conquistar — e é o que muda a conversa de uma visita.
 */
export function apurarPorMunicipio(linhas, mapa, { nomeAutor, numero = null, cargo = null }) {
  const porMunicipio = new Map();

  const campo = (linha, nome) => (mapa[nome] === undefined ? '' : String(linha[mapa[nome]] ?? '').trim());

  for (const linha of linhas) {
    const cargoDaLinha = campo(linha, 'cargo');
    if (cargo && cargoDaLinha && !semAcento(cargoDaLinha).includes(semAcento(cargo))) continue;

    const cidade = campo(linha, 'municipio');
    if (!cidade) continue;
    const votos = numeroBr(campo(linha, 'votos')) || 0;
    if (!votos) continue;

    const chave = semAcento(cidade);
    if (!porMunicipio.has(chave)) {
      porMunicipio.set(chave, {
        nome: nomePadrao(cidade),
        uf: campo(linha, 'uf') || null,
        ano: numeroBr(campo(linha, 'ano')) || null,
        votosParlamentar: 0,
        votosValidos: 0,
        // A colocação precisa de todos os candidatos, não só do nosso — por isso
        // os demais são contados aqui e descartados no fim.
        outros: new Map(),
      });
    }
    const m = porMunicipio.get(chave);
    m.votosValidos += votos;

    const nosso = mesmoCandidato(campo(linha, 'candidato'), nomeAutor)
      || (numero && campo(linha, 'numero') === String(numero));

    if (nosso) {
      m.votosParlamentar += votos;
      m.partido = m.partido || campo(linha, 'partido') || null;
    } else {
      const quem = campo(linha, 'candidato') || campo(linha, 'numero');
      m.outros.set(quem, (m.outros.get(quem) || 0) + votos);
    }
  }

  return [...porMunicipio.values()]
    .filter((m) => m.votosParlamentar > 0)
    .map((m) => {
      const acima = [...m.outros.values()].filter((v) => v > m.votosParlamentar).length;
      const { outros, ...resto } = m;
      return {
        ...resto,
        colocacao: acima + 1,
        percentual: m.votosValidos ? (m.votosParlamentar / m.votosValidos) * 100 : null,
      };
    })
    .sort((a, b) => b.votosParlamentar - a.votosParlamentar);
}

/**
 * Eleito ou não.
 *
 * "NÃO ELEITO" contém "ELEITO": um `includes` aqui marcaria como prefeito quem
 * perdeu a eleição, em todas as cidades, sem erro nenhum na tela. Por isso a
 * comparação é pelo começo da frase — ELEITO, ELEITO POR QP e ELEITO POR MÉDIA
 * começam com ela; NAO ELEITO, SUPLENTE e 2º TURNO não.
 */
export function foiEleito(situacao) {
  return /^ELEIT/.test(semAcento(situacao));
}

const CARGOS = [
  { re: /^PREFEITO/, papel: 'prefeito' },
  { re: /^VICE.?PREFEITO/, papel: 'vice' },
  { re: /^VEREADOR/, papel: 'vereador' },
];

/** Qual dos três cargos municipais é este, se for algum. */
export function papelDoCargo(cargo) {
  const t = semAcento(cargo);
  return (CARGOS.find((c) => c.re.test(t)) || {}).papel || null;
}

/**
 * Lê o arquivo de candidaturas e monta quem governa cada cidade.
 *
 * O TSE publica, junto com os votos, o resultado de cada candidatura. É de lá
 * que saem prefeito, vice e a Câmara inteira — de graça, oficial, e para as 497
 * cidades de uma vez. Preencher isso à mão, cidade por cidade, é trabalho de
 * semanas que envelhece sozinho.
 *
 * Os vereadores guardados são os do partido do parlamentar, porque o campo na
 * ficha é "vereadores aliados": despejar os quinze eleitos de cada Câmara faria
 * uma lista que ninguém lê.
 *
 * O que continua humano, e não tem como não ser: o presidente da Câmara, eleito
 * pelos pares em sessão que o TSE não registra.
 */
export function apurarEleitos(linhas, mapa, { partidoAliado = null } = {}) {
  const campo = (linha, nome) => (mapa[nome] === undefined ? '' : String(linha[mapa[nome]] ?? '').trim());
  const porMunicipio = new Map();
  const funil = { eleitos: 0, prefeitos: 0, vices: 0, vereadores: 0, aliados: 0 };

  for (const linha of linhas) {
    const papel = papelDoCargo(campo(linha, 'cargo'));
    if (!papel) continue;
    if (!foiEleito(campo(linha, 'situacao'))) continue;

    const cidade = campo(linha, 'municipio');
    if (!cidade) continue;

    const chave = semAcento(cidade);
    if (!porMunicipio.has(chave)) {
      porMunicipio.set(chave, {
        nome: nomePadrao(cidade),
        uf: campo(linha, 'uf') || null,
        ano: numeroBr(campo(linha, 'ano')) || null,
        prefeito: null,
        partidoPrefeito: null,
        vicePrefeito: null,
        vereadores: [],
      });
    }
    const m = porMunicipio.get(chave);
    const nome = nomePadrao(campo(linha, 'urna') || campo(linha, 'candidato'));
    const partido = campo(linha, 'partido') || null;
    if (!nome) continue;
    funil.eleitos += 1;

    if (papel === 'prefeito') {
      m.prefeito = nome;
      m.partidoPrefeito = partido;
      funil.prefeitos += 1;
    } else if (papel === 'vice') {
      m.vicePrefeito = nome;
      funil.vices += 1;
    } else {
      funil.vereadores += 1;
      if (partidoAliado && semAcento(partido) === semAcento(partidoAliado)) {
        m.vereadores.push(nome);
        funil.aliados += 1;
      }
    }
  }

  for (const m of porMunicipio.values()) m.vereadores.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return { municipios: [...porMunicipio.values()], funil };
}

/**
 * Grava quem governa cada cidade.
 *
 * Escreve só os campos que vieram do TSE. O presidente da Câmara, o resumo
 * econômico e as observações do gabinete continuam onde estavam: foram
 * escritos por gente, e uma importação não tem por que apagá-los.
 */
export async function importarCandidatos(arquivo, { partidoAliado = null } = {}) {
  const texto = decodificar(await arquivo.arrayBuffer());
  const { cabecalho, linhas } = lerCsv(texto);
  if (!cabecalho.length) throw new Error('O arquivo está vazio ou não é uma planilha de texto.');

  const mapa = mapearColunasDoTse(cabecalho);
  if (mapa.municipio === undefined || mapa.cargo === undefined || mapa.situacao === undefined) {
    throw new Error(`Não reconheci o formato de candidaturas do TSE em "${cabecalho.slice(0, 6).join(', ')}…". O arquivo precisa ter município, cargo e o resultado da candidatura (DS_SIT_TOT_TURNO) — é o "consulta_cand" da eleição municipal, não o de votação.`);
  }

  const { municipios, funil } = apurarEleitos(linhas, mapa, { partidoAliado });
  if (!municipios.length) {
    throw new Error('Nenhum eleito encontrado neste arquivo. Confira se é o arquivo de candidaturas (consulta_cand) de uma eleição municipal.');
  }

  const { salvarEmLote, listar } = await import('./dados.js');
  const existentes = new Set((await listar('municipios', { recarregar: true })).map((m) => m.id));

  let novos = 0;
  let atualizados = 0;
  const registros = municipios.map((m) => {
    const id = chaveDoMunicipio(m.nome, m.uf);
    if (existentes.has(id)) atualizados += 1; else novos += 1;
    return {
      id,
      dados: {
        nome: m.nome,
        uf: m.uf,
        prefeito: m.prefeito,
        partidoPrefeito: m.partidoPrefeito,
        vicePrefeito: m.vicePrefeito,
        // Sem partido aliado informado a lista sai vazia — e vazia é melhor que
        // uma lista velha de outro partido que sobreviveria à importação.
        vereadores: m.vereadores,
        anoEleicaoMunicipal: m.ano,
        fonteGoverno: `TSE — candidaturas ${m.ano || ''}`.trim(),
      },
    };
  }).filter((r) => r.id);

  const gravacao = await salvarEmLote('municipios', registros);
  if (gravacao.falhas.length) throw gravacao.falhas[0];

  return {
    linhas: linhas.length,
    municipios: registros.length,
    novos,
    atualizados,
    partidoAliado,
    ...funil,
  };
}

/** A chave de um município na base do gabinete: nome sem acento, mais UF. */
export function chaveDoMunicipio(nome, uf) {
  const limpo = semAcento(nome).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!limpo) return null;
  return `${limpo}-${String(uf || 'br').toLowerCase()}`;
}

/**
 * Lê a planilha do TSE e grava a votação nos municípios.
 *
 * Só os campos de votação são escritos. Prefeito, vereadores e o resumo
 * econômico continuam como estão — foram preenchidos por gente, e uma
 * importação de votos não tem por que apagá-los.
 */
export async function importarVotacao(arquivo, { nomeAutor, numero = null, cargo = 'DEPUTADO FEDERAL' } = {}) {
  if (!nomeAutor && !numero) {
    throw new Error('Informe o nome do parlamentar em Acessos → Dados do gabinete, ou o número na urna.');
  }

  const texto = decodificar(await arquivo.arrayBuffer());
  const { cabecalho, linhas } = lerCsv(texto);
  if (!cabecalho.length) throw new Error('O arquivo está vazio ou não é uma planilha de texto.');

  const mapa = mapearColunasDoTse(cabecalho);
  if (mapa.municipio === undefined || mapa.votos === undefined) {
    throw new Error(`Não reconheci o formato do TSE em "${cabecalho.slice(0, 6).join(', ')}…". O arquivo precisa ter município e quantidade de votos.`);
  }

  const apurado = apurarPorMunicipio(linhas, mapa, { nomeAutor, numero, cargo });
  const funil = {
    linhas: linhas.length,
    municipios: apurado.length,
    votos: apurado.reduce((t, m) => t + m.votosParlamentar, 0),
    novos: 0,
    atualizados: 0,
    melhores: apurado.slice(0, 3).map((m) => `${m.nome} (${m.votosParlamentar})`),
  };

  if (!apurado.length) {
    throw new Error(`Nenhum voto encontrado para "${nomeAutor}" neste arquivo. Confira se é a votação do cargo certo e se o nome bate com o nome de urna.`);
  }

  const { salvarEmLote, listar } = await import('./dados.js');
  const existentes = new Map((await listar('municipios', { recarregar: true })).map((m) => [m.id, m]));

  const registros = apurado.map((m) => {
    const id = chaveDoMunicipio(m.nome, m.uf);
    if (existentes.has(id)) funil.atualizados += 1; else funil.novos += 1;
    return {
      id,
      dados: {
        nome: m.nome,
        uf: m.uf,
        votosParlamentar: m.votosParlamentar,
        votosValidos: m.votosValidos,
        colocacao: m.colocacao,
        anoEleicao: m.ano,
        fonte: 'TSE — dados abertos eleitorais',
        atualizadoNaFonte: new Date().toISOString().slice(0, 10),
      },
    };
  }).filter((r) => r.id);

  const gravacao = await salvarEmLote('municipios', registros);
  if (gravacao.falhas.length) throw gravacao.falhas[0];
  return funil;
}
