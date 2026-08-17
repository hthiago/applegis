/**
 * Renda e produção de cada município, do IBGE.
 *
 * O gabinete não vai preencher PIB, renda e atividade econômica de 497 cidades
 * à mão — e se preencher, o número envelhece sozinho e ninguém percebe. O IBGE
 * publica os três, de graça e sem chave, e o navegador alcança a API direto.
 *
 * Por que isto descobre os códigos em vez de trazê-los escritos: as tabelas do
 * SIDRA são identificadas por número (5938, 6579…) e as variáveis dentro delas
 * também (37, 6543…). Errar um número devolve resposta vazia sem erro nenhum,
 * que é o pior modo de falhar — parece que a cidade não tem dado. Então o
 * caminho aqui é o mesmo que resolveu o Transferegov: ler o catálogo que a
 * própria base publica, achar a tabela pelo nome, achar as variáveis pelo nome,
 * e dizer com todas as letras quando não achar.
 *
 * O que este arquivo NÃO faz: escrever "o que importa nesta cidade". Isso é
 * leitura política, é do gabinete, e nenhuma tabela do IBGE tem.
 */

import { semAcento, CODIGO_UF } from './mapa.js';

const IBGE = 'https://servicodados.ibge.gov.br/api';
const CACHE = 'ibge-tabelas-v1';

