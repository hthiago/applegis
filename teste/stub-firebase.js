// Duplo do SDK do Firebase, em memória, servido no lugar dos módulos do gstatic.
const armazem = new Map(); // "caminho/da/colecao" -> Map(id -> dados)

function colecaoDe(caminho) {
  if (!armazem.has(caminho)) armazem.set(caminho, new Map());
  return armazem.get(caminho);
}

// ── semente ──
// Com __BANCO_VAZIO_TESTE não se semeia nada, para exercitar o primeiro acesso.
if (!globalThis.__BANCO_VAZIO_TESTE) {
  colecaoDe('sistema').set('instalado', { por: 'chefe@teste.br' });
  colecaoDe('gabinetes').set('g1', { nome: 'Gabinete de Teste', deputado: 'Deputada Teste', uf: 'RS' });
  colecaoDe('autorizados').set('chefe@teste.br', {
    nome: 'Chefe Teste',
    papel: globalThis.__PAPEL_TESTE || 'chefe',
    gabineteId: 'g1',
    areas: globalThis.__AREAS_TESTE || [],
    ativo: true,
  });
}
if (!globalThis.__BANCO_VAZIO_TESTE) {
colecaoDe('gabinetes/g1/equipe').set('e1', { nome: 'Ana Assessora', cargo: 'Secretária parlamentar', funcao: 'legislativo', lotacao: 'brasilia', situacao: 'ativo' });
colecaoDe('gabinetes/g1/tarefas').set('t1', {
  titulo: 'Preparar parecer da comissão', area: 'legislativo', responsavel: 'e1',
  prazo: '2020-01-01', prioridade: 'alta', status: 'aberta',
});
colecaoDe('gabinetes/g1/emendas').set('em1', {
  ano: 2026, tipo: 'individual', beneficiario: 'Prefeitura de Erechim', municipio: 'Erechim',
  uf: 'RS', areaDestino: 'saude', valorIndicado: 500000, valorEmpenhado: 300000,
  valorPago: 100000, fase: 'execucao',
});
// Situação propositalmente desatualizada e autoria "suja": a consulta
// automática ao abrir a lista precisa corrigir as duas.
colecaoDe('gabinetes/g1/proposicoes').set('p1', {
  identificacao: 'PL 1904/2024', idCamara: 2430726,
  autor: 'Fulano, Beltrano, Sicrano e mais 40',
  ementa: 'Acresce dois parágrafos ao art. 124.',
  situacao: 'Aguardando Despacho', orgao: 'CPASF', prioridade: 'normal', notaInterna: null,
});
}

let proximoId = 100;

export function initializeApp() { return { nome: 'stub' }; }
export function getFirestore() { return { stub: true }; }
export function initializeFirestore() { return { stub: true }; }
export function getAuth() { return { stub: true }; }
export class GoogleAuthProvider { setCustomParameters() {} }

export function onAuthStateChanged(_auth, cb) {
  setTimeout(() => cb({ uid: 'u1', email: 'chefe@teste.br', displayName: 'Chefe Teste', photoURL: '' }), 10);
  return () => {};
}
export function signInWithPopup() { return Promise.resolve({}); }
export function signOut() { return Promise.resolve(); }

export function collection(_db, ...segs) { return { tipo: 'col', caminho: segs.join('/') }; }
export function doc(_db, ...segs) {
  const caminho = segs.join('/');
  const p = caminho.split('/');
  return { tipo: 'doc', colecao: p.slice(0, -1).join('/'), id: p[p.length - 1] };
}
export function query(col, ...clausulas) { return { tipo: 'query', col, clausulas }; }
export function where(campo, op, valor) { return { campo, op, valor }; }
export function orderBy() { return {}; }
export function limit() { return {}; }
export function serverTimestamp() { return new Date().toISOString(); }
export function onSnapshot() { return () => {}; }

export function getDoc(ref) {
  const dados = colecaoDe(ref.colecao).get(ref.id);
  return Promise.resolve({
    exists: () => dados !== undefined,
    id: ref.id,
    data: () => dados,
  });
}

export function getDocs(alvo) {
  const col = alvo.tipo === 'query' ? alvo.col : alvo;
  let itens = [...colecaoDe(col.caminho).entries()];
  if (alvo.tipo === 'query') {
    for (const c of alvo.clausulas) {
      if (c.campo) itens = itens.filter(([, d]) => d[c.campo] === c.valor);
    }
  }
  return Promise.resolve({ docs: itens.map(([id, d]) => ({ id, data: () => d })) });
}

export function setDoc(ref, dados, opcoes = {}) {
  const col = colecaoDe(ref.colecao);
  col.set(ref.id, opcoes.merge ? { ...(col.get(ref.id) || {}), ...dados } : dados);
  return Promise.resolve();
}

export function addDoc(col, dados) {
  const id = `x${proximoId += 1}`;
  colecaoDe(col.caminho).set(id, dados);
  return Promise.resolve({ id });
}

export function updateDoc(ref, dados) {
  const col = colecaoDe(ref.colecao);
  col.set(ref.id, { ...(col.get(ref.id) || {}), ...dados });
  return Promise.resolve();
}

export function deleteDoc(ref) {
  colecaoDe(ref.colecao).delete(ref.id);
  return Promise.resolve();
}
