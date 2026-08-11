import { el, aviso, limpar } from './ui.js';
import { salvar, listar } from './dados.js';

/**
 * Integração com os dados abertos da Câmara dos Deputados.
 * Base pública, sem cadastro: https://dadosabertos.camara.leg.br/swagger/api.html
 */

const BASE = 'https://dadosabertos.camara.leg.br/api/v2';

async function buscarJson(caminho) {
  const r = await fetch(`${BASE}${caminho}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Câmara respondeu ${r.status}`);
  return (await r.json()).dados;
}

export async function procurarProposicoes({ sigla, numero, ano }) {
  const p = new URLSearchParams({ siglaTipo: sigla, numero, ano, itens: '10' });
  return buscarJson(`/proposicoes?${p}`);
}

/**
 * A Câmara devolve autores e subscritores na mesma lista, e um projeto com
 * quarenta apoiadores esconde quem de fato o apresentou.
 *
 * Filtrar por `proponente` não resolve: a base marca esse campo para todos os
 * signatários em boa parte das proposições. A regra que sobrevive a isso é
 * ordenar — proponente à frente, depois ordem de assinatura — e ficar com o
 * primeiro. Assim sai sempre exatamente um nome, qualquer que seja o formato
 * dos dados. A lista completa é preservada num campo à parte.
 */
function autoria(autores) {
  if (!autores.length) return { autor: null, coautores: 0, autoresTodos: null };

  const ordenados = [...autores].sort((a, b) => {
    const porProponente = Number(b.proponente || 0) - Number(a.proponente || 0);
    if (porProponente) return porProponente;
    return Number(a.ordemAssinatura || 9999) - Number(b.ordemAssinatura || 9999);
  });

  return {
    autor: ordenados[0].nome,
    coautores: autores.length - 1,
    autoresTodos: autores.map((a) => a.nome).join(', '),
  };
}

/** Quantos órgãos guardar na trilha. O começo de uma tramitação longa importa menos que o fim. */
const PASSOS_GUARDADOS = 12;

/**
 * Órgãos por onde a matéria apenas passa. A Mesa recebe o processo toda vez
 * que o Presidente precisa despachar o próximo destino, então ela reaparece
 * entre cada comissão e polui o caminho sem dizer nada sobre ele.
 */
const ORGAOS_DE_PASSAGEM = ['MESA'];

/** Junta entradas vizinhas no mesmo órgão. */
function semRepeticoes(passos) {
  return passos.filter((p, i, todos) => i === 0 || todos[i - 1].orgao !== p.orgao);
}

/**
 * Reduz o histórico de tramitações ao caminho percorrido: um passo por órgão,
 * com a data de chegada. A base repete o mesmo órgão a cada despacho, então
 * entradas consecutivas no mesmo lugar viram um passo só.
 */
function trilhaDe(tramitacoes) {
  const cronologica = [...tramitacoes]
    .sort((a, b) => String(a.dataHora).localeCompare(String(b.dataHora)));

  return semRepeticoes(
    cronologica
      .filter((t) => t.siglaOrgao)
      .map((t) => ({ orgao: t.siglaOrgao, data: String(t.dataHora).slice(0, 10) })),
  );
}

/**
 * O caminho que interessa: sem os órgãos de passagem. Tirá-los deixa vizinhos
 * repetidos — CDHMIR, Mesa, CDHMIR vira CDHMIR duas vezes —, por isso a
 * segunda limpeza.
 */
function trilhaEnxuta(passos) {
  return semRepeticoes(passos.filter((p) => !ORGAOS_DE_PASSAGEM.includes(p.orgao)));
}

export async function detalharProposicao(id) {
  const [dados, autores, tramitacoes] = await Promise.all([
    buscarJson(`/proposicoes/${id}`),
    buscarJson(`/proposicoes/${id}/autores`).catch(() => []),
    buscarJson(`/proposicoes/${id}/tramitacoes`).catch(() => []),
  ]);

  const completa = trilhaDe(tramitacoes);
  const enxuta = trilhaEnxuta(completa);
  const status = dados.statusProposicao || {};

  return {
    idCamara: dados.id,
    identificacao: `${dados.siglaTipo} ${dados.numero}/${dados.ano}`,
    ementa: dados.ementa || null,
    ...autoria(autores),
    situacao: status.descricaoSituacao || status.descricaoTramitacao || null,
    // Situação e órgão descrevem coisas diferentes — o estado da matéria e
    // onde ela está. Sem a data, a combinação parece contraditória.
    situacaoEm: status.dataHora ? String(status.dataHora).slice(0, 10) : null,
    despacho: status.despacho || null,
    orgao: status.siglaOrgao || enxuta[enxuta.length - 1]?.orgao || null,
    tramitacao: enxuta.slice(-PASSOS_GUARDADOS),
    tramitacaoCompleta: completa.slice(-PASSOS_GUARDADOS * 2),
  };
}

