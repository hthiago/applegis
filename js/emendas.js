import {
  decodificar, lerCsv, lerPlanilha, chaveDoRotulo, numeroBr, dataBr, mesmoNome, nomeParaBusca,
} from './planilha.js';

/**
 * Importação das emendas parlamentares a partir das planilhas oficiais.
 *
 * Por que planilha, e não consulta direta: a execução de emendas mora no Portal
 * da Transparência, no Transferegov e no Fundo Nacional de Saúde. Nenhum dos
 * três serve os dados a um site no navegador — o Portal exige chave de API, que
 * não pode ficar em código aberto ao público, e nenhum deles libera a chamada
 * de outra origem. Um sistema que dependesse disso só funcionaria com servidor
 * próprio no meio do caminho.
 *
 * A exportação em planilha, por outro lado, é pública, o gabinete já a baixa
 * hoje e ela traz exatamente os mesmos números. Ler o arquivo resolve o
 * problema real — saber o que foi empenhado, liquidado e pago — sem depender de
 * chave, de servidor ou de suposição sobre uma API que eu não consigo alcançar
 * daqui para conferir.
 *
 * Cada sistema nomeia suas colunas de um jeito. O mapa abaixo é a tradução, e é
 * ele que permite jogar qualquer um dos arquivos na mesma tela.
 */

/**
 * Sinônimos de cada campo, por sistema de origem. A comparação é por chave
 * normalizada e por conteúdo: "Valor Empenhado", "VALOR EMPENHADO" e
 * "Empenhado" caem todos no mesmo lugar.
 */
const COLUNAS = {
  codigo: ['codigo da emenda', 'codigo emenda', 'numero da emenda', 'n emenda',
    'no emenda', 'n emenda parlamentar', 'emenda parlamentar', 'nr emenda'],
  ano: ['ano da emenda', 'ano emenda', 'ano'],
  tipoOrigem: ['tipo de emenda', 'tipo emenda', 'modalidade'],
  autor: ['autor da emenda', 'autor', 'nome do parlamentar', 'nome parlamentar', 'parlamentar'],
  beneficiario: ['convenente', 'beneficiario', 'proponente', 'nome do proponente',
    'orgao entidade', 'fundo', 'entidade', 'nome do beneficiario'],
  municipio: ['municipio', 'nome do municipio', 'localidade do gasto', 'municipio beneficiario'],
  uf: ['uf', 'sigla uf', 'uf beneficiario'],
  funcao: ['nome da funcao', 'funcao', 'bloco', 'area'],
  objeto: ['objeto', 'objeto do convenio', 'descricao', 'finalidade'],
  proposta: ['n proposta', 'no proposta', 'numero da proposta', 'nr proposta', 'id proposta'],
  instrumento: ['n convenio', 'no convenio', 'numero do convenio', 'instrumento',
    'n instrumento', 'numero do termo'],
  situacaoOrigem: ['situacao', 'situacao da proposta', 'status'],
  valorIndicado: ['valor da emenda', 'valor global', 'dotacao inicial', 'valor proposta',
    'valor repasse', 'valor indicado', 'dotacao atual'],
  valorEmpenhado: ['valor empenhado', 'empenhado'],
  valorLiquidado: ['valor liquidado', 'liquidado'],
  valorPago: ['valor pago', 'pago'],
  restosInscritos: ['valor restos a pagar inscritos', 'restos a pagar inscritos'],
  restosPagos: ['valor restos a pagar pagos', 'restos a pagar pagos'],
  restosCancelados: ['valor restos a pagar cancelados', 'restos a pagar cancelados'],
  atualizadoNaFonte: ['data da ultima atualizacao', 'data atualizacao', 'data'],
};

/** Descobre em que coluna do arquivo mora cada campo nosso. */
export function mapearColunas(cabecalho) {
  const chaves = cabecalho.map(chaveDoRotulo);
  const mapa = {};

  for (const [campo, sinonimos] of Object.entries(COLUNAS)) {
    // Casamento exato primeiro; só depois por conteúdo, para "ano" não roubar
    // a coluna "ano do empenho" quando existe uma "ano da emenda".
    let posicao = chaves.findIndex((c) => sinonimos.includes(c));
    if (posicao === -1) {
      posicao = chaves.findIndex((c) => sinonimos.some((s) => c.includes(s)));
    }
    if (posicao !== -1) mapa[campo] = posicao;
  }
  return mapa;
}

/** De onde a planilha veio, deduzido das colunas. Serve só para o relato. */
export function origemDaPlanilha(cabecalho) {
  const juntas = cabecalho.map(chaveDoRotulo).join('|');
  if (juntas.includes('restos a pagar')) return 'Portal da Transparência';
  if (juntas.includes('convenente') || juntas.includes('proposta')) return 'Transferegov';
  if (juntas.includes('fundo') || juntas.includes('bloco')) return 'Fundo Nacional de Saúde';
  if (juntas.includes('dotacao')) return 'SIOP';
  return 'origem não identificada';
}

const TIPOS = [
  { v: 'individual', re: /individual/i },
  { v: 'especial', re: /especial|transfer[êe]ncia\s+especial|pix/i },
  { v: 'bancada', re: /bancada/i },
  { v: 'comissao', re: /comiss[ãa]o/i },
  { v: 'relator', re: /relator/i },
];

function tipoDe(texto) {
  const t = String(texto || '');
  return (TIPOS.find((x) => x.re.test(t)) || {}).v || null;
}

/**
 * "ERECHIM - RS" e "RS" são as duas formas que a coluna de localidade assume no
 * Portal da Transparência. Separá-las evita gravar a UF no campo de município.
 */
export function separarLocalidade(texto) {
  const t = String(texto || '').trim();
  if (!t) return { municipio: null, uf: null };

  const comUf = /^(.*?)\s*[-–]\s*([A-Za-z]{2})$/.exec(t);
  if (comUf) return { municipio: comUf[1].trim() || null, uf: comUf[2].toUpperCase() };
  if (/^[A-Za-z]{2}$/.test(t)) return { municipio: null, uf: t.toUpperCase() };
  return { municipio: t, uf: null };
}

/** Só entra no registro o que a planilha de fato trouxe. */
function comValor(alvo, campo, valor) {
  if (valor !== null && valor !== undefined && valor !== '') alvo[campo] = valor;
}

/**
 * O identificador do registro. Código e ano são o par estável entre todas as
 * fontes; sem código, o número da proposta ou do instrumento serve. Uma linha
 * sem nenhum dos três não pode ser conciliada e é contada à parte, em vez de
 * virar duplicata a cada importação.
 */
export function chaveDaLinha({ codigo, ano, proposta, instrumento }) {
  const limpo = (v) => String(v || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '');
  if (codigo) return `${ano || 'sa'}-${limpo(codigo)}`;
  if (proposta) return `prop-${limpo(proposta)}`;
  if (instrumento) return `inst-${limpo(instrumento)}`;
  return null;
}

/**
 * Os campos em que o Portal da Transparência manda, e a planilha não.
 *
 * São os que a execução orçamentária define e que o Portal publica direto do
 * SIAFI: valores, classificação e identificação da emenda. Uma planilha de
 * controle é trabalho humano — ela atrasa, arredonda, herda erro de digitação —
 * e por isso não sobrescreve nenhum destes.
 *
 * Fora desta lista está o que só a planilha tem: objeto negociado, beneficiário
 * pretendido, número da proposta, situação junto ao órgão, anotações do
 * gabinete. É justamente por isso que a consolidação existe.
 */
export const CAMPOS_DO_PORTAL = [
  'ano', 'tipo', 'autorNaFonte', 'municipio', 'uf', 'funcao', 'subfuncao',
  'valorEmpenhado', 'valorLiquidado', 'valorPago',
  'restosInscritos', 'restosPagos', 'restosCancelados',
];

