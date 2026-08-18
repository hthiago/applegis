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
// v2: a v1 aceitava série encerrada e não sondava a tabela antes de usá-la, e
// ficou guardada no navegador de quem já rodou a varredura.
const CACHE = 'ibge-tabelas-v2';

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

// "Rendimento médio de pessoas de 14 anos ou mais ocupadas por posição na
// ocupação" não é "renda média do município": numa ficha levada a uma reunião
// esse número seria defendido como se fosse outro. Ou vem o rendimento
// domiciliar per capita, ou o campo fica vazio.
const ALVOS_RENDA = [
  { chave: 'rendaMedia', re: /rendimento.*domiciliar.*per capita/i },
];

/** Séries encerradas ainda respondem — com o retrato de dez anos atrás. */
const ENCERRADA = /s[ée]rie encerrada|descontinuad/i;

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url.replace(IBGE, '')}`);
  return r.json();
}

/** Até quando a tabela vai. É por aqui que a série viva vence a encerrada. */
export function ultimoPeriodo(metadados) {
  const fim = metadados?.periodicidade?.fim;
  const n = Number(String(fim ?? '').slice(0, 4));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Resolve, uma vez, quais tabelas e variáveis usar — e guarda o resultado.
 *
 * Três filtros, e cada um deles existe por um erro concreto que aconteceu:
 *
 *   1. Série encerrada fora. A primeira versão escolheu a tabela do PIB
 *      "Referência 2002 (Série encerrada)" — ela responde, e responde velho.
 *   2. A tabela mais recente primeiro, pelo fim da série declarado no metadado.
 *   3. E, no fim, uma sonda: pede o dado de um município de verdade e só aceita
 *      a tabela se vier número. Sem isso, uma tabela que exige classificação ou
 *      que não tem o período pedido devolve vazio sem erro nenhum, e a
 *      varredura inteira termina com "497 sem dado publicado" — que foi
 *      exatamente o que aconteceu.
 */
export async function tabelasEconomicas({ recarregar = false, codigoProva = null } = {}) {
  if (!recarregar) {
    try {
      const guardado = localStorage.getItem(CACHE);
      if (guardado) return JSON.parse(guardado);
    } catch { /* sem cache, resolve de novo */ }
  }

  const achatado = achatarCatalogo(await json(`${IBGE}/v3/agregados`));
  if (!achatado.length) throw new Error('O IBGE não devolveu o catálogo de tabelas.');

  const tentativas = [];
  const resolver = async (re, alvos, rotulo) => {
    const candidatos = achatado.filter((a) => re.test(a.texto) && !ENCERRADA.test(a.texto));
    if (!candidatos.length) {
      tentativas.push(`${rotulo}: nenhuma tabela com esse nome no catálogo`);
      return null;
    }

    const comMeta = [];
    for (const c of candidatos.slice(0, 12)) {
      let meta;
      try { meta = await json(`${IBGE}/v3/agregados/${c.id}/metadados`); } catch { continue; }
      if (!atendeMunicipio(meta)) continue;
      const variaveis = acharVariaveis(meta, alvos);
      if (!Object.keys(variaveis).length) continue;
      comMeta.push({ agregado: c.id, nome: c.texto.trim(), variaveis, ate: ultimoPeriodo(meta) });
    }
    if (!comMeta.length) {
      tentativas.push(`${rotulo}: ${candidatos.length} tabela(s) pelo nome, nenhuma com dado por município e as variáveis procuradas`);
      return null;
    }

    comMeta.sort((a, b) => b.ate - a.ate);
    if (!codigoProva) return comMeta[0];

    for (const t of comMeta) {
      try {
        const prova = await lerTabela(t, [codigoProva]);
        const valores = prova.get(String(codigoProva)) || {};
        if (Object.entries(valores).some(([k, v]) => k !== 'ano' && v != null)) return t;
      } catch (erro) {
        tentativas.push(`${rotulo}: tabela ${t.agregado} recusou a consulta (${erro.message})`);
      }
    }
    tentativas.push(`${rotulo}: ${comMeta.length} tabela(s) candidatas, nenhuma devolveu número para o município de prova`);
    return null;
  };

  const tabelas = {
    pib: await resolver(/produto interno bruto.*munic|valor adicionado bruto/i, ALVOS_PIB, 'PIB municipal'),
    renda: await resolver(/rendimento.*domiciliar/i, ALVOS_RENDA, 'rendimento domiciliar per capita'),
    tentativas,
    resolvidoEm: new Date().toISOString().slice(0, 10),
  };
  if (!tabelas.pib && !tabelas.renda) {
    throw new Error(`O IBGE respondeu, mas nenhuma tabela serviu. ${tentativas.join('; ')}.`);
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

  const curto = (t) => String(t || '').split(/[,;]| - /)[0].trim().slice(0, 70);
  const fontes = [];
  if (pib?.perCapita || atividades) fontes.push(`${curto(tabelas.pib?.nome) || 'PIB dos municípios'} (${pib?.ano || 's/ ano'})`);
  if (renda?.rendaMedia) fontes.push(`${curto(tabelas.renda?.nome) || 'rendimento'} (${renda?.ano || 's/ ano'})`);

  const dados = {};
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

  if (!alvos.length) {
    throw new Error(uf
      ? `Nenhum dos ${municipios.length} municípios cadastrados foi reconhecido na lista do IBGE de ${uf}. Confira a UF em Acessos → Dados do gabinete.`
      : 'Informe a UF do gabinete em Acessos → Dados do gabinete: é por ela que os municípios são reconhecidos no IBGE.');
  }

  // A tabela é escolhida com um município de verdade na mão, e não no escuro:
  // é a sonda que separa a tabela certa da que responde vazio sem reclamar.
  const tabelas = await tabelasEconomicas({ codigoProva: alvos[0].codigo });

  const funil = {
    municipios: municipios.length,
    comCodigo: alvos.length,
    semCodigo: municipios.length - alvos.length,
    preenchidos: 0,
    preservados: 0,
    semDado: 0,
    tabelas: [tabelas.pib, tabelas.renda].filter(Boolean).map((t) => `${t.nome.slice(0, 60)} (até ${t.ate || '?'})`),
    faltando: tabelas.tentativas || [],
    erros: [],
  };

  const registros = [];
  const POR_VEZ = 50;
  for (let i = 0; i < alvos.length; i += POR_VEZ) {
    const fatia = alvos.slice(i, i + POR_VEZ);
    const codigos = fatia.map((x) => x.codigo);
    // A falha de rede é registrada, não engolida: foi engolindo-a que a
    // varredura anterior conseguiu terminar dizendo "497 sem dado publicado",
    // que manda procurar defeito no IBGE quando o defeito era a consulta.
    const pegar = async (tabela) => {
      if (!tabela) return new Map();
      try {
        return await lerTabela(tabela, codigos);
      } catch (erro) {
        if (funil.erros.length < 3) funil.erros.push(erro.message);
        return new Map();
      }
    };
    const [pib, renda] = await Promise.all([pegar(tabelas.pib), pegar(tabelas.renda)]);

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
