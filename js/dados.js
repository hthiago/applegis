import {
  db, collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from './firebase.js';
import { sessao } from './sessao.js';

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

export async function listar(colecao, { recarregar = false } = {}) {
  if (!recarregar && cache.has(colecao)) return cache.get(colecao);
  const snap = await getDocs(ref(colecao));
  const itens = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  cache.set(colecao, itens);
  return itens;
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

export async function remover(colecao, id) {
  await deleteDoc(doc(db, 'gabinetes', sessao.membro.gabineteId, colecao, id));
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