/** Comparação tolerante ao formato: 1000 e "1.000,00" são o mesmo número. */
function mesmoValor(a, b) {
  const x = numeroBr(a);
  const y = numeroBr(b);
  if (x !== null && y !== null) return Math.abs(x - y) < 0.005;
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function mostrar(v) {
  const n = numeroBr(v);
  return n !== null && typeof v !== 'string'
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    : String(v);
}

/**
 * Junta o que a planilha sabe com o que o Portal sabe, sem deixar um apagar o
 * outro.
 *
 * A regra é uma só e vale nos dois sentidos: o Portal manda nos campos de
 * execução; a planilha manda em tudo que o Portal não publica. Onde os dois
 * falam e discordam, fica o Portal — e a discordância é registrada, não
 * engolida. Sobrescrever calado transformaria um erro de planilha em um número
 * que ninguém mais consegue auditar, e é exatamente o tipo de divergência que o
 * gabinete precisa ver para corrigir a planilha.
 */
export function consolidar(existente, entrada, { autoritativa = false } = {}) {
  const dados = {};
  const divergencias = [];
  const anterior = existente || {};
  const temPortal = Boolean(anterior.consultadoEm);

  for (const [campo, valor] of Object.entries(entrada)) {
    if (valor === null || valor === undefined || valor === '') continue;

    // A consulta ao Portal é a fonte: ela escreve tudo o que traz.
    if (autoritativa || !CAMPOS_DO_PORTAL.includes(campo) || !temPortal) {
      dados[campo] = valor;
      continue;
    }

    const atual = anterior[campo];
    if (atual === null || atual === undefined || atual === '') {
      dados[campo] = valor;
      continue;
    }
    if (!mesmoValor(atual, valor)) {
      divergencias.push(`${campo}: planilha ${mostrar(valor)} · Portal ${mostrar(atual)}`);
    }
  }

  return { dados, divergencias };
}

/**
 * Grava uma leva de emendas já normalizadas, conciliando com o que existe.
 *
 * É o mesmo caminho para a planilha e para a consulta automática. Duas entradas
 * com duas conciliações seriam duas chances de duplicar o mesmo registro por
 * caminhos diferentes — e a divergência só apareceria meses depois, num número
 * somado em dobro no painel.
 */
async function conciliar(brutas, funil, { autoritativa = false } = {}) {
  const { salvarEmLote, listar } = await import('./dados.js');

  const existentes = new Map(
    (await listar('emendas', { recarregar: true })).map((e) => [e.id, e]),
  );

  const registros = [];
  const vistos = new Set();
  const hoje = new Date().toISOString().slice(0, 10);

  for (const bruta of brutas) {
    const id = chaveDaLinha(bruta);
    if (!id) { funil.semChave += 1; continue; }
    if (vistos.has(id)) continue;
    vistos.add(id);

    const anterior = existentes.get(id);
    const { dados, divergencias } = consolidar(anterior, bruta, { autoritativa });
    dados.importadoEm = hoje;
    if (autoritativa) dados.consultadoEm = hoje;

    // A divergência é reescrita a cada consolidação, não acumulada: ela
    // descreve o estado de agora entre as duas fontes, e uma lista que só cresce
    // continuaria acusando o que já foi corrigido.
    if (!autoritativa) {
      dados.divergencias = divergencias.join('\n') || null;
      dados.temDivergencia = divergencias.length ? 'sim' : 'nao';
      if (divergencias.length) funil.divergentes = (funil.divergentes || 0) + 1;
    }

    // A fase é juízo do gabinete e nenhuma fonte a conhece; só se dá um ponto
    // de partida ao registro que está nascendo agora.
    if (!anterior) {
      dados.fase = dados.valorPago > 0 ? 'execucao' : (dados.valorEmpenhado > 0 ? 'empenhada' : 'indicada');
      funil.novas += 1;
    } else {
      funil.atualizadas += 1;
    }

    registros.push({ id, dados });
  }

  if (registros.length) {
    const gravacao = await salvarEmLote('emendas', registros);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }
  return funil;
}

/**
 * Lê a planilha e concilia com o que já está guardado.
 *
 * Os arquivos do Portal da Transparência trazem as emendas de todos os
 * parlamentares — meio milhão de linhas. Filtrar pelo nome do autor é o que
 * torna a importação possível, e é também o passo que mais falha em silêncio,
 * porque o nome parlamentar nem sempre é o nome do gabinete. Por isso ele é
 * contado e relatado.
 */
export async function importarPlanilha(arquivo, { nomeAutor = null } = {}) {
  // Lê .csv e .xlsx: quem exporta de um painel do governo recebe .xlsx, e o
  // leitor só de texto devolvia "o arquivo está vazio ou não é uma planilha de
  // texto" — verdade que não ajudava, porque o arquivo estava certo.
  const { cabecalho, linhas } = await lerPlanilha(arquivo);

  if (!cabecalho.length) throw new Error('O arquivo está vazio ou não é uma planilha reconhecível.');

  // A exportação do painel de transferências tem outro formato e outro grão —
  // uma linha por instrumento, não por emenda. Reconhecê-la aqui evita obrigar
  // quem usa a saber de antemão em qual botão o arquivo dele entra.
  const { ehDoPainel, importarDoPainel } = await import('./painel.js');
  if (ehDoPainel(cabecalho)) return { ...(await importarDoPainel(arquivo)), origem: 'painel' };

  const mapa = mapearColunas(cabecalho);
  const origem = origemDaPlanilha(cabecalho);

  if (mapa.valorEmpenhado === undefined && mapa.valorIndicado === undefined) {
    throw new Error(`Não encontrei colunas de valor em "${cabecalho.slice(0, 6).join(', ')}…". Confira se é a exportação de emendas.`);
  }

  const funil = {
    origem,
    linhas: linhas.length,
    deOutroAutor: 0,
    semChave: 0,
    novas: 0,
    atualizadas: 0,
    divergentes: 0,
    colunasExtras: [],
    temColunaAutor: mapa.autor !== undefined,
    nomeUsado: nomeAutor || null,
  };

  const campo = (linha, nome) => (mapa[nome] === undefined ? null : String(linha[mapa[nome]] ?? '').trim());
  const brutas = [];

  // As colunas que o sistema não reconhece são exatamente as especificações que
  // só existem na planilha — e são a razão de consolidar. Descartá-las por não
  // ter campo próprio jogaria fora o motivo da importação.
  const usadas = new Set(Object.values(mapa));
  const naoMapeadas = cabecalho
    .map((rotulo, i) => ({ rotulo, i }))
    .filter(({ rotulo, i }) => !usadas.has(i) && String(rotulo).trim());
  funil.colunasExtras = naoMapeadas.map(({ rotulo }) => rotulo);

  const extrasDa = (linha) => naoMapeadas
    .map(({ rotulo, i }) => {
      const v = String(linha[i] ?? '').trim();
      return v ? `${rotulo}: ${v}` : null;
    })
    .filter(Boolean)
    .join('\n') || null;

  for (const linha of linhas) {
    if (mapa.autor !== undefined && nomeAutor && !mesmoNome(campo(linha, 'autor'), nomeAutor)) {
      funil.deOutroAutor += 1;
      continue;
    }

    const local = separarLocalidade(campo(linha, 'municipio'));
    brutas.push({
      codigo: campo(linha, 'codigo'),
      ano: numeroBr(campo(linha, 'ano')),
      tipo: tipoDe(campo(linha, 'tipoOrigem')),
      autorNaFonte: campo(linha, 'autor'),
      beneficiario: campo(linha, 'beneficiario'),
      municipio: local.municipio || campo(linha, 'municipio'),
      uf: local.uf || campo(linha, 'uf'),
      funcao: campo(linha, 'funcao'),
      objeto: campo(linha, 'objeto'),
      proposta: campo(linha, 'proposta'),
      instrumento: campo(linha, 'instrumento'),
      situacaoNaFonte: campo(linha, 'situacaoOrigem'),
      valorIndicado: numeroBr(campo(linha, 'valorIndicado')),
      valorEmpenhado: numeroBr(campo(linha, 'valorEmpenhado')),
      valorLiquidado: numeroBr(campo(linha, 'valorLiquidado')),
      valorPago: numeroBr(campo(linha, 'valorPago')),
      restosInscritos: numeroBr(campo(linha, 'restosInscritos')),
      restosPagos: numeroBr(campo(linha, 'restosPagos')),
      restosCancelados: numeroBr(campo(linha, 'restosCancelados')),
      atualizadoNaFonte: dataBr(campo(linha, 'atualizadoNaFonte')),
      detalhesDaPlanilha: extrasDa(linha),
      fonte: origem,
    });
  }

  return conciliar(brutas, funil);
}

// ─────────────────────── consulta automática ───────────────────────

/**
 * Teto de páginas da consulta ao Portal.
 *
 * A API pagina de quinze em quinze e não informa o total — a única forma de
 * saber que acabou é receber uma página vazia. Eu parava quando a página vinha
 * com menos de cem itens, número que tirei de outra API; como a primeira já vem
 * com quinze, a consulta terminava na primeira página e um mandato inteiro
 * virava quinze emendas.
 *
 * O teto existe só para que um comportamento inesperado da fonte não vire um
 * laço infinito. Quatrocentas páginas cobrem seis mil emendas, muito além do
 * que um mandato produz.
 */
const PAGINAS_MAXIMAS = 400;

/**
 * Traduz um registro do Portal da Transparência.
 *
 * Os nomes dos campos vêm da documentação da API, que eu não consigo alcançar
 * do meu ambiente para conferir. Por isso cada campo é lido por mais de um
 * nome possível e o registro cru fica guardado quando algo não casa: um campo
 * renomeado do outro lado precisa aparecer como pergunta, não como zero.
 */
export function doPortal(r) {
  const pegar = (...nomes) => {
    for (const n of nomes) {
      if (r[n] !== undefined && r[n] !== null && r[n] !== '') return r[n];
    }
    return null;
  };

  const local = separarLocalidade(pegar('localidadeDoGasto', 'localidade', 'municipio'));
  const funcaoBruta = pegar('funcao', 'nomeFuncao');

  return {
    codigo: pegar('codigoEmenda', 'codigo'),
    ano: numeroBr(pegar('ano', 'anoEmenda')),
    tipo: tipoDe(pegar('tipoEmenda', 'tipo')),
    autorNaFonte: pegar('nomeAutor', 'autor'),
    municipio: local.municipio,
    uf: local.uf,
    funcao: typeof funcaoBruta === 'object' ? funcaoBruta?.descricao : funcaoBruta,
    valorEmpenhado: numeroBr(pegar('valorEmpenhado')),
    valorLiquidado: numeroBr(pegar('valorLiquidado')),
    valorPago: numeroBr(pegar('valorPago')),
    restosInscritos: numeroBr(pegar('valorRestoInscrito', 'valorRestosInscritos')),
    restosPagos: numeroBr(pegar('valorRestoPago', 'valorRestosPagos')),
    restosCancelados: numeroBr(pegar('valorRestoCancelado', 'valorRestosCancelados')),
    subfuncao: pegar('subfuncao'),
    numeroNaFonte: pegar('numeroEmenda'),
    fonte: 'Portal da Transparência',
  };
}

/**
 * Consulta o Portal da Transparência pela ponte no servidor.
 *
 * A API pagina de cem em cem e não informa o total, então a única forma de
 * saber que acabou é receber uma página menor que a anterior. O teto de páginas
 * existe para que um comportamento inesperado da fonte não vire um laço infinito
 * consumindo a cota do gabinete.
 */
/** Primeiro ano de emenda impositiva individual. Antes disso não há o que buscar. */
const ANO_INICIAL = 2019;

/** Percorre as páginas de uma consulta até a fonte se esgotar. */
async function paginarPortal({ consultarFonte, parametros, jaVistos, funil, aoProgredir, rotulo }) {
  const achadas = [];

  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina += 1) {
    const r = await consultarFonte('portal-emendas', { ...parametros, pagina });
    const lote = Array.isArray(r.dados) ? r.dados : [];
    funil.paginas += 1;

    // Página vazia é o fim da lista. Página que só repete o que já veio
    // significa que a fonte ignorou o número da página — sem essa guarda, a
    // consulta giraria para sempre queimando a cota do gabinete.
    if (!lote.length) break;

    let novasNaPagina = 0;
    for (const bruto of lote) {
      const chave = String(bruto.codigoEmenda ?? bruto.id ?? JSON.stringify(bruto));
      if (jaVistos.has(chave)) continue;
      jaVistos.add(chave);
      novasNaPagina += 1;
      achadas.push(bruto);
    }

    funil.linhas += lote.length;
    aoProgredir({ rotulo, paginas: funil.paginas, trazidas: jaVistos.size });
    if (!novasNaPagina) break;
  }

  return achadas;
}

/**
 * Consulta o Portal da Transparência pela ponte no servidor.
 *
 * A consulta é feita ano a ano, e não de uma vez. Sem o filtro de ano, a base
 * devolveu cinquenta registros para um mandato que atravessa sete exercícios —
 * comportamento que não está documentado e que eu não tenho como investigar
 * daqui. Pedir cada ano explicitamente contorna qualquer recorte que a fonte
 * aplique por conta própria, e custa poucas páginas a mais.
 *
 * A varredura sem filtro vem primeiro, de propósito: se o ano não for um filtro
 * aceito, ela sozinha já traz o que houver, e as demais só repetem — o que a
 * deduplicação absorve sem gravar nada em dobro.
 */
export async function consultarPortal({ nomeAutor, aoProgredir = () => {} }) {
  if (!nomeAutor) throw new Error('Informe o nome do parlamentar em Acessos → Dados do gabinete.');

  const { consultarFonte } = await import('./fontes.js');

  // O Portal casa o nome pela forma exata em que o guarda: caixa alta, sem
  // acento. Mandar como o gabinete escreve devolve zero sem erro nenhum.
  const nomeNaBase = nomeParaBusca(nomeAutor);

  const funil = {
    origem: 'Portal da Transparência (consulta direta)',
    linhas: 0,
    deOutroAutor: 0,
    semChave: 0,
    novas: 0,
    atualizadas: 0,
    temColunaAutor: true,
    nomeUsado: nomeNaBase,
    paginas: 0,
    reconhecidos: 0,
    porAno: {},
  };

  const jaVistos = new Set();
  const bruteza = [];
  let amostra = null;

  const anos = [null];
  for (let a = ANO_INICIAL; a <= new Date().getFullYear(); a += 1) anos.push(a);

  for (const ano of anos) {
    const achadas = await paginarPortal({
      consultarFonte,
      parametros: { nomeAutor: nomeNaBase, ano },
      jaVistos,
      funil,
      aoProgredir,
      rotulo: ano ? String(ano) : 'todos os anos',
    });
    if (!amostra && achadas.length) [amostra] = achadas;
    bruteza.push(...achadas);
  }

  const brutas = [];
  for (const bruto of bruteza) {
    const normalizado = doPortal(bruto);

    // Reconhecido é o registro do qual se conseguiu tirar o código da emenda.
    // Nenhum reconhecido em toda a consulta não é "não achou nada": é a forma
    // dos campos ter mudado, e as duas coisas exigem providências opostas.
    if (normalizado.codigo) funil.reconhecidos += 1;

    // A API filtra por nome, mas com casamento parcial: conferir de novo aqui
    // evita trazer um homônimo por engano.
    if (!mesmoNome(normalizado.autorNaFonte, nomeAutor)) { funil.deOutroAutor += 1; continue; }

    // A distribuição por ano é o que denuncia um exercício faltando — que é
    // exatamente o que um total sozinho esconde.
    if (normalizado.ano) funil.porAno[normalizado.ano] = (funil.porAno[normalizado.ano] || 0) + 1;
    brutas.push(normalizado);
  }

  if (funil.linhas && !funil.reconhecidos) {
    funil.camposRecebidos = Object.keys(amostra || {});
  }

  // Nenhum registro é a resposta mais ambígua que essa consulta pode dar: pode
  // ser que o parlamentar não tenha emendas no período, que o nome enviado não
  // seja o que a base usa, ou que o filtro por nome nem seja aceito. Uma única
  // consulta sem filtro separa as três — mostra quantos registros existem, com
  // que nomes de campo e como a base escreve os autores.
  if (!funil.linhas) {
    try {
      const r = await consultarFonte('portal-emendas', { pagina: 1 });
      const lote = Array.isArray(r.dados) ? r.dados : [];
      funil.diagnostico = {
        enviamos: nomeNaBase,
        semFiltro: lote.length,
        campos: Object.keys(lote[0] || {}),
        autores: [...new Set(lote.map((x) => x.nomeAutor ?? x.autor ?? '(sem campo de autor)'))]
          .filter(Boolean).slice(0, 6),
      };
    } catch (erro) {
      funil.diagnostico = { enviamos: nomeNaBase, falhou: erro.message };
    }
  }

  return conciliar(brutas, funil, { autoritativa: true });
}