/** Número do IBGE: "..." e "-" significam sem informação, não zero. */
export function valorIbge(bruto) {
  const t = String(bruto ?? '').trim();
  if (!t || /^[.\-X]+$/.test(t)) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Achata o catálogo de agregados.
 *
 * A resposta vem agrupada por pesquisa, e o nome da pesquisa é metade da
 * identificação: o agregado do PIB municipal se chama "Produto interno bruto a
 * preços correntes, impostos…", que sozinho não diz que é municipal. Guardar os
 * dois textos juntos é o que permite achar a tabela certa pelo nome.
 */
export function achatarCatalogo(catalogo) {
  const saida = [];
  for (const pesquisa of Array.isArray(catalogo) ? catalogo : []) {
    const nomePesquisa = pesquisa?.nome || '';
    for (const ag of pesquisa?.agregados || []) {
      if (!ag?.id) continue;
      saida.push({
        id: String(ag.id),
        nome: ag.nome || '',
        pesquisa: nomePesquisa,
        texto: `${nomePesquisa} ${ag.nome || ''}`,
      });
    }
  }
  return saida;
}

/** A tabela cujo nome (ou o da pesquisa) casa com o que se procura. */
export function acharAgregado(achatado, re) {
  return achatado.find((a) => re.test(a.texto)) || null;
}

/**
 * As variáveis de uma tabela, pelo nome.
 *
 * Uma variável já tomada não é reaproveitada, e cada alvo pode declarar o que
 * *não* pode aparecer no nome. Os dois cuidados existem pelo mesmo motivo
 * concreto: a variável de serviços do PIB municipal se chama "Valor adicionado
 * bruto dos Serviços […] — exceto Administração, defesa, educação e saúde
 * públicas". Uma busca por "administração" casa com ela, e sem a exclusão os
 * dois setores viriam com o mesmo número e o de serviços viria vazio — sem erro
 * nenhum na tela, que é o pior modo de errar.
 */
export function acharVariaveis(metadados, alvos) {
  const lista = metadados?.variaveis || [];
  const achadas = {};
  const usadas = new Set();
  for (const { chave, re, nao = null } of alvos) {
    const v = lista.find((x) => {
      const nome = String(x.nome || '');
      return !usadas.has(String(x.id)) && re.test(nome) && !(nao && nao.test(nome));
    });
    if (!v) continue;
    usadas.add(String(v.id));
    achadas[chave] = { id: String(v.id), nome: v.nome, unidade: v.unidade || null };
  }
  return achadas;
}

/** A tabela serve se ela chega ao município; senão o dado é do estado. */
export function atendeMunicipio(metadados) {
  const niveis = Object.values(metadados?.nivelTerritorial || {}).flat();
  return niveis.includes('N6');
}

/**
 * O que move a economia da cidade, em uma frase.
 *
 * Sai da repartição do valor adicionado, que é como o IBGE mede de onde vem a
 * riqueza do município. Só entram os setores com peso real — listar um setor de
 * 3% ao lado de um de 60% dá a eles a mesma importância na leitura de quem
 * passa o olho.
 */
export function atividadesDoVab(setores) {
  const nomes = {
    agropecuaria: 'agropecuária',
    industria: 'indústria',
    servicos: 'serviços',
    administracao: 'administração pública',
  };
  const partes = Object.entries(setores)
    .map(([k, v]) => ({ nome: nomes[k] || k, valor: Number(v) || 0 }))
    .filter((p) => p.valor > 0);
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (!total) return null;

  const relevantes = partes
    .map((p) => ({ ...p, parte: (p.valor / total) * 100 }))
    .filter((p) => p.parte >= 10)
    .sort((a, b) => b.parte - a.parte);
  if (!relevantes.length) return null;

  const texto = relevantes.map((p) => `${p.nome} (${p.parte.toFixed(0)}%)`);
  if (texto.length === 1) return texto[0];
  return `${texto.slice(0, -1).join(', ')} e ${texto[texto.length - 1]}`;
}

// ─────────────────────────── descoberta das tabelas ───────────────────────────

const ALVOS_PIB = [
  { chave: 'perCapita', re: /per capita/i },
  // A cláusula "exceto Administração…" do nome da variável de serviços é o que
  // torna esta exclusão necessária; veja acharVariaveis.
  { chave: 'administracao', re: /valor adicionado.*administra[çc]/i, nao: /exceto/i },
  { chave: 'agropecuaria', re: /valor adicionado.*agropecu/i },
  { chave: 'industria', re: /valor adicionado.*ind[úu]stria/i },
  { chave: 'servicos', re: /valor adicionado.*servi[çc]os/i },
];

const ALVOS_RENDA = [
  { chave: 'rendaMedia', re: /rendimento.*(mensal|per capita)/i },
];

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} em ${url.replace(IBGE, '')}`);
  return r.json();
}

/**
 * Resolve, uma vez, quais tabelas e variáveis usar — e guarda o resultado.
 *
 * O catálogo inteiro é grande e não muda de uma semana para a outra; o que fica
 * guardado é só o punhado de identificadores resolvidos, que cabe em qualquer
 * lugar. Se a resolução falhar, ela falha dizendo o que procurou.
 */
export async function tabelasEconomicas({ recarregar = false } = {}) {
  if (!recarregar) {
    try {
      const guardado = localStorage.getItem(CACHE);
      if (guardado) return JSON.parse(guardado);
    } catch { /* sem cache, resolve de novo */ }
  }

  const achatado = achatarCatalogo(await json(`${IBGE}/v3/agregados`));
  if (!achatado.length) throw new Error('O IBGE não devolveu o catálogo de tabelas.');

  const resolver = async (re, alvos, rotulo) => {
    // Mais de um candidato pode casar; vale o primeiro que chegue ao município
    // e tenha as variáveis procuradas.
    for (const candidato of achatado.filter((a) => re.test(a.texto)).slice(0, 6)) {
      let meta;
      try { meta = await json(`${IBGE}/v3/agregados/${candidato.id}/metadados`); } catch { continue; }
      if (!atendeMunicipio(meta)) continue;
      const variaveis = acharVariaveis(meta, alvos);
      if (!Object.keys(variaveis).length) continue;
      return { agregado: candidato.id, nome: candidato.texto.trim(), variaveis };
    }
    console.warn(`IBGE: nenhuma tabela de ${rotulo} com dado por município.`);
    return null;
  };

  const tabelas = {
    pib: await resolver(/produto interno bruto.*munic|valor adicionado bruto/i, ALVOS_PIB, 'PIB municipal'),
    renda: await resolver(/rendimento.*domic|rendimento nominal/i, ALVOS_RENDA, 'rendimento'),
    resolvidoEm: new Date().toISOString().slice(0, 10),
  };
  if (!tabelas.pib && !tabelas.renda) {
    throw new Error('O IBGE respondeu, mas não achei nenhuma tabela de PIB ou rendimento com dado por município. O catálogo pode ter mudado de nome.');
  }

  try { localStorage.setItem(CACHE, JSON.stringify(tabelas)); } catch { /* cheio, tudo bem */ }
  return tabelas;
}

/**
 * Lê uma tabela para um punhado de municípios de uma vez.
 *
 * Em lote porque o contrário seriam mil e quinhentas requisições para varrer um
 * estado — o IBGE aceita vários municípios e várias variáveis numa chamada só, e
 * usar isso é a diferença entre a varredura levar meio minuto ou meia hora.
 */
export async function lerTabela(tabela, codigos) {
  const ids = Object.values(tabela.variaveis).map((v) => v.id);
  if (!ids.length || !codigos.length) return new Map();

  const url = `${IBGE}/v3/agregados/${tabela.agregado}/periodos/-1/variaveis/${ids.join('|')}`
    + `?localidades=N6[${codigos.join('|')}]`;
  const resposta = await json(url);

  const porMunicipio = new Map();
  const chavePorId = new Map(Object.entries(tabela.variaveis).map(([k, v]) => [v.id, k]));

  for (const variavel of resposta || []) {
    const chave = chavePorId.get(String(variavel.id));
    if (!chave) continue;
    // A tabela do PIB mistura unidades: o total e o valor adicionado vêm em mil
    // reais, o per capita vem em reais. Um PIB per capita de "45" numa folha
    // impressa não é um número errado — é um número que engana. A unidade vem
    // na própria resposta, então a conversão não depende de eu adivinhar qual
    // variável é qual.
    const emMil = /\bmil\b/i.test(String(variavel.unidade || tabela.variaveis[chave]?.unidade || ''));
    for (const resultado of variavel.resultados || []) {
      for (const serie of resultado.series || []) {
        const cod = String(serie.localidade?.id || '');
        if (!cod) continue;
        const periodos = Object.entries(serie.serie || {}).sort();
        const ultimo = periodos[periodos.length - 1];
        if (!ultimo) continue;
        if (!porMunicipio.has(cod)) porMunicipio.set(cod, { ano: ultimo[0] });
        const valor = valorIbge(ultimo[1]);
        porMunicipio.get(cod)[chave] = valor == null ? null : (emMil ? valor * 1000 : valor);
      }
    }
  }
  return porMunicipio;
}

/** O que vai para o cadastro de um município, a partir do que o IBGE devolveu. */
export function economiaDoMunicipio(pib, renda, tabelas) {
  const atividades = pib ? atividadesDoVab({
    agropecuaria: pib.agropecuaria,
    industria: pib.industria,
    servicos: pib.servicos,
    administracao: pib.administracao,
  }) : null;

  const fontes = [];
  if (pib?.perCapita || atividades) fontes.push(`${tabelas.pib?.nome || 'PIB dos municípios'} (${pib?.ano || 's/ ano'})`);
  if (renda?.rendaMedia) fontes.push(`${tabelas.renda?.nome || 'rendimento'} (${renda?.ano || 's/ ano'})`);

  const dados = {};
  // Mil reais na tabela do PIB, reais na ficha: um PIB per capita de "45" numa
  // folha impressa não é um número errado, é um número que engana.
  if (pib?.perCapita != null) dados.pibPerCapita = pib.perCapita;
  if (atividades) dados.atividades = atividades;
  if (renda?.rendaMedia != null) dados.rendaMedia = renda.rendaMedia;
  if (fontes.length) {
    dados.fonteEconomia = `IBGE — ${fontes.join('; ')}`;
    dados.atualizadoEconomia = new Date().toISOString().slice(0, 10);
  }
  return dados;
}

/**
 * Varre os municípios cadastrados e preenche renda, PIB e atividade.
 *
 * Não sobrescreve o que já está escrito, a menos que se peça: alguém pode ter
 * corrigido um número à mão por saber de coisa que a tabela não sabe, e uma
 * varredura que apaga correção humana ensina a não confiar no botão.
 */
export async function atualizarEconomia(municipios, {
  substituir = false, uf = null, aoAndar = null,
} = {}) {
  const tabelas = await tabelasEconomicas();

  // O código do IBGE não aparece na ficha, mas é a chave de tudo aqui: é por
  // ele que a tabela responde. Fica guardado no registro para a próxima
  // varredura não precisar resolver o nome de novo.
  let porNome = new Map();
  const codigoUf = CODIGO_UF[String(uf || '').toUpperCase()];
  if (municipios.some((m) => !m.codigoIbge) && codigoUf) {
    const lista = await json(`${IBGE}/v1/localidades/estados/${codigoUf}/municipios`);
    porNome = new Map(lista.map((m) => [semAcento(m.nome), String(m.id)]));
  }

  const alvos = municipios
    .map((m) => ({ m, codigo: m.codigoIbge || porNome.get(semAcento(m.nome)) || null }))
    .filter((x) => x.codigo);

  const funil = {
    municipios: municipios.length,
    comCodigo: alvos.length,
    semCodigo: municipios.length - alvos.length,
    preenchidos: 0,
    preservados: 0,
    semDado: 0,
    tabelas: [tabelas.pib?.nome, tabelas.renda?.nome].filter(Boolean),
  };

  const registros = [];
  const POR_VEZ = 50;
  for (let i = 0; i < alvos.length; i += POR_VEZ) {
    const fatia = alvos.slice(i, i + POR_VEZ);
    const codigos = fatia.map((x) => x.codigo);
    const [pib, renda] = await Promise.all([
      tabelas.pib ? lerTabela(tabelas.pib, codigos).catch(() => new Map()) : new Map(),
      tabelas.renda ? lerTabela(tabelas.renda, codigos).catch(() => new Map()) : new Map(),
    ]);

    for (const { m, codigo } of fatia) {
      const dados = economiaDoMunicipio(pib.get(codigo), renda.get(codigo), tabelas);
      if (!Object.keys(dados).length) { funil.semDado += 1; continue; }

      if (!substituir) {
        for (const campo of ['pibPerCapita', 'rendaMedia', 'atividades']) {
          if (dados[campo] !== undefined && m[campo] !== undefined && m[campo] !== null && m[campo] !== '') {
            delete dados[campo];
            funil.preservados += 1;
          }
        }
      }
      if (!Object.keys(dados).some((k) => k !== 'fonteEconomia' && k !== 'atualizadoEconomia')) continue;

      dados.codigoIbge = codigo;
      registros.push({ id: m.id, dados });
      funil.preenchidos += 1;
    }
    if (aoAndar) aoAndar(Math.min(i + POR_VEZ, alvos.length), alvos.length);
  }

  if (registros.length) {
    const { salvarEmLote } = await import('./dados.js');
    const gravacao = await salvarEmLote('municipios', registros);
    if (gravacao.falhas.length) throw gravacao.falhas[0];
  }
  return funil;
}