/** De quanto em quanto tempo a lista se atualiza sozinha ao ser aberta. */
const HORAS_ENTRE_CONSULTAS = 6;

/** Relê na Câmara a situação de tudo que está na lista de vigilância. */
export async function sincronizarProposicoes({ avisarSeVazio = true } = {}) {
  const itens = (await listar('proposicoes', { recarregar: true })).filter((i) => i.idCamara);
  if (!itens.length) {
    if (avisarSeVazio) {
      aviso('Nenhuma proposição com vínculo à Câmara. Use "Buscar na Câmara" para adicionar.', 'erro');
    }
    return 0;
  }

  const agora = new Date().toISOString();
  let atualizadas = 0;

  for (const item of itens) {
    try {
      const novo = await detalharProposicao(item.idCamara);
      const mudou = novo.situacao !== item.situacao || novo.orgao !== item.orgao;
      if (mudou) atualizadas += 1;

      await salvar('proposicoes', item.id, {
        ementa: novo.ementa ?? item.ementa ?? null,
        autor: novo.autor ?? item.autor ?? null,
        coautores: novo.coautores,
        autoresTodos: novo.autoresTodos ?? item.autoresTodos ?? null,
        situacao: novo.situacao,
        situacaoEm: novo.situacaoEm,
        despacho: novo.despacho,
        orgao: novo.orgao,
        tramitacao: novo.tramitacao,
        tramitacaoCompleta: novo.tramitacaoCompleta,
        sincronizadoEm: agora,
        // Guardar de onde veio é o que permite ao painel dizer o que mudou,
        // e não apenas que algo mudou.
        ...(mudou ? {
          situacaoAnterior: [item.situacao, item.orgao].filter(Boolean).join(' · ') || null,
          mudouEm: agora.slice(0, 10),
        } : {}),
      });
    } catch (erro) {
      console.error(`Falha ao atualizar ${item.identificacao}`, erro);
    }
  }
  return atualizadas;
}

/**
 * Consulta em segundo plano ao abrir a lista, se a última já estiver velha.
 * Devolve null quando não havia o que fazer — a data da última consulta sai
 * das próprias proposições, sem precisar de um registro de controle à parte.
 */
export async function sincronizarSeNecessario() {
  const comVinculo = (await listar('proposicoes')).filter((i) => i.idCamara);
  if (!comVinculo.length) return null;

  const ultima = comVinculo.map((i) => i.sincronizadoEm || '').sort().pop();
  if (ultima && Date.now() - new Date(ultima).getTime() < HORAS_ENTRE_CONSULTAS * 3600e3) return null;

  return sincronizarProposicoes({ avisarSeVazio: false });
}

/** Quantas consultas simultâneas à Câmara. Alto demais, a base começa a recusar. */
const CONSULTAS_EM_PARALELO = 6;

async function emLotes(itens, tamanho, tarefa) {
  const saida = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    saida.push(...await Promise.all(itens.slice(i, i + tamanho).map(tarefa)));
  }
  return saida;
}

/**
 * Autor ou subscritor?
 *
 * A base não responde isso diretamente: numa proposição coletiva, todos os
 * signatários aparecem como autores. Quem de fato apresentou é quem assina em
 * primeiro lugar, então a distinção sai da ordem de assinatura do parlamentar
 * naquela proposição.
 */
function papelNaProposicao(autores, idDeputado) {
  const uri = `/deputados/${idDeputado}`;
  const nossa = autores.find((a) => String(a.uri || '').endsWith(uri));
  if (!nossa) return null;
  const menorOrdem = Math.min(...autores.map((a) => Number(a.ordemAssinatura || 9999)));
  return Number(nossa.ordemAssinatura || 9999) === menorOrdem ? 'autor' : 'subscritor';
}

async function temaDe(id) {
  const temas = await buscarJson(`/proposicoes/${id}/temas`).catch(() => []);
  return temas.map((t) => t.tema).filter(Boolean).join(', ') || null;
}

