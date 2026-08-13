import {
  decodificar, lerCsv, chaveDoRotulo, numeroBr, dataBr, mesmoNome, nomeParaBusca,
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
 * Grava uma leva de emendas já normalizadas, conciliando com o que existe.
 *
 * É o mesmo caminho para a planilha e para a consulta automática. Duas entradas
 * com duas conciliações seriam duas chances de duplicar o mesmo registro por
 * caminhos diferentes — e a divergência só apareceria meses depois, num número
 * somado em dobro no painel.
 */
async function conciliar(brutas, funil) {
  const { salvarEmLote, listar } = await import('./dados.js');

  const existentes = new Set(
    (await listar('emendas', { recarregar: true })).map((e) => e.id),
  );

  const registros = [];
  const vistos = new Set();

  for (const bruta of brutas) {
    const id = chaveDaLinha(bruta);
    if (!id) { funil.semChave += 1; continue; }
    if (vistos.has(id)) continue;
    vistos.add(id);

    const dados = {};
    for (const [campo, valor] of Object.entries(bruta)) comValor(dados, campo, valor);
    dados.importadoEm = new Date().toISOString().slice(0, 10);

    // A fase é juízo do gabinete e nenhuma fonte a conhece; só se dá um ponto
    // de partida ao registro que está nascendo agora.
    if (!existentes.has(id)) {
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
  const texto = decodificar(await arquivo.arrayBuffer());
  const { cabecalho, linhas } = lerCsv(texto);

  if (!cabecalho.length) throw new Error('O arquivo está vazio ou não é uma planilha de texto.');

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
    temColunaAutor: mapa.autor !== undefined,
    nomeUsado: nomeAutor || null,
  };

  const campo = (linha, nome) => (mapa[nome] === undefined ? null : String(linha[mapa[nome]] ?? '').trim());
  const brutas = [];

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

  return conciliar(brutas, funil);
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

/** "MUNICIPIO DE ERECHIM" é o beneficiário; "Erechim" é o município. */
export function municipioDoBeneficiario(nome) {
  const t = String(nome || '').trim();
  if (!t) return null;
  const m = /^(?:munic[íi]pio|prefeitura(?:\s+municipal)?)\s+(?:de\s+|do\s+|da\s+|dos\s+|das\s+)?(.+)$/i.exec(t);
  return (m ? m[1] : t).trim();
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

/** A chave de uma transferência: o plano de ação identifica sozinho. */
export function chaveDaTransferencia({
  idPlanoAcao, idExecutor, idBeneficiario, codigoEmenda, documento, favorecido, data,
}) {
  const limpo = (v) => String(v || '').trim().replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '');
  // Um plano repartido entre executores são vários destinos, com objetos
  // diferentes. Chave só do plano faria o último sobrescrever os anteriores e o
  // detalhamento sumiria justamente onde ele é mais fino.
  if (idPlanoAcao && idExecutor) return `pa-${limpo(idPlanoAcao)}-ex-${limpo(idExecutor)}`;
  if (idBeneficiario) return `ff-${limpo(idBeneficiario)}`;
  if (idPlanoAcao) return `pa-${limpo(idPlanoAcao)}`;
  if (codigoEmenda && documento) return `${limpo(codigoEmenda)}-${limpo(documento)}`;
  if (documento) return `doc-${limpo(documento)}`;
  if (codigoEmenda && favorecido) {
    return `${limpo(codigoEmenda)}-${limpo(data)}-${limpo(favorecido).slice(0, 40)}`;
  }
  return null;
}

/** Grava um lote de planos de ação já traduzidos. */
async function guardarTransferencias(planos) {
  const { salvarEmLote } = await import('./dados.js');
  const registros = [];
  const vistos = new Set();

  for (const t of planos) {
    const id = chaveDaTransferencia(t);
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const dados = {};
    for (const [campo, valor] of Object.entries(t)) comValor(dados, campo, valor);
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
export async function detalharEmenda(codigo, { nomeAutor = null } = {}) {
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
  const transferencias = await guardarTransferencias(desta.map(doPlanoAcao));

  return {
    transferencias,
    // Três resultados diferentes, três recados diferentes. Confundi-los uma vez
    // já mandou procurar nome de campo quando o problema era o código. E nome de
    // campo sozinho não fecha a dúvida: os nomes podem estar todos certos e os
    // valores todos vazios. Por isso o que volta aqui é a linha inteira, com
    // valores — é ela que responde qualquer das perguntas de uma vez.
    amostra: (desta.length && !transferencias.length) ? recorteDaLinha(desta[0]) : null,
    codigosVistos: (lote.length && !desta.length)
      ? [...new Set(lote.flatMap(codigosDoPlano))].slice(0, 12)
      : null,
    linhas: lote.length,
    procurado: alvo,
    ano: partes.ano,
    // O que foi de fato perguntado. Sem isso, "não encontrei" e "não perguntei
    // direito" saem com o mesmo texto — e só um dos dois é resposta.
    tentativas,
    motivo: lote.length ? null : 'sem-linhas',
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
export function caminhosDoPortal(codigoEmenda) {
  const c = String(codigoEmenda || '').replace(/\D/g, '');
  return [
    { caminho: '/emendas', usa: 'codigoEmenda' },
    c && { caminho: `/emendas/${c}` },
    c && { caminho: `/emendas/documentos/${c}` },
    c && { caminho: `/emendas/${c}/documentos` },
    { caminho: '/emendas/documentos', usa: 'codigoEmenda' },
    { caminho: '/despesas/documentos', usa: 'codigoEmenda' },
  ].filter(Boolean);
}

/**
 * O catálogo de tabelas que um serviço PostgREST publica na própria raiz.
 *
 * É o que transforma "erramos o nome da tabela" em "aqui está a lista dos
 * nomes". Um serviço assim descreve a si mesmo em OpenAPI, e as chaves de
 * `paths` são exatamente as tabelas consultáveis.
 */
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
      return { ok: true, dados: r.dados };
    } catch (erro) {
      return { ok: false, erro: String(erro.message || erro).slice(0, 320) };
    }
  };

  // ── Portal: sem catálogo, só hipóteses ──
  const doPortalTentado = caminhosDoPortal(codigoEmenda);
  await emLevas(doPortalTentado, 3, async (candidato) => {
    const parametros = candidato.usa === 'codigoEmenda' && codigoEmenda
      ? { codigoEmenda, pagina: 1 }
      : { pagina: 1 };
    const r = await tentar('portal-livre', candidato.caminho, parametros);
    const lote = r.ok ? [].concat(r.dados).filter(Boolean) : [];
    achados.push({
      caminho: `portal${candidato.caminho}`,
      ok: r.ok,
      erro: r.erro,
      quantidade: lote.length,
      campos: Object.keys(lote[0] || {}),
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
