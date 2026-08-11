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

export const AREAS = [
  { id: 'chefia', sigla: 'CHF', nome: 'Chefia de gabinete', descricao: 'Painel, tarefas e agenda do deputado' },
  { id: 'administrativo', sigla: 'ADM', nome: 'Administrativo', descricao: 'Equipe, viagens, ofícios, cota e atendimento' },
  { id: 'legislativo', sigla: 'LEG', nome: 'Legislativo', descricao: 'Proposições, produção, pauta e posicionamentos' },
  { id: 'comunicacao', sigla: 'COM', nome: 'Comunicação', descricao: 'Editorial, clipping, imprensa e mídia' },
  { id: 'orcamento', sigla: 'ORC', nome: 'Orçamento', descricao: 'Emendas parlamentares e sua execução' },
];

export const PAPEIS = {
  deputado: { nome: 'Deputado', descricao: 'Acesso total a todas as áreas' },
  chefe: { nome: 'Chefe de gabinete', descricao: 'Acesso total, incluindo a agenda do deputado' },
  assessor: { nome: 'Assessor', descricao: 'Edita apenas as áreas atribuídas', pedeAreas: true },
  escritorio: { nome: 'Escritório no estado', descricao: 'Edita atendimento, CRM e emendas' },
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