/**
 * Traz tudo que o parlamentar assinou e separa autoria de subscrição.
 *
 * A lista vem de uma consulta só, mas o papel e o tema exigem uma consulta por
 * proposição — por isso o trabalho é feito em lotes e o resultado, guardado.
 * Reimportar só custa as proposições novas.
 */
export async function importarProducao(idDeputado, aoProgredir = () => {}) {
  const jaTemos = new Map(
    (await listar('autorias', { recarregar: true })).map((i) => [i.idCamara, i]),
  );

  const achadas = [];
  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const p = new URLSearchParams({
      idDeputadoAutor: String(idDeputado),
      itens: '100',
      pagina: String(pagina),
      ordem: 'DESC',
      ordenarPor: 'id',
    });
    const lote = await buscarJson(`/proposicoes?${p}`);
    achadas.push(...lote);
    if (lote.length < 100) break;
  }

  const novas = achadas.filter((p) => !jaTemos.has(p.id));
  aoProgredir({ total: achadas.length, novas: novas.length, feitas: 0 });

  let feitas = 0;
  await emLotes(novas, CONSULTAS_EM_PARALELO, async (p) => {
    try {
      const [autores, tema] = await Promise.all([
        buscarJson(`/proposicoes/${p.id}/autores`).catch(() => []),
        temaDe(p.id),
      ]);
      const detalhe = await detalharProposicao(p.id);

      await salvar('autorias', null, {
        idCamara: p.id,
        identificacao: detalhe.identificacao,
        ementa: detalhe.ementa,
        papel: papelNaProposicao(autores, idDeputado) || 'subscritor',
        tema: tema || 'Sem tema classificado',
        apresentadaEm: p.dataApresentacao ? String(p.dataApresentacao).slice(0, 10) : null,
        situacao: detalhe.situacao,
        situacaoEm: detalhe.situacaoEm,
        tramitacao: detalhe.tramitacao,
        autoresTodos: detalhe.autoresTodos,
        coautores: detalhe.coautores,
      });
    } catch (erro) {
      console.error(`Falha ao importar proposição ${p.id}`, erro);
    } finally {
      feitas += 1;
      aoProgredir({ total: achadas.length, novas: novas.length, feitas });
    }
  });

  return { total: achadas.length, importadas: novas.length };
}

/** Órgãos em que o parlamentar tem assento hoje, mais o Plenário. */
async function orgaosDoDeputado(idDeputado) {
  const orgaos = await buscarJson(`/deputados/${idDeputado}/orgaos?itens=100`).catch(() => []);
  const atuais = orgaos
    .filter((o) => !o.dataFim || o.dataFim >= new Date().toISOString().slice(0, 10))
    .map((o) => o.siglaOrgao)
    .filter(Boolean);
  return new Set(['PLEN', ...atuais]);
}