// ───────────────────── a emenda discriminada ─────────────────────
//
// O Portal da Transparência não publica o detalhamento por emenda — os
// caminhos que tentei responderam 403, que no gateway dele significa caminho
// inexistente. Quem publica é o Transferegov, em `plano_acao_especial`: uma
// linha por beneficiário, com o que cada um recebeu de custeio e investimento,
// a situação e, quando há, o motivo do impedimento.
//
// Vale só para transferências especiais — a emenda que vai direto ao município,
// sem convênio. As de finalidade definida moram noutro módulo, e a sondagem
// mostrou que existe um `fundoafundo` com estrutura parecida, ainda por ligar.

const ESPECIAIS = '/transferenciasespeciais/plano_acao_especial';
const EXECUTORES = '/transferenciasespeciais/executor_especial';
const METAS = '/transferenciasespeciais/meta_especial';
const FINALIDADES = '/transferenciasespeciais/finalidade_especial';
const EMPENHOS = '/transferenciasespeciais/empenho_especial';
const FUNDO_BENEFICIARIOS = '/fundoafundo/programa_beneficiario';
const FUNDO_PLANOS = '/fundoafundo/plano_acao';

/**
 * O código de doze dígitos que o Portal usa, remontado a partir das partes que
 * o Transferegov guarda separadas: ano, código do parlamentar e sequencial.
 * É o que permite pendurar cada plano de ação na emenda certa.
 */
export function codigoDaEmenda({ ano, parlamentar, sequencial }) {
  const n = (v, tamanho) => String(v ?? '').replace(/\D/g, '').padStart(tamanho, '0');
  // Sequencial ausente não vira "0000": isso inventaria um código, e um código
  // inventado casa com a emenda errada em vez de simplesmente não casar.
  if (!ano || !parlamentar || sequencial === null || sequencial === undefined || sequencial === '') {
    return null;
  }
  return `${n(ano, 4)}${n(parlamentar, 4)}${n(sequencial, 4)}`;
}

/**
 * O mesmo código, escrito do mesmo jeito, para poder comparar.
 *
 * Cada base escreve à sua maneira — "2026.4116.0003", "202641160003", com ou
 * sem zeros à esquerda. Comparar texto cru faz duas grafias do mesmo código
 * parecerem emendas diferentes.
 */
