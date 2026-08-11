/**
 * Cópia local dos dados, no navegador.
 *
 * Sem ela, abrir o sistema relê do servidor tudo que existe — e a produção de
 * um mandato são milhares de registros que quase nunca mudam. Com ela, a
 * primeira sessão baixa tudo e as seguintes buscam apenas o que foi alterado
 * desde a última vez.
 *
 * As chaves levam o gabinete na frente, de modo que a cópia de um gabinete
 * nunca é lida por outro no mesmo navegador. Se o IndexedDB não estiver
 * disponível — navegação anônima, navegador antigo, política do órgão —, tudo
 * aqui devolve nulo e o sistema volta a ler do servidor, mais lento porém
 * inteiro. Cache indisponível não pode virar tela vazia.
 */

const NOME = 'applegis';
const VERSAO = 1;
const DOCUMENTOS = 'documentos';
const SINCRONIA = 'sincronia';

let conexao = null;

function abrir() {
  if (conexao) return conexao;
  conexao = new Promise((resolver) => {
    if (typeof indexedDB === 'undefined') return resolver(null);
    let pedido;
    try {
      pedido = indexedDB.open(NOME, VERSAO);
    } catch {
      return resolver(null);
    }
    pedido.onupgradeneeded = () => {
      const bd = pedido.result;
      if (!bd.objectStoreNames.contains(DOCUMENTOS)) bd.createObjectStore(DOCUMENTOS);
      if (!bd.objectStoreNames.contains(SINCRONIA)) bd.createObjectStore(SINCRONIA);
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => resolver(null);
    pedido.onblocked = () => resolver(null);
    return undefined;
  });
  return conexao;
}

function transacao(bd, armazem, modo) {
  return bd.transaction(armazem, modo).objectStore(armazem);
}

function esperar(pedido) {
  return new Promise((resolver) => {
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => resolver(null);
  });
}

function concluir(armazem) {
  return new Promise((resolver) => {
    armazem.transaction.oncomplete = () => resolver(true);
    armazem.transaction.onerror = () => resolver(false);
    armazem.transaction.onabort = () => resolver(false);
  });
}

const prefixo = (gabinete, colecao) => `${gabinete}/${colecao}/`;

/** Tudo que está guardado de uma coleção, ou nulo se não há cópia local. */
export async function ler(gabinete, colecao) {
  const bd = await abrir();
  if (!bd) return null;
  const p = prefixo(gabinete, colecao);
  const faixa = IDBKeyRange.bound(p, `${p}￿`);
  const itens = await esperar(transacao(bd, DOCUMENTOS, 'readonly').getAll(faixa));
  return itens || null;
}

/** Grava os registros recebidos e apaga os que saíram. */
export async function guardar(gabinete, colecao, itens, removidos = []) {
  const bd = await abrir();
  if (!bd) return;
  const p = prefixo(gabinete, colecao);
  const armazem = transacao(bd, DOCUMENTOS, 'readwrite');
  for (const item of itens) armazem.put(item, `${p}${item.id}`);
  for (const id of removidos) armazem.delete(`${p}${id}`);
  await concluir(armazem);
}

/** Até quando a cópia local está em dia, em milissegundos. */
export async function marco(gabinete, colecao) {
  const bd = await abrir();
  if (!bd) return null;
  return esperar(transacao(bd, SINCRONIA, 'readonly').get(prefixo(gabinete, colecao)));
}

export async function anotarMarco(gabinete, colecao, milissegundos) {
  const bd = await abrir();
  if (!bd) return;
  await esperar(
    transacao(bd, SINCRONIA, 'readwrite').put(milissegundos, prefixo(gabinete, colecao)),
  );
}

/**
 * Apaga a cópia local inteira. Chamado ao sair: num computador compartilhado,
 * o que ficou guardado no navegador continuaria legível depois da saída.
 */
export async function limpar() {
  const bd = await abrir();
  if (!bd) return;
  await Promise.all([
    esperar(transacao(bd, DOCUMENTOS, 'readwrite').clear()),
    esperar(transacao(bd, SINCRONIA, 'readwrite').clear()),
  ]);
}
