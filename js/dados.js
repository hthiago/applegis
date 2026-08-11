import {
  db, collection, doc, getDocs, getDoc, addDoc, updateDoc, serverTimestamp,
  writeBatch, query, where, Timestamp,
} from './firebase.js';
import { sessao } from './sessao.js';
import * as local from './cachelocal.js';

/**
 * Acesso ao Firestore sempre dentro do gabinete da sessão.
 *
 * A ordenação e a busca acontecem no navegador: o volume de um gabinete é de
 * centenas de registros por coleção, e resolver isso aqui evita depender de
 * índices compostos no Firestore a cada campo novo.
 */

function ref(colecao) {
  const g = sessao.membro?.gabineteId;
  if (!g) throw new Error('Sessão sem gabinete definido.');
  return collection(db, 'gabinetes', g, colecao);
}

const cache = new Map();

export function invalidar(colecao) {
  if (colecao) cache.delete(colecao);
  else cache.clear();
}

/**
 * O carimbo de atualização chega como Timestamp do Firestore em produção e
 * como texto no ambiente de teste. Reduzir os dois a milissegundos deixa a
 * comparação igual nos dois lugares.
 */
function emMilissegundos(valor) {
  if (!valor) return 0;
  if (typeof valor.toMillis === 'function') return valor.toMillis();
  const n = Date.parse(valor);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Margem de segurança da leitura incremental.
 *
 * O carimbo é do servidor e a gravação pode demorar a chegar; buscar a partir
 * de alguns minutos antes do último carimbo conhecido custa reler um punhado de
 * registros recentes e evita o único erro que importa aqui, que é uma alteração
 * passar despercebida e ficar invisível para sempre.
 */
const FOLGA_MS = 5 * 60 * 1000;

/**
 * Lê uma coleção, buscando no servidor apenas o que mudou.
 *
 * A cópia local guarda os registros e até quando ela está em dia. A partir daí
 * a consulta ao Firestore pede só `atualizadoEm > último carimbo`, o que numa
 * coleção de milhares de proposições quase sempre devolve zero documentos.
 * Sem cópia local, ou quando o navegador não a oferece, lê tudo como antes.
 */
async function sincronizar(colecao) {
  const gabinete = sessao.membro?.gabineteId;
  const guardados = await local.ler(gabinete, colecao);
  const desde = guardados?.length ? await local.marco(gabinete, colecao) : null;

  const alvo = desde
    ? query(ref(colecao), where('atualizadoEm', '>', Timestamp.fromMillis(desde - FOLGA_MS)))
    : ref(colecao);

  const snap = await getDocs(alvo);
  const mudados = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const juntos = new Map((desde ? guardados : []).map((i) => [i.id, i]));
  for (const i of mudados) juntos.set(i.id, i);

  // Apagar de verdade impediria a leitura incremental de perceber a remoção —
  // o registro simplesmente não voltaria na consulta e continuaria na cópia
  // local para sempre. Por isso `remover` marca, e é aqui que a marca some.
  const removidos = [...juntos.values()].filter((i) => i.removidoEm).map((i) => i.id);
  removidos.forEach((id) => juntos.delete(id));

  // O marco sai sempre de um carimbo do servidor. Usar o relógio do navegador
  // como substituto pareceria funcionar e falharia justamente na máquina com a
  // hora errada, pulando alterações que nunca mais seriam buscadas. Sem carimbo
  // novo, o marco anterior permanece — no limite se relê tudo, que é lento e
  // correto, e nunca incompleto.
  const novoMarco = mudados.reduce((maior, i) => Math.max(maior, emMilissegundos(i.atualizadoEm)), 0);
  await local.guardar(gabinete, colecao, mudados.filter((i) => !i.removidoEm), removidos);
  if (novoMarco) await local.anotarMarco(gabinete, colecao, novoMarco);

  return [...juntos.values()];
}

export async function listar(colecao, { recarregar = false } = {}) {
  if (!recarregar && cache.has(colecao)) return cache.get(colecao);
  const itens = await sincronizar(colecao);
  cache.set(colecao, itens);
  return itens;
}

/** Descarta a cópia local — usado ao sair, e quando se quer reler tudo. */
export async function esquecerCopiaLocal() {
  cache.clear();
  await local.limpar();
}

export async function obter(colecao, id) {
  const snap = await getDoc(doc(db, 'gabinetes', sessao.membro.gabineteId, colecao, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function salvar(colecao, id, dados) {
  const comum = {
    ...dados,
    atualizadoEm: serverTimestamp(),
    atualizadoPor: sessao.membro.email,
  };
  if (id) {
    await updateDoc(doc(db, 'gabinetes', sessao.membro.gabineteId, colecao, id), comum);
  } else {
    comum.criadoEm = serverTimestamp();
    comum.criadoPor = sessao.membro.email;
    const novo = await addDoc(ref(colecao), comum);
    id = novo.id;
  }
  invalidar(colecao);
  return id;
}

/** Teto de operações por lote no Firestore. */
const POR_LOTE = 400;

/**
 * Grava muitos registros de uma vez.
 *
 * Importar a produção de um mandato inteiro são milhares de gravações; feitas
 * uma a uma elas levam minutos e qualquer interrupção deixa o trabalho pela
 * metade. Em lote são poucas idas ao servidor, e o identificador vem de fora
 * (o ID da Câmara), de modo que reimportar corrige o registro existente em vez
 * de duplicá-lo.
 *
 * Devolve o que falhou, em vez de engolir o erro: um lote recusado pelas regras
 * de segurança precisa aparecer na tela, não no console.
 */
export async function salvarEmLote(colecao, itens) {
  const agora = serverTimestamp();
  const quem = sessao.membro.email;
  let gravados = 0;
  const falhas = [];

  for (let i = 0; i < itens.length; i += POR_LOTE) {
    const fatia = itens.slice(i, i + POR_LOTE);
    const lote = writeBatch(db);
    for (const { id, dados } of fatia) {
      lote.set(
        doc(db, 'gabinetes', sessao.membro.gabineteId, colecao, id),
        { ...dados, atualizadoEm: agora, atualizadoPor: quem },
        { merge: true },
      );
    }
    try {
      await lote.commit();
      gravados += fatia.length;
    } catch (erro) {
      falhas.push(erro);
    }
  }

  invalidar(colecao);
  return { gravados, falhas };
}

/**
 * Remove um registro.
 *
 * A remoção é marcada, não executada: um documento apagado de fato desaparece
 * da consulta incremental sem deixar rastro, e cada navegador continuaria
 * mostrando a cópia local dele indefinidamente. A marca viaja como qualquer
 * outra alteração e some de todos os lugares. Como efeito colateral útil, uma
 * exclusão acidental continua recuperável no console do Firebase.
 */
export async function remover(colecao, id) {
  await updateDoc(doc(db, 'gabinetes', sessao.membro.gabineteId, colecao, id), {
    removidoEm: serverTimestamp(),
    removidoPor: sessao.membro.email,
    atualizadoEm: serverTimestamp(),
  });
  invalidar(colecao);
}

/** Opções de um campo de referência, no formato {v, l}. */
export async function opcoesDe(colecao, rotulo) {
  const itens = await listar(colecao);
  return itens
    .map((i) => ({ v: i.id, l: i[rotulo] || '(sem nome)' }))
    .sort((a, b) => a.l.localeCompare(b.l, 'pt-BR'));
}

/**
 * Próximo número da série do ano corrente, no formato 001/2026.
 * Lê o que já existe e continua a contagem, em vez de manter um contador
 * separado que sai de sincronia quando alguém apaga um registro.
 */
export async function proximoNumero(colecao, campo) {
  const ano = new Date().getFullYear();
  const itens = await listar(colecao, { recarregar: true });
  let maior = 0;
  for (const i of itens) {
    const m = /^(\d+)\s*\/\s*(\d{4})$/.exec(String(i[campo] || '').trim());
    if (m && Number(m[2]) === ano) maior = Math.max(maior, Number(m[1]));
  }
  return `${String(maior + 1).padStart(3, '0')}/${ano}`;
}