function comoData(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Traz a pauta dos próximos dias: as sessões e reuniões dos órgãos em que o
 * parlamentar tem assento, com os itens de cada uma.
 *
 * Cada item entra com a orientação em branco — a decisão é do gabinete, não da
 * importação. O que a Câmara fornece é o que está em pauta, não o que fazer.
 */
export async function importarPauta(idDeputado, dias = 7) {
  const hoje = new Date();
  const ate = new Date(hoje.getTime() + dias * 86400e3);

  const [meusOrgaos, jaTemos] = await Promise.all([
    orgaosDoDeputado(idDeputado),
    listar('pauta', { recarregar: true }),
  ]);

  const conhecidos = new Set(jaTemos.map((p) => `${p.data}|${p.orgao}|${p.item}`));

  const p = new URLSearchParams({
    dataInicio: comoData(hoje),
    dataFim: comoData(ate),
    itens: '100',
    ordem: 'ASC',
    ordenarPor: 'dataHoraInicio',
  });
  const eventos = await buscarJson(`/eventos?${p}`);

  const relevantes = eventos.filter((e) => (e.orgaos || []).some((o) => meusOrgaos.has(o.sigla)));
  let importados = 0;

  await emLotes(relevantes, CONSULTAS_EM_PARALELO, async (evento) => {
    try {
      const itens = await buscarJson(`/eventos/${evento.id}/pauta`).catch(() => []);
      const orgao = (evento.orgaos || []).find((o) => meusOrgaos.has(o.sigla))?.sigla || 'PLEN';
      const data = String(evento.dataHoraInicio || '').slice(0, 10);

      for (const item of itens) {
        const prop = item.proposicao_ || {};
        const nome = prop.siglaTipo
          ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}${prop.ementa ? ` — ${prop.ementa}` : ''}`
          : (item.titulo || item.topico || '').trim();
        if (!nome) continue;

        const chave = `${data}|${orgao}|${nome}`;
        if (conhecidos.has(chave)) continue;
        conhecidos.add(chave);

        await salvar('pauta', null, {
          data,
          orgao,
          item: nome,
          posicionamento: 'definir',
          relator: item.relator?.nome || null,
          idEventoCamara: evento.id,
        });
        importados += 1;
      }
    } catch (erro) {
      console.error(`Falha ao ler a pauta do evento ${evento.id}`, erro);
    }
  });

  return { eventos: relevantes.length, importados };
}

const TIPOS = ['PL', 'PEC', 'PLP', 'PDL', 'MPV', 'PRC', 'REQ'];

export function abrirBuscaCamara(aoImportar) {
  const form = el('form', { class: 'form' });
  const sigla = el('select', { name: 'sigla' }, TIPOS.map((t) => el('option', { value: t, texto: t })));
  const numero = el('input', { type: 'number', required: true, inputmode: 'numeric' });
  const ano = el('input', { type: 'number', required: true, inputmode: 'numeric' });
  ano.value = String(new Date().getFullYear());

  const resultados = el('div', { class: 'resultados' });
  const btn = el('button', { class: 'btn btn--primario', type: 'submit', texto: 'Buscar' });

  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', aoTeclar); };
  const aoTeclar = (e) => { if (e.key === 'Escape') fechar(); };

  form.append(
    el('div', { class: 'linha-campos' }, [
      el('div', { class: 'campo' }, [el('label', { texto: 'Tipo' }), sigla]),
      el('div', { class: 'campo' }, [el('label', { texto: 'Número *' }), numero]),
      el('div', { class: 'campo' }, [el('label', { texto: 'Ano *' }), ano]),
    ]),
    el('div', { class: 'modal-acoes' }, [
      el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Fechar', onclick: () => fechar() }),
      btn,
    ]),
    resultados,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Buscando…';
    limpar(resultados).appendChild(el('p', { class: 'bloco-vazio', texto: 'Consultando a base da Câmara…' }));
    try {
      const achados = await procurarProposicoes({
        sigla: sigla.value, numero: numero.value, ano: ano.value,
      });
      limpar(resultados);
      if (!achados.length) {
        resultados.appendChild(el('p', { class: 'bloco-vazio', texto: 'Nada encontrado com esse tipo, número e ano.' }));
        return;
      }
      achados.forEach((a) => {
        resultados.appendChild(el('div', { class: 'resultado' }, [
          el('div', {}, [
            el('strong', { texto: `${a.siglaTipo} ${a.numero}/${a.ano}` }),
            el('p', { texto: a.ementa || 'Sem ementa.' }),
          ]),
          el('button', {
            class: 'btn btn--primario',
            type: 'button',
            texto: 'Acompanhar',
            onclick: async (ev) => {
              ev.target.disabled = true;
              ev.target.textContent = 'Importando…';
              try {
                const detalhe = await detalharProposicao(a.id);
                await salvar('proposicoes', null, { ...detalhe, prioridade: 'normal' });
                aviso(`${detalhe.identificacao} entrou na lista de acompanhamento.`);
                fechar();
                aoImportar();
              } catch (erro) {
                console.error(erro);
                aviso('Não foi possível importar a proposição.', 'erro');
                ev.target.disabled = false;
                ev.target.textContent = 'Acompanhar';
              }
            },
          }),
        ]));
      });
    } catch (erro) {
      console.error(erro);
      limpar(resultados).appendChild(el('p', {
        class: 'bloco-vazio',
        texto: 'Não foi possível falar com a base da Câmara agora. Tente de novo em instantes.',
      }));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Buscar';
    }
  });

  const fundo = el('div', { class: 'modal-fundo', onclick: (e) => { if (e.target === fundo) fechar(); } }, [
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { class: 'modal-titulo', texto: 'Buscar proposição na Câmara' }),
      form,
    ]),
  ]);
  document.body.appendChild(fundo);
  document.addEventListener('keydown', aoTeclar);
  numero.focus();
}