export function normalizarCodigo(codigo) {
  const digitos = String(codigo ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  return digitos.length < 12 ? digitos.padStart(12, '0') : digitos;
}

/**
 * Os códigos por que um plano de ação pode atender.
 *
 * O Transferegov guarda o código de três formas — pronto em
 * `codigo_..._formatado`, repartido em ano/parlamentar/sequencial, e ainda com
 * um `numero_emenda` à parte — e não documenta qual delas corresponde ao código
 * de doze dígitos do Portal. Aceitar as três resolve sem precisar adivinhar
 * qual é, e sem casar emenda errada: as três derivam da mesma linha.
 */
export function codigosDoPlano(r) {
  const achados = new Set();
  const guardar = (v) => { const n = normalizarCodigo(v); if (n) achados.add(n); };

  guardar(r.codigo_emenda_parlamentar_formatado_plano_acao);
  for (const sequencial of [
    r.sequencial_emenda_parlamentar_plano_acao,
    r.numero_emenda_parlamentar_plano_acao,
  ]) {
    // `numero_emenda` às vezes traz o código inteiro, não o sequencial. Prefixar
    // ano e parlamentar de novo produz um código de vinte dígitos, que não casa
    // com nada e ainda suja o diagnóstico — foi o que apareceu como
    // "20264116202641160008".
    if (String(sequencial ?? '').replace(/\D/g, '').length >= 12) {
      guardar(sequencial);
      continue;
    }
    guardar(codigoDaEmenda({
      ano: r.ano_emenda_parlamentar_plano_acao,
      parlamentar: r.codigo_parlamentar_emenda_plano_acao,
      sequencial,
    }));
  }
  return [...achados];
}

/** As partes de um código de emenda, para consultar o Transferegov. */
export function partesDoCodigo(codigo) {
  const limpo = String(codigo || '').replace(/\D/g, '');
  if (limpo.length < 12) return null;
  return {
    ano: Number(limpo.slice(0, 4)),
    parlamentar: Number(limpo.slice(4, 8)),
    sequencial: Number(limpo.slice(8, 12)),
  };
}

/**
 * "MUNICIPIO DE ERECHIM" é o beneficiário; "Erechim" é o município.
 *
 * Quando o favorecido não é uma prefeitura — um hospital filantrópico, um fundo
 * estadual, uma associação —, não há município a extrair. Devolver o nome da
 * instituição na coluna de município escreveu "ASSOCIACAO BENEFICENTE HOSPITAL
 * SANTO ANTONIO" onde se lê uma cidade: um dado errado no lugar de um vazio
 * honesto, e ainda por cima agrupando a tabela por instituição.
 */
export function municipioDoBeneficiario(nome) {
  const t = String(nome || '').trim();
  if (!t) return null;
  const m = /^(?:munic[íi]pio|prefeitura(?:\s+municipal)?)\s+(?:de\s+|do\s+|da\s+|dos\s+|das\s+)?(.+)$/i.exec(t);
  return m ? m[1].trim() : null;
}

/** Traduz um plano de ação do Transferegov para uma transferência nossa. */
export function doPlanoAcao(r) {
  const custeio = numeroBr(r.valor_custeio_plano_acao);
  const investimento = numeroBr(r.valor_investimento_plano_acao);
  const total = (custeio || 0) + (investimento || 0);

  return {
    // O código que a própria base publica vem primeiro; a remontagem a partir
    // das partes é o reforço para quando ele vier vazio.
    codigoEmenda: normalizarCodigo(r.codigo_emenda_parlamentar_formatado_plano_acao)
      || codigoDaEmenda({
        ano: r.ano_emenda_parlamentar_plano_acao,
        parlamentar: r.codigo_parlamentar_emenda_plano_acao,
        sequencial: r.sequencial_emenda_parlamentar_plano_acao,
      }) || null,
    documento: r.codigo_plano_acao ? `PA ${r.codigo_plano_acao}` : (r.id_plano_acao ? `PA ${r.id_plano_acao}` : null),
    tipo: 'especial',
    ano: Number(r.ano_plano_acao) || Number(r.ano_emenda_parlamentar_plano_acao) || null,
    favorecido: r.nome_beneficiario_plano_acao || null,
    favorecidoDoc: r.cnpj_beneficiario_plano_acao || null,
    municipio: municipioDoBeneficiario(r.nome_beneficiario_plano_acao),
    uf: r.uf_beneficiario_plano_acao || null,
    objeto: r.descricao_programacao_orcamentaria_plano_acao
      || r.codigo_descricao_areas_politicas_publicas_plano_acao || null,
    // Impedimento é a informação mais acionável desta base: é o que trava o
    // repasse, e é sobre isso que a prefeitura liga para o gabinete.
    situacao: r.motivo_impedimento_plano_acao
      ? `${r.situacao_plano_acao || 'Impedida'} — ${r.motivo_impedimento_plano_acao}`
      : (r.situacao_plano_acao || null),
    valor: total || null,
    valorCusteio: custeio,
    valorInvestimento: investimento,
    idPlanoAcao: r.id_plano_acao ?? null,
    fonte: 'Transferegov — transferências especiais',
  };
}

// ── a execução no Portal, que vale para qualquer modalidade ──
//
// O caminho é `/emendas/documentos/{codigo}` — com o código no caminho, não na
// consulta. Tentei a outra forma três vezes e ela responde 403, que naquele
// gateway quer dizer "não existe"; a sondagem que percorre hipóteses achou esta.
//
// É a única fonte que cobre as quatro modalidades, inclusive a execução direta
// pelo órgão, que nunca vira transferência e por isso não aparece em base
// nenhuma do Transferegov. Ela devolve o índice dos documentos — empenho,
// liquidação, pagamento, com data e número. Favorecido e valor vêm quando a
// fonte os manda; o leitor aceita as duas situações em vez de descartar a linha.

const FASES = [
  { v: 'empenho', re: /empenh/i },
  { v: 'liquidacao', re: /liquida/i },
  { v: 'pagamento', re: /pagamen/i },
];

export function tipoDaFase(texto) {
  const t = String(texto || '');
  return (FASES.find((f) => f.re.test(t)) || {}).v || null;
}

/**
 * Trechos da observação que identificam o documento em vez de descrever o gasto.
 *
 * "PAGAMENTO DA PROPOSTA 11707405000126004 - UF RS - EMENDA: (41160003) MARCEL
 * VAN HATTEM" não diz para que serviu o dinheiro: diz de qual proposta, de qual
 * UF e de qual emenda ele veio — coisas que a tabela já mostra em colunas
 * próprias. Escrever isso na coluna de objeto foi repetir o mesmo erro do
 * "Não se aplica": ocupar com identificação o lugar da resposta.
 */
const RUIDO_NA_OBSERVACAO = [
  /^pagamento\s+da\s+proposta\b/i,
  /^proposta\s*n?[ºo]?\s*[\d./-]*$/i,
  /^proposta\s+[\d./-]+/i,
  /^processo\s+[\d./-]+/i,
  /^uf\s+[a-z]{2}$/i,
  /^emenda\s*:/i,
  /^\(?\d{6,}\)?$/,
];

/**
 * Ruído colado à frase, que não se separa por hífen.
 *
 * "PAGAMENTO DE 65058-INCREMENTO TEMPORARIO AO CUSTEIO…" diz duas coisas: que é
 * um pagamento, o que a coluna Fase já mostra, e qual é o objeto. Só a segunda
 * pertence à coluna de objeto. O mesmo vale para o número do processo e a UF
 * grudados no fim, que a tabela já traz em colunas próprias.
 */
const PREFIXOS_DE_RUIDO = [
  /^pagamento\s+de\s+\d+\s*-\s*/i,
  /^empenho\s+(?:para\s+atender\s+)?(?:a\s+|ao\s+)?/i,
  /^valor\s+referente\s+a\s+/i,
];

const SUFIXOS_DE_RUIDO = [
  /\s*-?\s*processo\s+[\d./-]+\s*(?:uf\s+[a-z]{2})?\s*$/i,
  /\s*-?\s*uf\s+[a-z]{2}\s*$/i,
];

/**
 * Palavras que descrevem a espécie do documento, não o gasto.
 *
 * Uma versão anterior escreveu "Original", "ORIGINAL" e "Não se aplica" na
 * coluna de objeto, e esses registros continuam guardados. Reconhecê-los aqui
 * limpa o que já foi salvo errado, sem precisar apagar nada.
 */
const SO_ESPECIE = /^(original|reforço|reforco|anulação|anulacao|estorno|não se aplica|nao se aplica)$/i;

/**
 * Separa a observação em objeto e identificadores.
 *
 * A quebra é por segmento, não por expressão que tenta adivinhar a frase
 * inteira: cada pedaço entre hifens ou é identificação conhecida, e sai, ou é
 * descrição, e fica. Sobrando pouco demais para significar algo, não se afirma
 * objeto nenhum.
 */
export function objetoDaObservacao(texto) {
  const bruto = String(texto ?? '').trim();
  if (!bruto || SO_ESPECIE.test(bruto)) return { objeto: null, proposta: null, processo: null };

  // O número da proposta é o elo com o convênio no Transferegov, e o do processo
  // identifica o expediente no ministério. Vale guardar justamente o que se está
  // tirando da frente.
  const proposta = (/proposta\s*n?[ºo]?\s*([\d./-]{6,})/i.exec(bruto) || [])[1] || null;
  const processo = (/processo\s*n?[ºo]?\s*([\d./-]{6,})/i.exec(bruto) || [])[1] || null;

  let objeto = bruto
    .split(/\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !RUIDO_NA_OBSERVACAO.some((re) => re.test(p)))
    .join(' - ')
    .trim();

  for (const re of SUFIXOS_DE_RUIDO) objeto = objeto.replace(re, '').trim();
  for (const re of PREFIXOS_DE_RUIDO) objeto = objeto.replace(re, '').trim();
  objeto = objeto.replace(/\s*-\s*$/, '').trim();

  return {
    objeto: objeto.length >= 8 && !SO_ESPECIE.test(objeto) ? objeto : null,
    proposta,
    processo,
  };
}

/**
 * A ação orçamentária, sem repetir o que já é a mesma coisa.
 *
 * Programa e ação vêm separados e às vezes são idênticos — "-14 - Múltiplo ·
 * -14 - Múltiplo" é uma informação escrita duas vezes. E "Múltiplo" é o que a
 * fonte diz quando não há um só valor: repetido em toda linha, ocupa uma coluna
 * inteira sem distinguir nada.
 */
export function acaoOrcamentaria(programa, acao) {
  const limpo = (v) => {
    const t = String(v ?? '').trim();
    return !t || /^-?\d*\s*-?\s*m[úu]ltiplo$/i.test(t) ? null : t;
  };
  const partes = [...new Set([limpo(programa), limpo(acao)].filter(Boolean))];
  return partes.join(' · ') || null;
}

export function doDocumentoDaEmenda(r, codigoEmenda) {
  const pegar = (...nomes) => {
    for (const n of nomes) {
      const v = r[n];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };
  const texto = (v) => (v && typeof v === 'object'
    ? (v.descricao || v.nome || v.especie || null)
    : v);

  const fase = texto(pegar('fase', 'faseDespesa'));
  const favorecido = texto(pegar('nomeFavorecido', 'favorecido', 'nomeBeneficiario'));
  // O índice traz `municipio`; o detalhe não traz município nenhum, e sim a UF
  // do favorecido. O nome do favorecido — "MUNICIPIO DE X" — é que carrega a
  // cidade, como no Transferegov.
  const local = separarLocalidade(texto(pegar('municipio', 'localidadeDoGasto')));

  return {
    codigoEmenda: normalizarCodigo(codigoEmenda),
    documento: pegar('codigoDocumentoResumido', 'documentoResumido', 'codigoDocumento') || null,
    tipo: tipoDaFase(fase) || 'empenho',
    data: dataBr(pegar('data', 'dataEmissao')),
    favorecido,
    favorecidoDoc: pegar('codigoFavorecido', 'cpfCnpjFavorecido') || null,
    municipio: local.municipio || (favorecido ? municipioDoBeneficiario(favorecido) : null),
    uf: local.uf || texto(pegar('ufFavorecido')),
    // `especieTipo` NÃO é o objeto: é a espécie do documento — "Original",
    // "Reforço", "Não se aplica". Escrevê-la na coluna de objeto encheu a tela
    // de "Não se aplica" onde se esperava ler para que serviu o dinheiro, o que
    // é pior do que a coluna vazia: parece resposta e não é.
    //
    // O objeto de verdade é a observação do empenho: "EMPENHO PARA ATENDER A
    // PORTARIA 706 DE 08/04/2020". Ela só existe no documento detalhado.
    objeto: objetoDaObservacao(texto(pegar('observacao', 'objeto', 'descricao'))).objeto,
    processo: objetoDaObservacao(texto(pegar('observacao'))).processo,
    // A frase inteira, como a fonte a escreveu. O objeto é a leitura dela; o
    // histórico é a prova, e some da lista sem sumir do registro.
    historico: texto(pegar('observacao', 'objeto', 'descricao')),
    proposta: objetoDaObservacao(texto(pegar('observacao'))).proposta,
    especie: texto(pegar('especieTipo', 'especie')),
    // A classificação funcional diz a política pública a que o gasto pertence,
    // e a ação orçamentária diz o programa concreto que o executou.
    area: texto(pegar('funcao')),
    subfuncao: texto(pegar('subfuncao')),
    acao: acaoOrcamentaria(texto(pegar('programa')), texto(pegar('acao'))),
    localizador: texto(pegar('localizadorGasto', 'subTitulo')),
    orgao: texto(pegar('orgao', 'unidadeGestora', 'ug')),
    valor: numeroBr(pegar('valor', 'valorDocumento', 'valorEmpenhado')),
    idDocumento: pegar('id') ?? null,
    codigoDocumento: pegar('codigoDocumento', 'documento') || null,
    fonte: 'Portal da Transparência — documentos da emenda',
  };
}

/**
 * Os documentos de execução de uma emenda, direto no Portal.
 *
 * Paginado até acabar: uma emenda repartida entre muitos municípios tem muitos
 * empenhos, e parar na primeira página mostraria uma fatia se passando pelo todo
 * — que é o erro que a consulta de emendas já cometeu uma vez.
 */
export async function documentosDaEmenda(codigo, {
  paginasMaximas = 40, completar = false, aoProgredir = () => {},
} = {}) {
  const { consultarFonte } = await import('./fontes.js');
  const alvo = normalizarCodigo(codigo);
  if (!alvo) return { linhas: [], paginas: 0, completados: 0 };

  const linhas = [];
  let paginas = 0;
  for (let pagina = 1; pagina <= paginasMaximas; pagina += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await consultarFonte('portal-livre', { pagina }, `/emendas/documentos/${alvo}`);
    const lote = Array.isArray(r.dados) ? r.dados : [];
    paginas = pagina;
    linhas.push(...lote.map((x) => doDocumentoDaEmenda(x, alvo)));
    if (!lote.length) break;
  }

  // Completar custa uma consulta por documento — vinte e sete numa emenda só.
  // Vale quando alguém abriu aquela emenda para olhar; não vale multiplicado por
  // todas as emendas do mandato numa varredura.
  let completados = 0;
  let repartidos = [];
  if (completar && linhas.length) {
    const POR_LEVA = 5;
    for (let i = 0; i < linhas.length; i += POR_LEVA) {
      const leva = linhas.slice(i, i + POR_LEVA);
      // eslint-disable-next-line no-await-in-loop
      const prontos = await Promise.all(leva.map(detalharDocumento));
      // Quem recebeu de verdade está um nível abaixo quando o documento paga a
      // um banco. É a diferença entre "BANCO DO BRASIL SA" e o município.
      // eslint-disable-next-line no-await-in-loop
      const finais = await Promise.all(prontos.map((d) => favorecidosFinais(d.codigoDocumento)));
      prontos.forEach((completo, j) => {
        if (completo.favorecido || completo.valor) completados += 1;
        repartidos.push(...repartirEntreFinais(completo, finais[j] || []));
      });
      aoProgredir({ feitos: Math.min(i + POR_LEVA, linhas.length), total: linhas.length, completados });
    }
  } else {
    repartidos = linhas;
  }

  return { linhas: herdarObjeto(repartidos), paginas, completados };
}

/**
 * Dá objeto às fases que não o descrevem, tomando-o do empenho da mesma emenda.
 *
 * A observação do empenho diz para que serviu o dinheiro; a do pagamento diz de
 * qual proposta ele saiu. As duas linhas importam — o pagamento é a prova de que
 * o dinheiro chegou —, mas só uma delas carrega o objeto. Como todas as linhas
 * aqui são da mesma emenda, o objeto do empenho vale para as demais.
 *
 * Com mais de um objeto distinto entre os empenhos, não se herda nada: escolher
 * um deles seria atribuir ao pagamento um destino que pode não ser o dele.
 */
export function herdarObjeto(linhas) {
  const objetos = [...new Set(
    linhas.filter((l) => l.tipo === 'empenho' && l.objeto).map((l) => l.objeto),
  )];
  if (objetos.length !== 1) return linhas;

  return linhas.map((l) => (l.objeto ? l : { ...l, objeto: objetos[0], objetoHerdado: true }));
}

/**
 * Onde procurar o favorecido e o valor de um documento.
 *
 * O índice da emenda traz número, fase e data, e só. Quem recebeu e quanto
 * estão um nível abaixo, num caminho que a documentação do Portal não deixa
 * claro e que eu não alcanço daqui para conferir. Em vez de custar mais uma
 * rodada por palpite, a lista é tentada em ordem uma única vez por sessão: o
 * primeiro que responder fica escolhido, e os outros não são tentados de novo.
 */
/**
 * Completa um documento com quem recebeu, quanto e para quê.
 *
 * O caminho não é mais palpite: a documentação da própria API o declara como
 * `/despesas/documentos/{codigo}`, com o código longo — `257001000012020NE808376`,
 * e não o resumido `2020NE808376`. É ali que estão a observação do empenho, que
 * é o objeto de verdade, o favorecido, o valor e a classificação funcional.
 *
 * Devolve o documento como veio se a consulta falhar: linha sem valor continua
 * sendo a prova de que houve empenho naquela data, e apagá-la para "não mostrar
 * campo vazio" esconderia execução real.
 */
export async function detalharDocumento(documento) {
  const { consultarFonte } = await import('./fontes.js');
  const codigo = documento.codigoDocumento || documento.documento;
  if (!codigo) return documento;

  let bruto = null;
  try {
    const r = await consultarFonte('portal-livre', {}, `/despesas/documentos/${codigo}`);
    bruto = [].concat(r.dados).filter(Boolean)[0] || null;
  } catch {
    bruto = null;
  }
  if (!bruto) return documento;

  const completo = doDocumentoDaEmenda(bruto, documento.codigoEmenda);
  // O índice manda fase e data; o detalhe manda favorecido e valor. Cada campo
  // fica com quem o tem, e nenhum dos dois apaga o outro.
  const junto = { ...documento };
  for (const [campo, valor] of Object.entries(completo)) {
    if (valor !== null && valor !== undefined && valor !== '') junto[campo] = valor;
  }
  junto.idDocumento = documento.idDocumento ?? completo.idDocumento;

  // O objeto e a ação podem ter sido gravados errados por uma versão anterior.
  // São leitura, não dado bruto: recalculá-los aqui conserta o que está guardado
  // sem precisar apagar registro nenhum.
  junto.objeto = completo.objeto ?? null;
  junto.acao = completo.acao ?? null;
  return junto;
}

/**
 * Há documentos cujo destino a consulta ainda não resolveu?
 *
 * Depois do pós-processamento, os documentos sem destino identificado viram uma
 * linha só — "catorze documentos, destino a resolver". Reabrir a sanfona com uma
 * dessas à vista tem de reconsultar a fonte, e não repetir o que está guardado:
 * a retentativa mora na consulta, não no que ficou salvo.
 */
export function faltaResolver(destinos) {
  return destinos.some((d) => d.qtdDocumentos && !d.favorecido && !d.municipio);
}

/**
 * Reparte um documento entre quem de fato recebeu.
 *
 * Um pagamento ao banco que se divide entre doze municípios é uma linha na
 * fonte e doze destinos na realidade. Só se reparte quando os favorecidos finais
 * trazem valor: sem valor, somar as partes daria um total diferente do
 * documento, e a tabela passaria a mentir para ficar mais detalhada.
 */
export function repartirEntreFinais(documento, finais) {
  const partes = finais.map(doFavorecidoFinal).filter((f) => f.favorecido);
  if (!partes.length) return [documento];

  const comValor = partes.filter((p) => p.valor);
  if (!comValor.length) {
    // Sem valor por parte, o documento continua um só — mas já se sabe para
    // quem ele foi, e isso cabe ao lado do favorecido intermediário.
    return [{
      ...documento,
      favorecidoFinal: partes.map((p) => p.favorecido).join(' | '),
      municipio: documento.municipio
        || (partes.length === 1 ? partes[0].municipio : null),
    }];
  }

  return comValor.map((p, i) => ({
    ...documento,
    favorecido: p.favorecido,
    favorecidoDoc: p.favorecidoDoc || null,
    municipio: p.municipio,
    uf: p.uf || documento.uf,
    valor: p.valor,
    favorecidoIntermediario: documento.favorecido || null,
    idDocumento: documento.idDocumento ? `${documento.idDocumento}-f${i + 1}` : null,
  }));
}

/**
 * Quem de fato recebeu, quando o documento paga a um intermediário.
 *
 * Numa transferência a município, o favorecido do documento no SIAFI é o banco
 * — "BANCO DO BRASIL SA" — porque é ele que operacionaliza o repasse. O
 * destinatário real está um nível abaixo, em `favorecidos-finais-por-documento`,
 * que a documentação da API declara e que é justamente a coluna "município" que
 * faltava.
 */
export async function favorecidosFinais(codigoDocumento) {
  const { consultarFonte } = await import('./fontes.js');
  if (!codigoDocumento) return [];

  try {
    const r = await consultarFonte('portal-livre',
      { codigoDocumento, pagina: 1 }, '/despesas/favorecidos-finais-por-documento');
    return Array.isArray(r.dados) ? r.dados : [].concat(r.dados).filter(Boolean);
  } catch {
    return [];
  }
}

/** Traduz um favorecido final para os campos que a tabela mostra. */
export function doFavorecidoFinal(r) {
  const pegar = (...nomes) => {
    for (const n of nomes) {
      const v = r[n];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };
  const texto = (v) => (v && typeof v === 'object' ? (v.descricao || v.nome || null) : v);
  const nome = texto(pegar('nomeFavorecidoFinal', 'nomeFavorecido', 'favorecidoFinal', 'favorecido', 'nome'));
  const local = separarLocalidade(texto(pegar('municipio', 'municipioFavorecido', 'localidade')));

  return {
    favorecido: nome,
    favorecidoDoc: pegar('codigoFavorecidoFinal', 'codigoFavorecido', 'cpfCnpj') || null,
    municipio: local.municipio || (nome ? municipioDoBeneficiario(nome) : null),
    uf: local.uf || texto(pegar('ufFavorecido', 'uf')),
    valor: numeroBr(pegar('valor', 'valorRecebido')),
  };
}

/** A chave de uma transferência: o plano de ação identifica sozinho. */
export function chaveDaTransferencia({
  idPlanoAcao, idExecutor, idBeneficiario, idDocumento,
  codigoEmenda, documento, favorecido, data,
}) {
  const limpo = (v) => String(v || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '');
  // Um plano repartido entre executores são vários destinos, com objetos
  // diferentes. Chave só do plano faria o último sobrescrever os anteriores e o
  // detalhamento sumiria justamente onde ele é mais fino.
  if (idPlanoAcao && idExecutor) return `pa-${limpo(idPlanoAcao)}-ex-${limpo(idExecutor)}`;
  if (idBeneficiario) return `ff-${limpo(idBeneficiario)}`;
  if (idPlanoAcao) return `pa-${limpo(idPlanoAcao)}`;
  if (idDocumento) return `doc-${limpo(idDocumento)}`;
  if (codigoEmenda && documento) return `${limpo(codigoEmenda)}-${limpo(documento)}`;
  if (documento) return `doc-${limpo(documento)}`;
  if (codigoEmenda && favorecido) {
    return `${limpo(codigoEmenda)}-${limpo(data)}-${limpo(favorecido).slice(0, 40)}`;
  }
  return null;
}

/**
 * Grava destinos, não documentos.
 *
 * Antes daqui passava o que a fonte devolveu, linha por linha — e a fonte
 * responde em grão de documento contábil. Uma emenda paga em doze parcelas
 * virava dezenas de registros quase todos vazios, o filtro juntava 5752 "sem
 * classificação" e a soma triplicava o repasse. O pós-processamento reúne os
 * documentos de cada destino numa linha, soma por fase e classifica quem
 * recebeu; o que não informa nada não é gravado.
 */
async function guardarTransferencias(linhas) {
  const { salvarEmLote } = await import('./dados.js');
  const { reunirDestinos, vazia } = await import('./posprocessamento.js');

  const registros = [];
  const vistos = new Set();

  for (const t of reunirDestinos(linhas)) {
    if (vazia(t)) continue;
    const id = t.id || chaveDaTransferencia(t);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const dados = {};
    for (const [campo, valor] of Object.entries(t)) {
      if (campo !== 'id') comValor(dados, campo, valor);
    }
    dados.importadoEm = new Date().toISOString().slice(0, 10);
    registros.push({ id, dados });
  }

  if (registros.length) {
    const gravacao = await salvarEmLote('transferencias', registros);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }
  return registros.map((r) => ({ id: r.id, ...r.dados }));
}

/**
 * Passa o que já está guardado pelo pós-processamento.
 *
 * Os registros gravados por versões anteriores continuam em grão de documento —
 * e é deles que vêm as milhares de linhas em branco e os filtros inúteis. Esta
 * função reúne, regrava consolidado e marca como removido o que era ruído.
 * Existe como ação explícita porque mexer em massa no que está guardado é coisa
 * que se faz quando alguém decide, não escondido dentro de outra tarefa.
 */
export async function reorganizar({ aoProgredir = () => {} } = {}) {
  const { listar, salvarEmLote } = await import('./dados.js');
  const { reunirDestinos, vazia } = await import('./posprocessamento.js');

  const antigas = await listar('transferencias', { recarregar: true });
  const funil = { antes: antigas.length, depois: 0, descartadas: 0, aposentadas: 0 };
  if (!antigas.length) return funil;

  const reunidos = reunirDestinos(antigas);
  const uteis = reunidos.filter((d) => !vazia(d));
  funil.descartadas = reunidos.length - uteis.length;
  funil.depois = uteis.length;
  aoProgredir({ ...funil, etapa: 'gravando' });

  const guardados = await guardarTransferencias(antigas);
  const novos = new Set(guardados.map((g) => g.id));

  // O que não virou destino nenhum sai de cena. Marcado, não apagado: a marca
  // viaja para os outros navegadores, e uma exclusão em massa equivocada
  // continua recuperável no console do Firebase.
  const aposentar = antigas.filter((a) => !novos.has(a.id));
  funil.aposentadas = aposentar.length;

  if (aposentar.length) {
    const hoje = new Date().toISOString();
    const gravacao = await salvarEmLote('transferencias',
      aposentar.map((a) => ({ id: a.id, dados: { removidoEm: hoje } })));
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }
  return funil;
}

/**
 * Uma linha da fonte, encolhida para caber num recado de tela.
 *
 * Campo vazio é descartado — é o que a linha *tem* que interessa —, e o valor
 * longo é cortado. Sem isso o recado vira uma parede de `campo: null`.
 */
export function recorteDaLinha(linha, limite = 700) {
  const pares = Object.entries(linha || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k.replace(/_plano_acao$/, '')}=${String(v).slice(0, 60)}`);
  if (!pares.length) return '(todos os campos vieram vazios)';

  const texto = pares.join(' · ');
  return texto.length > limite ? `${texto.slice(0, limite)}…` : texto;
}

/**
 * Os planos de ação de uma emenda só. É a unidade da sanfona: abrir uma linha
 * custa uma consulta, e ela usa as três partes do código para filtrar.
 */
export async function detalharEmenda(codigo, { nomeAutor = null, aoProgredir = () => {} } = {}) {
  const { consultarFonte } = await import('./fontes.js');
  const partes = partesDoCodigo(codigo);
  if (!partes) {
    // Código que não tem doze dígitos não vira consulta nenhuma. Sair calado
    // daqui faz a tela dizer "não tem plano de ação" sem nunca ter perguntado.
    return {
      transferencias: [], amostra: null, codigosVistos: null, linhas: 0,
      motivo: 'codigo-ilegivel', procurado: codigo || null,
    };
  }

  const buscar = async (filtros) => {
    const r = await consultarFonte('transferegov-livre',
      { ...filtros, limit: 1000 }, ESPECIAIS);
    return Array.isArray(r.dados) ? r.dados : [];
  };

  // Primeiro pelo código do parlamentar, que é exato. O sequencial fica de fora
  // do filtro e é conferido aqui: não sei se a base o guarda como número ou como
  // texto com zeros à esquerda, e `eq.1` não encontra `0001`. Um ano de emendas
  // de um parlamentar são poucas dezenas de linhas — barato de peneirar do lado
  // de cá, e imune ao formato.
  const tentativas = [`código ${partes.parlamentar}`];
  let lote = await buscar({
    ano_emenda_parlamentar_plano_acao: `eq.${partes.ano}`,
    codigo_parlamentar_emenda_plano_acao: `eq.${partes.parlamentar}`,
  });

  // Zero linhas por aqui não prova que a emenda não é especial: prova só que
  // ninguém com esse código de parlamentar aparece naquele ano. O código de
  // autor da emenda não é o mesmo em todas as bases nem em todos os anos, então
  // vale reperguntar pelo nome antes de afirmar que não existe.
  if (!lote.length && nomeAutor) {
    for (const grafia of grafiasDoNome(nomeAutor)) {
      tentativas.push(`nome "${grafia}"`);
      lote = await buscar({
        ano_emenda_parlamentar_plano_acao: `eq.${partes.ano}`,
        nome_parlamentar_emenda_plano_acao: `ilike.*${grafia}*`,
      });
      if (lote.length) break;
    }
  }

  const alvo = normalizarCodigo(codigo);
  const desta = lote.filter((linha) => codigosDoPlano(linha).includes(alvo));
  // Sem peneira de conteúdo: plano de ação sem beneficiário e sem valor ainda é
  // um plano de ação — costuma ser o que está impedido, que é justamente o que o
  // gabinete precisa ver. Quem decide o que se guarda é a chave, e ela vem do
  // id do plano.
  let transferencias = await guardarTransferencias(desta.map(doPlanoAcao));

  // A emenda que não é especial ainda foi executada, e o Portal registra essa
  // execução para qualquer modalidade — inclusive a direta, em que o ministério
  // paga o fornecedor e nenhuma base de transferência jamais a vê. Parar antes
  // daqui era o que fazia a sanfona dizer "não tem" sobre uma emenda que foi
  // para vários municípios.
  let documentos = 0;
  let completados = 0;
  if (!transferencias.length) {
    tentativas.push('documentos no Portal');
    const doPortalEmenda = await documentosDaEmenda(alvo, { completar: true, aoProgredir });
    documentos = doPortalEmenda.linhas.length;
    completados = doPortalEmenda.completados;
    if (documentos) {
      transferencias = await guardarTransferencias(doPortalEmenda.linhas);
    }
  }

  return {
    transferencias,
    documentos,
    completados,
    // Três resultados diferentes, três recados diferentes. Confundi-los uma vez
    // já mandou procurar nome de campo quando o problema era o código. E nome de
    // campo sozinho não fecha a dúvida: os nomes podem estar todos certos e os
    // valores todos vazios. Por isso o que volta aqui é a linha inteira, com
    // valores — é ela que responde qualquer das perguntas de uma vez.
    // Todo diagnóstico abaixo só vale quando não houve resultado. Achado o
    // destino, explicar por onde não se achou é ruído na frente da resposta.
    amostra: (desta.length && !transferencias.length) ? recorteDaLinha(desta[0]) : null,
    codigosVistos: (lote.length && !desta.length && !transferencias.length)
      ? [...new Set(lote.flatMap(codigosDoPlano))].slice(0, 12)
      : null,
    linhas: lote.length,
    procurado: alvo,
    ano: partes.ano,
    // O que foi de fato perguntado. Sem isso, "não encontrei" e "não perguntei
    // direito" saem com o mesmo texto — e só um dos dois é resposta.
    tentativas,
    motivo: transferencias.length ? null : 'sem-linhas',
  };
}

/**
 * Todos os planos de ação do parlamentar, de uma vez.
 *
 * Uma consulta por emenda seriam duzentas; filtrar pelo nome do parlamentar
 * traz tudo em poucas páginas. O nome vai como comparação insensível a caixa,
 * porque a grafia entre as bases federais não é a mesma.
 */
const PAGINAS_ESPECIAIS = 40;

// Uma consulta por emenda ao Portal, e um mandato tem centenas. O teto existe
// para a varredura não virar uma espera de minutos sem aviso; o que passar dele
// se resolve abrindo a sanfona da emenda, que consulta uma só.
const EMENDAS_NO_PORTAL = 120;

/** As grafias a tentar para um nome, da mais fiel à mais tolerante. */
export function grafiasDoNome(nome) {
  const limpo = String(nome || '').trim().replace(/\s+/g, ' ');
  if (!limpo) return [];
  // `ilike` resolve a caixa, não o acento: se a base grava "José" e mandamos
  // "JOSE", o resultado volta vazio — e vazio parece "não tem emenda". Tentar as
  // duas grafias custa uma consulta a mais e evita concluir errado.
  return [...new Set([limpo, nomeParaBusca(limpo)])].filter(Boolean);
}

/**
 * Quantos identificadores cabem num filtro `in.(...)` sem estourar o limite de
 * comprimento que a ponte impõe ao valor de um parâmetro.
 */
export function lotesDeIds(ids, limite = 110) {
  const limpos = [...new Set(ids.filter((x) => x !== null && x !== undefined && x !== ''))]
    .map(String);
  const saida = [];
  let atual = [];
  let tamanho = 0;
  for (const id of limpos) {
    if (atual.length && tamanho + id.length + 1 > limite) {
      saida.push(atual); atual = []; tamanho = 0;
    }
    atual.push(id);
    tamanho += id.length + 1;
  }
  if (atual.length) saida.push(atual);
  return saida;
}

/** O executor é quem gasta, e `objeto_executor` é o para-quê que faltava. */
export function doExecutor(r) {
  const custeio = numeroBr(r.vl_custeio_executor);
  const investimento = numeroBr(r.vl_investimento_executor);
  return {
    idPlanoAcao: r.id_plano_acao ?? null,
    idExecutor: r.id_executor ?? null,
    executor: r.nome_executor || null,
    executorDoc: r.cnpj_executor || null,
    objeto: r.objeto_executor || null,
    valor: (custeio || 0) + (investimento || 0) || null,
    valorCusteio: custeio,
    valorInvestimento: investimento,
  };
}

/** Uma meta física: o que a emenda comprou ou construiu, com quantidade. */
export function rotuloDaMeta(r) {
  const nome = r.nome_meta || r.desc_meta;
  if (!nome) return null;
  const quantidade = numeroBr(r.qt_uniade_meta ?? r.qt_unidade_meta);
  const unidade = r.un_medida_meta;
  return quantidade
    ? `${nome} (${quantidade}${unidade ? ` ${unidade}` : ''})`
    : String(nome);
}

/** Um empenho, resumido para caber numa linha ao lado do destino. */
export function rotuloDoEmpenho(r) {
  const partes = [r.numero_empenho, dataBr(r.data_emissao_empenho)].filter(Boolean);
  const valor = numeroBr(r.valor_empenho);
  if (valor) partes.push(valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  return partes.join(' · ') || null;
}

/** O beneficiário de um programa fundo a fundo: SUS, assistência social. */
export function doBeneficiarioFundo(r) {
  return {
    codigoEmenda: normalizarCodigo(r.numero_emenda_beneficiario_programa),
    tipo: 'fundoafundo',
    favorecido: r.nome_beneficiario_programa || null,
    favorecidoDoc: r.cnpj_beneficiario_programa || null,
    municipio: municipioDoBeneficiario(r.nome_beneficiario_programa),
    uf: r.uf_beneficiario_programa || null,
    valor: numeroBr(r.valor_beneficiario_programa),
    idBeneficiario: r.id_beneficiario_programa ?? null,
    idPrograma: r.id_programa ?? null,
    fonte: 'Transferegov — fundo a fundo',
  };
}

/**
 * Todo o detalhamento que as bases federais publicam sobre as emendas do
 * parlamentar, numa varredura só.
 *
 * A execução de uma emenda não mora num lugar só, e foi isso que fez a busca
 * andar em círculo por várias rodadas. São modalidades diferentes, em bases
 * diferentes, e achar uma não adianta nada para as outras:
 *
 *   - Transferência especial: o dinheiro vai direto ao município. O plano de
 *     ação diz quem recebeu; o executor diz para quê; a meta diz o que foi
 *     comprado ou construído; o empenho diz o que de fato saiu.
 *   - Fundo a fundo: SUS e assistência social, do fundo nacional ao municipal.
 *     O beneficiário do programa se liga à emenda pelo número dela.
 *
 * O que não está aqui: convênio de finalidade definida — o módulo não existe
 * nesse host — e execução direta pelo órgão, que nunca vira transferência e só
 * aparece nos documentos do Portal.
 */
export async function detalharEmendas({ nomeAutor, codigos = [], aoProgredir = () => {} } = {}) {
  const { consultarFonte } = await import('./fontes.js');
  if (!nomeAutor) throw new Error('Informe o nome do parlamentar em Acessos → Dados do gabinete.');

  const funil = {
    linhas: 0, gravadas: 0, paginas: 0, emendas: 0, procurado: null,
    executores: 0, metas: 0, empenhos: 0, fundoAFundo: 0,
    documentos: 0, consultadas: 0, semDocumentos: 0,
  };
  const contar = (etapa) => aoProgredir({ ...funil, etapa });

  const buscar = async (caminho, parametros) => {
    const r = await consultarFonte('transferegov-livre', { limit: 1000, ...parametros }, caminho);
    return Array.isArray(r.dados) ? r.dados : [];
  };
  const porIds = async (caminho, campo, ids) => {
    const saida = [];
    for (const lote of lotesDeIds(ids)) {
      // eslint-disable-next-line no-await-in-loop
      saida.push(...await buscar(caminho, { [campo]: `in.(${lote.join(',')})` }));
    }
    return saida;
  };

  // ── 1. os planos de ação das transferências especiais ──
  const porPagina = 500;
  const planosBrutos = [];
  let amostra = null;

  for (const grafia of grafiasDoNome(nomeAutor)) {
    for (let pagina = 0; pagina < PAGINAS_ESPECIAIS; pagina += 1) {
      // eslint-disable-next-line no-await-in-loop
      const lote = await buscar(ESPECIAIS, {
        nome_parlamentar_emenda_plano_acao: `ilike.*${grafia}*`,
        limit: porPagina,
        offset: pagina * porPagina,
      });
      funil.paginas += 1;
      funil.linhas += lote.length;
      if (!amostra && lote.length) [amostra] = lote;
      planosBrutos.push(...lote);
      contar('planos de ação');
      if (lote.length < porPagina) break;
    }
    if (funil.linhas) { funil.procurado = grafia; break; }
  }

  const planos = planosBrutos.map(doPlanoAcao);
  const idsPlano = planos.map((p) => p.idPlanoAcao).filter(Boolean);

  // ── 2. quem executa e para quê ──
  const executores = idsPlano.length
    ? (await porIds(EXECUTORES, 'id_plano_acao', idsPlano)).map(doExecutor)
    : [];
  funil.executores = executores.length;
  contar('executores');

  const idsExecutor = executores.map((e) => e.idExecutor).filter(Boolean);

  // ── 3. metas físicas e área de política pública, por executor ──
  const metasPorExecutor = new Map();
  const areasPorExecutor = new Map();
  if (idsExecutor.length) {
    for (const m of await porIds(METAS, 'id_executor', idsExecutor)) {
      const rotulo = rotuloDaMeta(m);
      if (!rotulo) continue;
      if (!metasPorExecutor.has(m.id_executor)) metasPorExecutor.set(m.id_executor, []);
      metasPorExecutor.get(m.id_executor).push(rotulo);
      funil.metas += 1;
    }
    contar('metas');
    for (const f of await porIds(FINALIDADES, 'id_executor', idsExecutor)) {
      const area = f.area_politica_publica_pt || f.area_politica_publica_tipo_pt;
      if (area) areasPorExecutor.set(f.id_executor, area);
    }
  }

  // ── 4. os empenhos, por plano de ação ──
  const empenhosPorPlano = new Map();
  if (idsPlano.length) {
    for (const e of await porIds(EMPENHOS, 'id_plano_acao', idsPlano)) {
      if (!empenhosPorPlano.has(e.id_plano_acao)) empenhosPorPlano.set(e.id_plano_acao, []);
      empenhosPorPlano.get(e.id_plano_acao).push(e);
      funil.empenhos += 1;
    }
    contar('empenhos');
  }

  // ── 5. a junção: o destino em grão de executor, que é onde mora o objeto ──
  const porPlano = new Map(planos.map((p) => [p.idPlanoAcao, p]));
  const executoresPorPlano = new Map();
  for (const e of executores) {
    if (!executoresPorPlano.has(e.idPlanoAcao)) executoresPorPlano.set(e.idPlanoAcao, []);
    executoresPorPlano.get(e.idPlanoAcao).push(e);
  }

  const resumoEmpenho = (id) => {
    const lista = (empenhosPorPlano.get(id) || []).map(rotuloDoEmpenho).filter(Boolean);
    return lista.length ? lista.join(' | ') : null;
  };
  const totalEmpenhado = (id) => (empenhosPorPlano.get(id) || [])
    .reduce((soma, e) => soma + (numeroBr(e.valor_empenho) || 0), 0) || null;

  const linhas = [];
  for (const [id, plano] of porPlano) {
    const seus = executoresPorPlano.get(id) || [];
    const execucao = resumoEmpenho(id);
    const empenhado = totalEmpenhado(id);

    if (!seus.length) {
      linhas.push({ ...plano, execucao, valorEmpenhado: empenhado });
      continue;
    }
    // Um plano com vários executores é uma emenda repartida entre eles. O grão
    // fino é o executor: é ele que tem objeto próprio e valor próprio. Somar de
    // volta ao plano perderia justamente o "para quê".
    for (const e of seus) {
      linhas.push({
        ...plano,
        favorecido: e.executor || plano.favorecido,
        favorecidoDoc: e.executorDoc || plano.favorecidoDoc,
        objeto: e.objeto || plano.objeto,
        area: areasPorExecutor.get(e.idExecutor) || null,
        metas: (metasPorExecutor.get(e.idExecutor) || []).join(' | ') || null,
        valor: e.valor ?? plano.valor,
        valorCusteio: e.valorCusteio ?? plano.valorCusteio,
        valorInvestimento: e.valorInvestimento ?? plano.valorInvestimento,
        idExecutor: e.idExecutor,
        execucao,
        valorEmpenhado: seus.length === 1 ? empenhado : null,
      });
    }
  }

  // ── 6. fundo a fundo: a outra modalidade ──
  let beneficiarios = [];
  for (const grafia of grafiasDoNome(nomeAutor)) {
    // eslint-disable-next-line no-await-in-loop
    beneficiarios = await buscar(FUNDO_BENEFICIARIOS, {
      nome_parlamentar_beneficiario_programa: `ilike.*${grafia}*`,
    });
    if (beneficiarios.length) break;
  }
  // O nome nem sempre está grafado igual entre as bases; o número da emenda é
  // exato. Se o nome não achou nada, as emendas já importadas dizem o que
  // procurar.
  if (!beneficiarios.length && codigos.length) {
    beneficiarios = await porIds(FUNDO_BENEFICIARIOS, 'numero_emenda_beneficiario_programa',
      codigos.map(normalizarCodigo).filter(Boolean));
  }
  funil.fundoAFundo = beneficiarios.length;
  contar('fundo a fundo');

  const doFundo = beneficiarios.map(doBeneficiarioFundo);
  const idsPrograma = doFundo.map((b) => b.idPrograma).filter(Boolean);
  const planosFundo = idsPrograma.length
    ? await porIds(FUNDO_PLANOS, 'id_programa', idsPrograma)
    : [];
  const objetivoPorPrograma = new Map();
  for (const p of planosFundo) {
    const objetivo = p.objetivos_plano_acao || p.diagnostico_plano_acao;
    if (objetivo && !objetivoPorPrograma.has(p.id_programa)) {
      objetivoPorPrograma.set(p.id_programa, String(objetivo).slice(0, 500));
    }
  }
  linhas.push(...doFundo.map((b) => ({
    ...b,
    objeto: objetivoPorPrograma.get(b.idPrograma) || null,
  })));

  // ── 7. o resto: as emendas que nenhuma base de transferência conhece ──
  //
  // Convênio de finalidade definida e execução direta pelo órgão não passam por
  // Transferegov nenhum. O Portal registra os documentos de execução de todas
  // elas, uma emenda por consulta — caro, e por isso só para as que sobraram.
  const jaTem = new Set(linhas.map((l) => l.codigoEmenda).filter(Boolean));
  const faltando = [...new Set(codigos.map(normalizarCodigo).filter(Boolean))]
    .filter((c) => !jaTem.has(c));

  for (const codigo of faltando.slice(0, EMENDAS_NO_PORTAL)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const doPortalEmenda = await documentosDaEmenda(codigo, { paginasMaximas: 20 });
      funil.documentos += doPortalEmenda.linhas.length;
      linhas.push(...doPortalEmenda.linhas);
    } catch {
      // Uma emenda sem documentos não invalida as outras; o funil conta o total
      // no fim e a diferença fala por si.
      funil.semDocumentos += 1;
    }
    funil.consultadas += 1;
    contar('documentos no Portal');
  }

  const gravadas = await guardarTransferencias(linhas);
  funil.gravadas = gravadas.length;
  funil.emendas = new Set(gravadas.map((t) => t.codigoEmenda).filter(Boolean)).size;
  if (funil.linhas && !gravadas.length) funil.amostra = recorteDaLinha(amostra);
  return funil;
}

// ───────────────────────── sondagem de fontes ─────────────────────────

/**
 * Reconhecimento das bases de execução de emendas.
 *
 * Por que existe: não alcanço essas APIs do meu ambiente. Escrever um leitor
 * por palpite custa uma rodada inteira para descobrir que o caminho não existe,
 * e já custou várias. A sondagem inverte isso — ela pergunta às próprias bases
 * o que elas têm, e a resposta volta pronta para virar código.
 *
 * O que mudou desta vez, e é o ponto: a lista de tabelas deixou de ser escrita
 * aqui. O Transferegov serve por PostgREST, e todo serviço PostgREST descreve a
 * si mesmo na raiz. A sondagem lê esse catálogo e percorre o que ele declarar —
 * então um módulo com vinte tabelas se explora sozinho, sem eu adivinhar nome
 * nenhum. É isso que troca N rodadas por uma.
 *
 * A execução de uma emenda não mora num lugar só. São quatro caminhos, cada um
 * com sua base, e é por isso que achar um não resolvia o resto:
 *
 *   1. Transferência especial — vai direto ao município, sem convênio.
 *      Transferegov, `transferenciasespeciais`. É a que já está ligada.
 *   2. Fundo a fundo — SUS e assistência social, do fundo nacional ao municipal.
 *      Transferegov, `fundoafundo`.
 *   3. Finalidade definida / convênio — passa por proposta e instrumento.
 *      Transferegov, módulo ainda por identificar.
 *   4. Execução direta pelo órgão — nunca vira transferência; o ministério
 *      empenha e paga o fornecedor. Só aparece no Portal, em despesas.
 */

/** Módulos do Transferegov cujo catálogo vale abrir e percorrer. */
export const MODULOS_TRANSFEREGOV = [
  '/transferenciasespeciais',
  '/fundoafundo',
  '/convenios',
  '/emendas',
  '/execucao',
  '/planoacao',
  '/transferenciafinalidadedefinida',
  '/transferenciasvoluntarias',
  '/siconv',
  '/parlamentar',
];

/**
 * Hipóteses de caminho no Portal da Transparência.
 *
 * Ali não há catálogo: o serviço não se descreve, e 403 com corpo vazio é como
 * ele diz "não existe". Resta tentar — inclusive a forma com o código na URL,
 * que é como boa parte dos caminhos dele funciona e que eu nunca testei.
 */
export function caminhosDoPortal(codigoEmenda, codigoDocumento = null, data = null) {
  const c = String(codigoEmenda || '').replace(/\D/g, '');
  const d = codigoDocumento ? String(codigoDocumento).trim() : null;
  return [
    { caminho: '/emendas', usa: 'codigoEmenda' },
    c && { caminho: `/emendas/${c}` },
    c && { caminho: `/emendas/documentos/${c}` },
    c && { caminho: `/emendas/${c}/documentos` },
    { caminho: '/emendas/documentos', usa: 'codigoEmenda' },

    // O nível abaixo do índice, agora com os nomes que a documentação declarou.
    // Os dois últimos ainda não estão ligados e ficam sondados de propósito:
    // itens de empenho é o objeto linha a linha, e favorecidos finais é para
    // onde o dinheiro foi depois de passar por um fundo.
    d && { caminho: `/despesas/documentos/${d}` },
    d && { caminho: '/despesas/itens-de-empenho', parametros: { codigoDocumento: d } },
    d && { caminho: '/despesas/favorecidos-finais-por-documento', parametros: { codigoDocumento: d } },
    d && { caminho: '/despesas/documentos-relacionados', parametros: { codigoDocumento: d, fase: 'Empenho' } },
  ].filter(Boolean);
}

/**
 * O catálogo de tabelas que um serviço PostgREST publica na própria raiz.
 *
 * É o que transforma "erramos o nome da tabela" em "aqui está a lista dos
 * nomes". Um serviço assim descreve a si mesmo em OpenAPI, e as chaves de
 * `paths` são exatamente as tabelas consultáveis.
 */
/**
 * Os endereços que um documento OpenAPI declara, com os parâmetros de cada um.
 *
 * É a diferença entre saber que um caminho existe e saber como chamá-lo. O
 * Portal publica isso; consultá-lo encerra a série de palpites que já custou
 * várias rodadas — cada uma descobrindo, uma por vez, o que este documento diz
 * de uma vez só.
 */
export function enderecosDe(openapi, filtro = /emenda|despesa|documento/i) {
  const caminhos = openapi?.paths;
  if (!caminhos || typeof caminhos !== 'object') return null;

  return Object.entries(caminhos)
    .filter(([caminho]) => filtro.test(caminho))
    .map(([caminho, verbos]) => {
      const parametros = Object.values(verbos || {})
        .flatMap((v) => (Array.isArray(v?.parameters) ? v.parameters : []))
        .map((p) => (p?.required ? `${p.name}*` : p?.name))
        .filter(Boolean);
      return `${caminho}${parametros.length ? ` (${[...new Set(parametros)].join(', ')})` : ''}`;
    });
}

/**
 * O que uma página de painel entrega sobre o serviço que está por trás dela.
 *
 * O painel de emendas discricionárias do SERPRO é um mashup do Qlik Sense: a
 * página é uma casca, e os números chegam por WebSocket ao motor do Qlik, num
 * protocolo próprio, endereçado por um identificador de aplicativo. Não existe
 * endereço que devolva as linhas — mas o identificador, o host do serviço e os
 * caminhos que a casca chama estão escritos nela.
 *
 * Isto não puxa dado nenhum: transforma "tem como puxar dali?" em uma resposta
 * verificável, com o que a própria página diz de si. É a mesma escolha que
 * encerrou o adivinhar no Transferegov — ler o que o serviço publica antes de
 * supor como ele funciona.
 */
export function pistasDeQlik(texto) {
  const t = String(texto || '');
  const unico = (lista, limite = 8) => [...new Set(lista)].slice(0, limite);

  const guids = unico((t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []));
  const sockets = unico((t.match(/wss?:\/\/[^\s"'<>)]+/gi) || []));
  const aplicativos = unico((t.match(/(?:openApp|appId|app_id|appid)\s*[:=(]\s*["']([^"']{4,80})["']/gi) || [])
    .map((m) => m.replace(/^.*["']([^"']+)["']$/, '$1')));
  const chamadas = unico((t.match(/["'](\/(?:api|rest|dados|servico|services|data)\/[A-Za-z0-9\-_/.]{1,80})["']/gi) || [])
    .map((m) => m.slice(1, -1)), 12);
  const roteiros = unico((t.match(/<script[^>]+src=["']([^"']+)["']/gi) || [])
    .map((m) => m.replace(/^.*src=["']([^"']+)["'].*$/i, '$1')), 10);

  const qlik = /qlik|enigma|requirejs|\/resources\/|hypercube/i.test(t);
  return {
    qlik,
    guids,
    sockets,
    aplicativos,
    chamadas,
    roteiros,
    // Sem nenhuma das quatro pistas não há o que integrar: a página não diz
    // de onde tira o número, e insistir seria voltar a adivinhar.
    achouAlgo: !!(guids.length || sockets.length || aplicativos.length || chamadas.length),
  };
}

export function tabelasDe(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
  const nomes = dados.paths ? Object.keys(dados.paths) : (dados.definitions && Object.keys(dados.definitions));
  if (!nomes) return null;
  return nomes.map((n) => String(n).replace(/^\//, '')).filter(Boolean);
}

/**
 * A coluna por onde filtrar pelo parlamentar, se a tabela tiver uma.
 *
 * Tabela que nomeia o parlamentar é tabela que se liga na emenda — e uma linha
 * de verdade, com os valores dele, diz mais sobre como usá-la do que a lista de
 * colunas inteira.
 */
export function colunaDoParlamentar(campos = []) {
  return campos.find((c) => /^nome_parlamentar/.test(c))
    || campos.find((c) => /nome_parlamentar/.test(c))
    || null;
}

/** As colunas por onde uma tabela pode se ligar à emenda. */
export function colunasDeEmenda(campos = []) {
  return campos.filter((c) => /emenda|parlamentar/i.test(c));
}

/** Roda as tarefas em pequenas levas, para não enfileirar dezenas de esperas. */
async function emLevas(itens, quantos, tarefa, aoProgredir = () => {}) {
  const saida = [];
  let feitos = 0;
  for (let i = 0; i < itens.length; i += quantos) {
    const leva = itens.slice(i, i + quantos);
    // eslint-disable-next-line no-await-in-loop
    const r = await Promise.all(leva.map((item) => tarefa(item)));
    saida.push(...r);
    feitos += leva.length;
    aoProgredir(feitos, itens.length);
  }
  return saida;
}

/**
 * Percorre tudo e relata o que cada endereço respondeu.
 *
 * Para cada tabela devolve as colunas, quais delas se ligam à emenda e — quando
 * a tabela nomeia o parlamentar — uma linha de verdade dele. É esse conjunto
 * que permite escrever o leitor certo de primeira, em vez de mais um palpite.
 */
export async function sondarFontes(codigoEmenda, { nomeAutor = null, aoProgredir = () => {} } = {}) {
  const { consultarFonte } = await import('./fontes.js');
  const achados = [];

  const tentar = async (fonte, caminho, parametros) => {
    try {
      const r = await consultarFonte(fonte, parametros, caminho);
      // `bruto` só vem quando a resposta não é JSON — é a casca de um painel, e
      // é dela que se tira o endereço do serviço que está por trás.
      return { ok: true, dados: r.dados, bruto: r.bruto || null };
    } catch (erro) {
      return { ok: false, erro: String(erro.message || erro).slice(0, 320) };
    }
  };

  // ── A documentação, antes de qualquer palpite ──
  //
  // Quatro rodadas gastas descobrindo um endereço por vez, quando o serviço
  // publica a lista inteira. Se este bloco responder, nenhum dos palpites
  // abaixo precisa acertar.
  const DOCUMENTACOES = [
    { fonte: 'portal-doc', caminho: '/v3/api-docs' },
    { fonte: 'portal-doc', caminho: '/api-de-dados/v3/api-docs' },
    { fonte: 'transferegov-livre', caminho: '/' },
  ];
  await emLevas(DOCUMENTACOES, 3, async (alvo) => {
    const r = await tentar(alvo.fonte, alvo.caminho, {});
    if (!r.ok) {
      achados.push({ caminho: `doc ${alvo.caminho}`, ok: false, erro: r.erro });
      return;
    }
    const enderecos = enderecosDe(r.dados);
    achados.push({
      caminho: `doc ${alvo.caminho}`,
      ok: true,
      tabelas: enderecos || tabelasDe(r.dados),
      raiz: true,
    });
  }, (f, t) => aoProgredir({ etapa: 'Documentação', feitos: f, total: t }));

  // ── O andar de cima da emenda: painel do SERPRO, SIOP e o catálogo federal ──
  //
  // O Portal publica a emenda depois de virar documento de execução. O painel de
  // discricionárias e o SIOP mostram um andar acima — dotação, empenho por ação,
  // impedimento —, que é onde a emenda existe antes de sair dinheiro. A pergunta
  // é se dá para puxar de lá; daqui não dá nem para olhar, então quem pergunta é
  // o navegador de quem usa, e o relatório diz o que cada endereço respondeu.
  const PAINEIS = [
    { fonte: 'serpro-painel', caminho: '/extensions/painel/DiscricionariasEmendas.html', pistas: true },
    { fonte: 'serpro-painel', caminho: '/api/v1/apps' },
    { fonte: 'serpro-painel', caminho: '/' , pistas: true },
    { fonte: 'siop-livre', caminho: '/api/v1/emendas' },
    { fonte: 'siop-livre', caminho: '/sioplod' , pistas: true },
    // O catálogo federal é o nível acima de todos: em vez de descobrir o
    // endereço de uma base, descobre qual base tem o dado — e com qual arquivo.
    { fonte: 'dados-gov', caminho: '/api/3/action/package_search', parametros: { q: 'emendas parlamentares', rows: '10' } },
    { fonte: 'dados-gov', caminho: '/dados/api/publico/conjuntos-dados', parametros: { nomeConjuntoDados: 'emendas' } },
  ];

  await emLevas(PAINEIS, 3, async (alvo) => {
    const r = await tentar(alvo.fonte, alvo.caminho, alvo.parametros || {});
    const rotulo = `${alvo.fonte}${alvo.caminho}`;
    if (!r.ok) {
      achados.push({ caminho: rotulo, ok: false, erro: r.erro });
      return;
    }
    // A ponte devolve o texto cru quando a resposta não é JSON: é o caso da
    // casca do painel, e é justamente dela que sai o identificador do serviço.
    const bruto = r.bruto || (typeof r.dados === 'string' ? r.dados : null);
    if (bruto) {
      const pistas = pistasDeQlik(bruto);
      achados.push({
        caminho: rotulo,
        ok: true,
        raiz: true,
        tabelas: [
          pistas.qlik ? 'painel Qlik Sense (dados por WebSocket, não por endereço)' : null,
          ...pistas.aplicativos.map((a) => `aplicativo: ${a}`),
          ...pistas.guids.map((g) => `identificador: ${g}`),
          ...pistas.sockets.map((s) => `socket: ${s}`),
          ...pistas.chamadas.map((c) => `chama: ${c}`),
        ].filter(Boolean),
        amostra: pistas.achouAlgo ? null : bruto.slice(0, 300),
      });
      return;
    }
    const lote = [].concat(r.dados).filter(Boolean);
    achados.push({
      caminho: rotulo,
      ok: true,
      quantidade: lote.length,
      campos: Object.keys(lote[0] || {}),
      amostra: lote.length ? recorteDaLinha(lote[0], 600) : null,
    });
  }, (f, t) => aoProgredir({ etapa: 'Painéis', feitos: f, total: t }));

  // ── Portal: sem catálogo, só hipóteses ──
  //
  // O índice de documentos da emenda existe e não traz favorecido nem valor.
  // Esses estão um nível abaixo, e para sondar esse nível é preciso um número de
  // documento de verdade — que só o próprio índice fornece. Por isso ele é
  // consultado antes, e o que ele devolver alimenta as hipóteses seguintes.
  let umDocumento = null;
  let umaData = null;
  try {
    const { linhas } = await documentosDaEmenda(codigoEmenda, { paginasMaximas: 1 });
    const primeiro = linhas.find((l) => l.codigoDocumento || l.documento);
    if (primeiro) {
      umDocumento = primeiro.codigoDocumento || primeiro.documento;
      umaData = primeiro.data ? primeiro.data.split('-').reverse().join('/') : null;
      achados.push({
        caminho: `portal/emendas/documentos/${normalizarCodigo(codigoEmenda)} (amostra)`,
        ok: true,
        quantidade: linhas.length,
        campos: [],
        amostra: recorteDaLinha(primeiro, 500),
      });
    }
  } catch {
    // O índice já é sondado logo abaixo; a falha aqui aparece lá com o motivo.
  }

  const doPortalTentado = caminhosDoPortal(codigoEmenda, umDocumento, umaData);
  await emLevas(doPortalTentado, 3, async (candidato) => {
    const parametros = {
      pagina: 1,
      ...(candidato.usa === 'codigoEmenda' && codigoEmenda ? { codigoEmenda } : {}),
      ...(candidato.parametros || {}),
    };
    const r = await tentar('portal-livre', candidato.caminho, parametros);
    const lote = r.ok ? [].concat(r.dados).filter(Boolean) : [];
    achados.push({
      caminho: `portal${candidato.caminho}`,
      ok: r.ok,
      erro: r.erro,
      quantidade: lote.length,
      campos: Object.keys(lote[0] || {}),
      // Nome de campo não fecha dúvida: precisei aprender isso duas vezes. Uma
      // linha com valores diz de uma vez se ali está o favorecido e o valor.
      amostra: lote.length ? recorteDaLinha(lote[0], 500) : null,
    });
  }, (f, t) => aoProgredir({ etapa: 'Portal', feitos: f, total: t }));

  // ── Transferegov: catálogo primeiro, tabelas depois ──
  const tabelas = [];
  await emLevas(MODULOS_TRANSFEREGOV, 3, async (modulo) => {
    const r = await tentar('transferegov-livre', modulo, {});
    const lista = r.ok ? tabelasDe(r.dados) : null;
    achados.push({
      caminho: modulo, ok: r.ok, erro: r.erro, tabelas: lista, raiz: true,
    });
    (lista || []).forEach((t) => tabelas.push(`${modulo}/${t}`));
  }, (f, t) => aoProgredir({ etapa: 'Catálogos', feitos: f, total: t }));

  // Uma linha por tabela dá as colunas. Onde houver coluna de parlamentar, uma
  // segunda consulta filtrada mostra os valores dele — que é o que ensina a
  // ligar as tabelas entre si.
  await emLevas(tabelas, 4, async (caminho) => {
    const r = await tentar('transferegov-livre', caminho, { limit: 1 });
    if (!r.ok) {
      achados.push({ caminho, ok: false, erro: r.erro });
      return;
    }
    const lote = Array.isArray(r.dados) ? r.dados : [];
    const campos = Object.keys(lote[0] || {});
    const coluna = nomeAutor ? colunaDoParlamentar(campos) : null;

    let amostra = null;
    if (coluna) {
      for (const grafia of grafiasDoNome(nomeAutor)) {
        // eslint-disable-next-line no-await-in-loop
        const f = await tentar('transferegov-livre', caminho,
          { [coluna]: `ilike.*${grafia}*`, limit: 1 });
        const dela = f.ok && Array.isArray(f.dados) ? f.dados : [];
        if (dela.length) { amostra = recorteDaLinha(dela[0], 900); break; }
        if (!f.ok) { amostra = `(filtro recusado: ${f.erro})`; break; }
      }
      if (!amostra) amostra = '(nenhuma linha do parlamentar)';
    }

    achados.push({
      caminho,
      ok: true,
      quantidade: lote.length,
      campos,
      chaves: colunasDeEmenda(campos),
      amostra,
    });
  }, (f, t) => aoProgredir({ etapa: 'Tabelas', feitos: f, total: t }));

  return achados;
}
