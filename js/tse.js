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
  numero: ['nr votavel', 'nr candidato', 'numero candidato'],
  partido: ['sg partido', 'sigla partido', 'partido'],
  cargo: ['ds cargo', 'cargo', 'descricao cargo'],
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
