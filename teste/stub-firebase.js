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
  colecaoDe('gabinetes').set('g1', {
    nome: 'Gabinete de Teste', deputado: 'Deputada Teste', uf: 'RS', idDeputadoCamara: 999,
    whatsappParlamentar: '54999990000',
  });
  colecaoDe('autorizados').set('chefe@teste.br', {
    nome: 'Chefe Teste',
    papel: globalThis.__PAPEL_TESTE || 'chefe',
    gabineteId: 'g1',
    areas: globalThis.__AREAS_TESTE || [],
    ativo: true,
  });
}
if (!globalThis.__BANCO_VAZIO_TESTE) {
colecaoDe('gabinetes/g1/equipe').set('e1', { nome: 'Ana Assessora', cargo: 'Secretária parlamentar', funcao: 'legislativo', lotacao: 'brasilia', situacao: 'ativo', telefone: '54988880000' });
colecaoDe('gabinetes/g1/tarefas').set('t1', {
  titulo: 'Preparar parecer da comissão', area: 'legislativo', responsavel: 'e1',
  prazo: '2020-01-01', prioridade: 'alta', status: 'aberta',
});
colecaoDe('gabinetes/g1/emendas').set('em1', {
  codigo: '202612340000', ano: 2026, tipo: 'individual', beneficiario: 'Prefeitura de Erechim', municipio: 'Erechim',
  uf: 'RS', areaDestino: 'saude', valorIndicado: 500000, valorEmpenhado: 300000,
  valorPago: 100000, fase: 'execucao',
});
// O que nenhuma base pública entrega: quem governa a cidade e como foi a
// votação ali. É o que separa uma ficha de apresentação de um extrato.
colecaoDe('gabinetes/g1/municipios').set('erechim-rs', {
  nome: 'Erechim', uf: 'RS',
  prefeito: 'Paulo Prefeito', partidoPrefeito: 'NOVO', vicePrefeito: 'Vera Vice',
  presidenteCamara: 'Carlos Presidente',
  vereadores: ['Ana Vereadora', 'Bruno Vereador'],
  votosParlamentar: 5000, votosValidos: 13000, colocacao: 2, anoEleicao: 2022,
  atividades: 'agroindústria e metalmecânica', rendaMedia: 2100, pibPerCapita: 45000,
  resumo: 'A prefeitura pede a pavimentação do acesso ao distrito industrial.',
});
// Situação propositalmente desatualizada e autoria "suja": a consulta
// automática ao abrir a lista precisa corrigir as duas.
colecaoDe('gabinetes/g1/valores').set('v1', {
  tema: 'Segurança pública', posicao: 'favoravel', inegociavel: true,
  diretriz: 'O mandato defende o direito do cidadão de bem à legítima defesa.',
  fundamentacao: 'O monopólio estatal da força não alcança a zona rural.',
});
colecaoDe('gabinetes/g1/producao').set('pr1', {
  titulo: 'Porte rural', tipo: 'pl', tema: 'Segurança pública', status: 'rascunho',
  teor: 'Assegurar porte de arma de fogo ao produtor rural em sua propriedade.',
});
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

// Registro das consultas feitas, para o teste conferir que a segunda sessão
// pede só o que mudou em vez de reler a coleção inteira.
globalThis.__CONSULTAS = [];

export function getDocs(alvo) {
  const col = alvo.tipo === 'query' ? alvo.col : alvo;
  globalThis.__CONSULTAS.push({
    caminho: col.caminho,
    operadores: (alvo.clausulas || []).map((c) => c.op).filter(Boolean),
  });
  let itens = [...colecaoDe(col.caminho).entries()];
  if (alvo.tipo === 'query') {
    for (const c of alvo.clausulas) {
      if (!c.campo) continue;
      itens = itens.filter(([, d]) => {
        const v = d[c.campo];
        // A leitura incremental usa faixa; documento sem o campo fica de fora,
        // como no Firestore de verdade.
        if (c.op === '>') return v !== undefined && v !== null && v > c.valor;
        if (c.op === '>=') return v !== undefined && v !== null && v >= c.valor;
        return v === c.valor;
      });
    }
  }
  return Promise.resolve({ docs: itens.map(([id, d]) => ({ id, data: () => d })) });
}

// Os carimbos do duplo são texto ISO, que compara na mesma ordem do relógio.
export const Timestamp = {
  fromMillis: (ms) => new Date(ms).toISOString(),
};

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

/**
 * Duplo das Cloud Functions. A resposta de cada função vem de
 * __FUNCOES_TESTE, para que o teste possa devolver dados, erro ou silêncio.
 */
export function getFunctions() { return { stub: true }; }

export function httpsCallable(_funcoes, nome) {
  return async (dados) => {
    const respostas = globalThis.__FUNCOES_TESTE || {};
    const resposta = respostas[nome];
    if (!resposta) {
      const erro = new Error('not found');
      erro.code = 'functions/not-found';
      throw erro;
    }
    const r = typeof resposta === 'function' ? resposta(dados) : resposta;
    if (r && r.__erro) {
      const erro = new Error(r.mensagem || 'falhou');
      erro.code = r.__erro;
      throw erro;
    }
    return { data: r };
  };
}

export function writeBatch() {
  const pendentes = [];
  return {
    set(ref, dados, opcoes = {}) {
      pendentes.push({ ref, dados, opcoes });
      return this;
    },
    commit() {
      if (globalThis.__LOTE_RECUSADO_TESTE) {
        // Como o SDK de verdade recusa: mensagem opaca e o motivo só no `code`.
        const erro = new Error('Missing or insufficient permissions.');
        erro.code = 'permission-denied';
        return Promise.reject(erro);
      }
      for (const { ref, dados, opcoes } of pendentes) {
        const col = colecaoDe(ref.colecao);
        col.set(ref.id, opcoes.merge ? { ...(col.get(ref.id) || {}), ...dados } : dados);
      }
      return Promise.resolve();
    },
  };
}

export function deleteDoc(ref) {
  colecaoDe(ref.colecao).delete(ref.id);
  return Promise.resolve();
}
