/**
 * Leitura da cota parlamentar (CEAP) como a Câmara a publica.
 *
 * Separado de camara.js de propósito: aqui não entra Firebase nem rede, só a
 * tradução de um lançamento da base para o registro do gabinete. Função pura se
 * confere com teste rodando em dois segundos; misturada ao cliente do banco,
 * dependeria de subir um navegador para saber se uma rubrica caiu na categoria
 * certa.
 *
 * A CEAP é a única despesa do mandato que a Câmara publica lançamento por
 * lançamento, com fornecedor, CNPJ, documento e valor. Digitar isso à mão era
 * transcrever base pública — trabalho que erra, atrasa e não acrescenta nada. O
 * que o gabinete tem a fazer com esses números é conferir e explicar.
 */

const RUBRICAS = [
  { v: 'passagens', re: /passagem|a[ée]re/i },
  { v: 'escritorio', re: /manuten[çc][ãa]o\s+de\s+escrit/i },
  { v: 'divulgacao', re: /divulga[çc][ãa]o/i },
  { v: 'consultoria', re: /consultoria|trabalho\s+t[ée]cnico|pesquisa/i },
  { v: 'locomocao', re: /locomo[çc][ãa]o|hospedagem|alimenta[çc][ãa]o/i },
  { v: 'combustivel', re: /combust[íi]ve|lubrificante/i },
  { v: 'veiculos', re: /loca[çc][ãa]o.*(ve[íi]culo|embarca|aeronave)/i },
  { v: 'telefonia', re: /telefon/i },
  // A Câmara escreve "SERVIÇOS POSTAIS", no plural: a regra no singular deixava
  // a rubrica inteira cair em "outro", que é exatamente o balde que não informa.
  { v: 'postal', re: /posta(?:l|is)|correio/i },
  { v: 'seguranca', re: /seguran[çc]a/i },
  { v: 'material', re: /material|inform[áa]tica|assinatura\s+de\s+public/i },
  { v: 'curso', re: /curso|evento|congresso|semin[áa]rio/i },
];

export function rubricaDe(texto) {
  const t = String(texto || '');
  return (RUBRICAS.find((r) => r.re.test(t)) || {}).v || 'outro';
}

/** Um lançamento da Câmara traduzido para o registro do gabinete. */
export function doGastoDaCamara(g) {
  const valor = Number(g.valorLiquido ?? g.valorDocumento) || 0;
  const data = String(g.dataDocumento || '').slice(0, 10) || null;
  return {
    data,
    ano: Number(g.ano) || (data ? Number(data.slice(0, 4)) : null),
    mes: Number(g.mes) || (data ? Number(data.slice(5, 7)) : null),
    categoria: rubricaDe(g.tipoDespesa),
    rubricaNaFonte: g.tipoDespesa || null,
    fornecedor: g.nomeFornecedor || null,
    fornecedorDoc: g.cnpjCpfFornecedor || null,
    descricao: g.tipoDocumento || null,
    valor,
    valorGlosa: Number(g.valorGlosa) || null,
    notaFiscal: g.numDocumento || null,
    urlDocumento: g.urlDocumento || null,
    lote: g.codLote ?? null,
    parcela: g.parcela ?? null,
    situacao: 'conferido',
    fonte: 'Câmara dos Deputados (dados abertos)',
  };
}

/**
 * A chave de um lançamento.
 *
 * `codDocumento` identifica o documento na Câmara e é o que impede duplicata
 * quando se reimporta. Sem ele — lançamentos antigos não o traziam — cai-se na
 * combinação que de fato distingue: data, fornecedor, valor e número da nota.
 */
export function chaveDoGasto(g) {
  if (g.codDocumento) return `cd-${String(g.codDocumento).replace(/\W/g, '')}`;
  const limpo = (v) => String(v ?? '').replace(/\W+/g, '-').slice(0, 30);
  return `g-${limpo(g.dataDocumento).slice(0, 10)}-${limpo(g.cnpjCpfFornecedor)}-${limpo(g.numDocumento)}-${Math.round(Number(g.valorLiquido || g.valorDocumento || 0) * 100)}`;
}

