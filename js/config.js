// Configuração do Firebase.
// Estes valores são públicos por natureza — a proteção real está em firestore.rules.
// Copie os dados do seu projeto em: console.firebase.google.com > Configurações do projeto > Seus apps.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBcWLIh4ZpEbOkfPuopslSxKgt6pRSVSVk',
  authDomain: 'appgabinete-556df.firebaseapp.com',
  projectId: 'appgabinete-556df',
  storageBucket: 'appgabinete-556df.firebasestorage.app',
  messagingSenderId: '696764910156',
  appId: '1:696764910156:web:3753c350aeb82a3b6442e9',
};

export const CONFIGURADO = !FIREBASE_CONFIG.apiKey.startsWith('COLE_AQUI');

/**
 * ID do banco no Firestore.
 *
 * Um projeto pode ter vários bancos, e o SDK só encontra aquele cujo ID for
 * informado aqui. Deixe '(default)' se o seu tiver o nome padrão; se tiver
 * outro nome, escreva-o exatamente como aparece no console — banco errado dá
 * erro de "cliente offline", que parece problema de rede e não é.
 *
 * As regras de segurança pertencem a cada banco: publique-as no que estiver
 * apontado aqui.
 */
export const FIRESTORE_DATABASE_ID = 'appgab';

/**
 * Região das Cloud Functions. Precisa ser a mesma declarada em
 * functions/index.js — divergência aqui vira erro de "função não encontrada",
 * que parece falta de implantação e não é.
 */
export const REGIAO_FUNCOES = 'southamerica-east1';

/**
 * A consulta automática às bases de execução orçamentária depende de uma função
 * no servidor, porque a chave do Portal da Transparência não pode ficar em
 * código público e nenhuma dessas bases aceita chamada vinda do navegador.
 *
 * Com isto ligado, o botão "Ler bilhete" aparece em Administrativo › Viagens.
 * Se a função ainda não estiver implantada, o clique devolve um recado dizendo
 * exatamente isso — que é informação útil, e melhor do que um botão ausente sem
 * explicação. A importação por planilha continua ao lado, funcionando.
 *
 * Desligue apenas se for usar o sistema sem as Cloud Functions.
 */
export const CONSULTA_AUTOMATICA = true;

export const AREAS = [
  { id: 'chefia', sigla: 'CHF', nome: 'Chefia de gabinete', descricao: 'Painel, tarefas e agenda do deputado' },
  { id: 'administrativo', sigla: 'ADM', nome: 'Administrativo', descricao: 'Equipe, viagens, ofícios, cota e atendimento' },
  { id: 'legislativo', sigla: 'LEG', nome: 'Legislativo', descricao: 'Proposições, produção, pauta e posicionamentos' },
  { id: 'orcamento', sigla: 'ORC', nome: 'Orçamento', descricao: 'Emendas parlamentares, destinação por destinação' },
  { id: 'comunicacao', sigla: 'COM', nome: 'Comunicação', descricao: 'Editorial, clipping, imprensa e mídia' },
];

export const PAPEIS = {
  deputado: { nome: 'Deputado', descricao: 'Acesso total a todas as áreas' },
  chefe: { nome: 'Chefe de gabinete', descricao: 'Acesso total, incluindo a agenda do deputado' },
  assessor: { nome: 'Assessor', descricao: 'Edita apenas as áreas atribuídas', pedeAreas: true },
  escritorio: { nome: 'Escritório no estado', descricao: 'Edita o administrativo e o orçamento' },
  leitor: { nome: 'Somente leitura', descricao: 'Visualiza tudo, não altera nada' },
  admin: { nome: 'Administrador do sistema', descricao: 'Gerencia acessos e gabinetes' },
};

// Áreas que o escritório no estado edita: é quem fala com prefeituras e com o cidadão.
export const AREAS_ESCRITORIO = ['administrativo', 'orcamento'];

/** A agenda do deputado é a única exceção à regra geral: só chefia e deputado escrevem. */
export function podeEditarAgenda(membro) {
  return !!membro && (membro.papel === 'chefe' || membro.papel === 'deputado');
}

export function podeEditar(membro, areaId) {
  if (!membro || !membro.ativo) return false;
  if (membro.papel === 'deputado' || membro.papel === 'chefe') return true;
  if (membro.papel === 'assessor') return (membro.areas || []).includes(areaId);
  if (membro.papel === 'escritorio') return AREAS_ESCRITORIO.includes(areaId);
  return false;
}

/** Todos os membros ativos leem tudo dentro do próprio gabinete. */
export function podeLer(membro) {
  return !!membro && membro.ativo !== false;
}

/**
 * Tarefas são a exceção aberta: delegação atravessa áreas, então quem recebe
 * uma tarefa precisa conseguir respondê-la mesmo sendo de outro setor. Só quem
 * é somente leitura fica de fora.
 */
export function podeEditarTarefas(membro) {
  return podeLer(membro) && ['deputado', 'chefe', 'assessor', 'escritorio'].includes(membro.papel);
}

export function ehAdmin(membro) {
  return !!membro && membro.papel === 'admin';
}
