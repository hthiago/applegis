/**
 * Catálogo de módulos do sistema.
 *
 * Cada módulo é uma coleção do gabinete descrita por seus campos. As telas de
 * listagem e de formulário são geradas a partir daqui, então acrescentar um
 * campo — ou um módulo inteiro — é mexer neste arquivo, não na interface.
 *
 * Tipos de campo: texto, area, select, multi, data, datahora, numero, dinheiro,
 * email, tel, url, ref, tags, sim-nao.
 */

const SITUACAO_EQUIPE = [
  { v: 'ativo', l: 'Ativo', cor: 'ok' },
  { v: 'afastado', l: 'Afastado', cor: 'atencao' },
  { v: 'desligado', l: 'Desligado', cor: 'neutro' },
];

const PRIORIDADES = [
  { v: 'baixa', l: 'Baixa', cor: 'neutro' },
  { v: 'normal', l: 'Normal', cor: 'info' },
  { v: 'alta', l: 'Alta', cor: 'atencao' },
  { v: 'urgente', l: 'Urgente', cor: 'critico' },
];

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export const MODULOS = [
  // ─────────────────────────────── CHEFIA ───────────────────────────────
  {
    id: 'tarefas',
    area: 'chefia',
    // Delegação atravessa áreas: quem recebe a tarefa precisa conseguir
    // respondê-la, mesmo sendo de outro setor. As regras do Firestore abrem
    // esta coleção pelo mesmo motivo.
    abertaATodos: true,
    nome: 'Tarefas',
    singular: 'tarefa',
    descricao: 'Trabalho distribuído pela chefia e demandas internas do gabinete.',
    ordenar: { campo: 'prazo', dir: 'asc' },
    busca: ['titulo', 'responsavel'],
    campos: [
      { k: 'titulo', l: 'Tarefa', t: 'texto', req: true, lista: true },
      { k: 'area', l: 'Área', t: 'select', lista: true, op: [
        { v: 'chefia', l: 'Chefia' }, { v: 'administrativo', l: 'Administrativo' },
        { v: 'legislativo', l: 'Legislativo' }, { v: 'comunicacao', l: 'Comunicação' },
      ] },
      { k: 'responsavel', l: 'Responsável', t: 'ref', ref: 'equipe', rotulo: 'nome', lista: true },
      { k: 'prazo', l: 'Prazo', t: 'data', lista: true },
      { k: 'prioridade', l: 'Prioridade', t: 'select', op: PRIORIDADES, padrao: 'normal', lista: true, inline: true },
      { k: 'status', l: 'Situação', t: 'select', padrao: 'aberta', lista: true, inline: true, op: [
        { v: 'aberta', l: 'Aberta', cor: 'info' },
        { v: 'andamento', l: 'Em andamento', cor: 'atencao' },
        { v: 'aguardando', l: 'Aguardando terceiros', cor: 'neutro' },
        { v: 'concluida', l: 'Concluída', cor: 'ok' },
        { v: 'cancelada', l: 'Cancelada', cor: 'neutro' },
      ] },
      { k: 'descricao', l: 'Descrição', t: 'area' },
    ],
  },
  {
    id: 'agenda',
    area: 'chefia',
    restrita: true, // só chefe de gabinete e deputado escrevem
    nome: 'Agenda do deputado',
    singular: 'compromisso',
    descricao: 'Compromissos do parlamentar. Visualização para todo o gabinete; alteração apenas pela chefia.',
    ordenar: { campo: 'inicio', dir: 'asc' },
    busca: ['titulo', 'local'],
    campos: [
      { k: 'titulo', l: 'Compromisso', t: 'texto', req: true, lista: true },
      { k: 'inicio', l: 'Início', t: 'datahora', req: true, lista: true },
      { k: 'fim', l: 'Término', t: 'datahora' },
      { k: 'tipo', l: 'Tipo', t: 'select', lista: true, op: [
        { v: 'sessao', l: 'Sessão / votação', cor: 'critico' },
        { v: 'comissao', l: 'Comissão', cor: 'info' },
        { v: 'audiencia', l: 'Audiência', cor: 'info' },
        { v: 'reuniao', l: 'Reunião', cor: 'neutro' },
        { v: 'evento', l: 'Evento externo', cor: 'atencao' },
        { v: 'imprensa', l: 'Imprensa', cor: 'atencao' },
        { v: 'pessoal', l: 'Pessoal', cor: 'neutro' },
      ] },
      { k: 'local', l: 'Local', t: 'texto', lista: true },
      { k: 'comQuem', l: 'Com quem', t: 'texto' },
      { k: 'observacoes', l: 'Observações', t: 'area' },
    ],
  },
  {
    id: 'solicitacoesAgenda',
    area: 'chefia',
    nome: 'Pedidos de agenda',
    singular: 'pedido',
    descricao: 'Solicitações de compromisso que passam pela triagem da chefia antes de virar agenda.',
    ordenar: { campo: 'dataPretendida', dir: 'asc' },
    busca: ['assunto', 'solicitante'],
    campos: [
      { k: 'solicitante', l: 'Quem pede', t: 'texto', req: true, lista: true },
      { k: 'assunto', l: 'Assunto', t: 'texto', req: true, lista: true },
      { k: 'dataPretendida', l: 'Data pretendida', t: 'data', lista: true },
      { k: 'local', l: 'Local', t: 'texto' },
      { k: 'comQuem', l: 'Participantes', t: 'texto' },
      { k: 'justificativa', l: 'Por que atender', t: 'area' },
      { k: 'status', l: 'Triagem', t: 'select', padrao: 'pendente', lista: true, inline: true, op: [
        { v: 'pendente', l: 'Pendente', cor: 'atencao' },
        { v: 'aprovado', l: 'Aprovado', cor: 'ok' },
        { v: 'recusado', l: 'Recusado', cor: 'neutro' },
      ] },
    ],
  },

  // ──────────────────────────── ADMINISTRATIVO ────────────────────────────
  {
    id: 'equipe',
    // Some da navegação, mas continua sendo a lista para que outros módulos apontem em "Responsável".
    oculto: true,
    area: 'administrativo',
    nome: 'Equipe',
    singular: 'integrante',
    descricao: 'Secretários parlamentares e assessores, com lotação e situação funcional.',
    ordenar: { campo: 'nome', dir: 'asc' },
    busca: ['nome', 'cargo', 'email'],
    campos: [
      { k: 'nome', l: 'Nome', t: 'texto', req: true, lista: true },
      { k: 'cargo', l: 'Cargo', t: 'texto', lista: true },
      { k: 'funcao', l: 'Função no gabinete', t: 'select', lista: true, op: [
        { v: 'chefia', l: 'Chefia' }, { v: 'administrativo', l: 'Administrativo' },
        { v: 'legislativo', l: 'Legislativo' }, { v: 'comunicacao', l: 'Comunicação' },
        { v: 'atendimento', l: 'Atendimento' },
      ] },
      { k: 'lotacao', l: 'Lotação', t: 'select', lista: true, op: [
        { v: 'brasilia', l: 'Brasília' }, { v: 'estado', l: 'Escritório no estado' },
      ] },
      { k: 'email', l: 'E-mail', t: 'email' },
      { k: 'telefone', l: 'Telefone', t: 'tel' },
      { k: 'admissao', l: 'Admissão', t: 'data' },
      { k: 'situacao', l: 'Situação', t: 'select', padrao: 'ativo', lista: true, op: SITUACAO_EQUIPE },
    ],
  },
  {
    id: 'ausencias',
    // Fora de uso pelo gabinete.
    oculto: true,
    area: 'administrativo',
    nome: 'Férias e ausências',
    singular: 'ausência',
    descricao: 'Períodos de afastamento da equipe, para enxergar sobreposições antes que virem problema.',
    ordenar: { campo: 'inicio', dir: 'desc' },
    busca: ['observacao'],
    campos: [
      { k: 'pessoa', l: 'Quem', t: 'ref', ref: 'equipe', rotulo: 'nome', req: true, lista: true },
      { k: 'tipo', l: 'Tipo', t: 'select', lista: true, op: [
        { v: 'ferias', l: 'Férias', cor: 'info' },
        { v: 'licenca', l: 'Licença', cor: 'atencao' },
        { v: 'falta', l: 'Falta', cor: 'neutro' },
        { v: 'viagem', l: 'Viagem a serviço', cor: 'neutro' },
      ] },
      { k: 'inicio', l: 'Início', t: 'data', req: true, lista: true },
      { k: 'fim', l: 'Término', t: 'data', lista: true },
      { k: 'observacao', l: 'Observação', t: 'area' },
    ],
  },
  {
    id: 'viagens',
    area: 'administrativo',
    nome: 'Viagens e passagens',
    singular: 'viagem',
    descricao: 'Deslocamentos da equipe e do deputado, da solicitação à prestação de contas.',
    ordenar: { campo: 'ida', dir: 'desc' },
    busca: ['viajante', 'origem', 'destino', 'motivo', 'voo', 'localizador', 'companhia'],
    leBilhete: true,
    facetas: [
      { campo: 'quando', l: 'Quando' },
      { campo: 'status', l: 'Situação' },
    ],
    campos: [
      { k: 'viajante', l: 'Quem viaja', t: 'texto', req: true, lista: true },
      { k: 'origem', l: 'Origem', t: 'texto', lista: true },
      { k: 'destino', l: 'Destino', t: 'texto', lista: true },
      { k: 'ida', l: 'Ida', t: 'data', req: true, lista: true },
      { k: 'horaPartida', l: 'Hora de partida', t: 'texto', lista: true },
      { k: 'horaChegada', l: 'Hora de chegada', t: 'texto' },
      // O que o bilhete traz e ninguém deveria redigitar.
      { k: 'companhia', l: 'Companhia', t: 'texto' },
      { k: 'voo', l: 'Voo', t: 'texto', lista: true },
      { k: 'localizador', l: 'Localizador', t: 'texto' },
      { k: 'assento', l: 'Assento', t: 'texto' },
      { k: 'volta', l: 'Volta', t: 'data' },
      { k: 'motivo', l: 'Motivo', t: 'area' },
      { k: 'custo', l: 'Custo', t: 'dinheiro', lista: true },
      { k: 'status', l: 'Situação', t: 'select', padrao: 'solicitada', lista: true, inline: true, op: [
        { v: 'solicitada', l: 'Solicitada', cor: 'atencao' },
        { v: 'aprovada', l: 'Aprovada', cor: 'info' },
        { v: 'emitida', l: 'Passagem emitida', cor: 'info' },
        { v: 'realizada', l: 'Realizada', cor: 'ok' },
        { v: 'prestada', l: 'Contas prestadas', cor: 'ok' },
        { v: 'cancelada', l: 'Cancelada', cor: 'neutro' },
      ] },
      // Calculado na leitura, não digitado: é o que permite filtrar "o que vem
      // por aí" sem ninguém ter de manter um campo em dia.
      { k: 'quando', l: 'Quando', t: 'select', lista: true, op: [
        { v: 'futura', l: 'Ainda vai acontecer', cor: 'info' },
        { v: 'hoje', l: 'Hoje', cor: 'critico' },
        { v: 'passada', l: 'Já aconteceu', cor: 'neutro' },
        { v: 'sem-data', l: 'Sem data legível', cor: 'atencao' },
      ] },
      { k: 'fonte', l: 'Origem do registro', t: 'texto' },
    ],
  },
  {
    id: 'documentos',
    // Fora de uso pelo gabinete.
    oculto: true,
    area: 'administrativo',
    nome: 'Documentos e ofícios',
    singular: 'documento',
    descricao: 'Correspondência oficial do gabinete, com numeração, prazo e controle de resposta.',
    ordenar: { campo: 'data', dir: 'desc' },
    busca: ['numero', 'contraparte', 'assunto'],
    campos: [
      { k: 'numero', l: 'Número', t: 'texto', lista: true, dica: 'Deixe em branco para numerar automaticamente.' },
      { k: 'tipo', l: 'Tipo', t: 'select', padrao: 'oficio', lista: true, op: [
        { v: 'oficio', l: 'Ofício' }, { v: 'memorando', l: 'Memorando' },
        { v: 'carta', l: 'Carta' }, { v: 'requerimento', l: 'Requerimento administrativo' },
        { v: 'outro', l: 'Outro' },
      ] },
      { k: 'direcao', l: 'Fluxo', t: 'select', padrao: 'enviado', lista: true, op: [
        { v: 'enviado', l: 'Enviado', cor: 'info' }, { v: 'recebido', l: 'Recebido', cor: 'neutro' },
      ] },
      { k: 'contraparte', l: 'Órgão ou pessoa', t: 'texto', req: true, lista: true },
      { k: 'assunto', l: 'Assunto', t: 'texto', req: true, lista: true },
      { k: 'data', l: 'Data', t: 'data', req: true, lista: true },
      { k: 'prazoResposta', l: 'Prazo de resposta', t: 'data', lista: true },
      { k: 'respondido', l: 'Respondido', t: 'sim-nao', lista: true, inline: true },
      { k: 'atendimento', l: 'Atendimento de origem', t: 'ref', ref: 'atendimentos', rotulo: 'assunto' },
      { k: 'link', l: 'Arquivo no Drive', t: 'url' },
    ],
  },
  {
    id: 'ceap',
    area: 'administrativo',
    nome: 'Cota parlamentar',
    singular: 'lançamento',
    descricao: 'Lançamentos da CEAP feitos pelo gabinete. A base da Câmara entra depois como conferência.',
    ordenar: { campo: 'data', dir: 'desc' },
    busca: ['fornecedor', 'descricao'],
    campos: [
      { k: 'data', l: 'Data', t: 'data', req: true, lista: true },
      { k: 'categoria', l: 'Categoria', t: 'select', req: true, lista: true, op: [
        { v: 'passagens', l: 'Passagens aéreas' },
        { v: 'escritorio', l: 'Manutenção de escritório' },
        { v: 'divulgacao', l: 'Divulgação da atividade parlamentar' },
        { v: 'consultoria', l: 'Consultorias e trabalhos técnicos' },
        { v: 'locomocao', l: 'Locomoção, alimentação e hospedagem' },
        { v: 'combustivel', l: 'Combustíveis e lubrificantes' },
        { v: 'veiculos', l: 'Locação de veículos' },
        { v: 'telefonia', l: 'Telefonia' },
        { v: 'postal', l: 'Serviços postais' },
        { v: 'seguranca', l: 'Segurança' },
        { v: 'material', l: 'Material de escritório e informática' },
        { v: 'curso', l: 'Cursos e eventos' },
        { v: 'outro', l: 'Outro' },
      ] },
      { k: 'fornecedor', l: 'Fornecedor', t: 'texto', lista: true },
      { k: 'descricao', l: 'Descrição', t: 'texto' },
      { k: 'valor', l: 'Valor', t: 'dinheiro', req: true, lista: true },
      { k: 'notaFiscal', l: 'Nota fiscal', t: 'texto' },
      { k: 'situacao', l: 'Situação', t: 'select', padrao: 'lancado', lista: true, inline: true, op: [
        { v: 'lancado', l: 'Lançado', cor: 'info' },
        { v: 'enviado', l: 'Enviado à Câmara', cor: 'atencao' },
        { v: 'reembolsado', l: 'Reembolsado', cor: 'ok' },
        { v: 'glosado', l: 'Glosado', cor: 'critico' },
      ] },
    ],
  },
  {
    id: 'municipios',
    area: 'administrativo',
    nome: 'Municípios',
    singular: 'município',
    descricao: 'O que o gabinete sabe de cada cidade: quem governa, quem é aliado na Câmara, a votação do parlamentar e o que move a economia. É a base da ficha de apresentação.',
    importaVotacao: true,
    ordenar: { campo: 'nome', dir: 'asc' },
    busca: ['nome', 'prefeito', 'partidoPrefeito', 'vereadores', 'atividades', 'resumo'],
    facetas: [
      { campo: 'partidoPrefeito', l: 'Partido do prefeito' },
      { campo: 'uf', l: 'UF' },
    ],
    campos: [
      { k: 'nome', l: 'Município', t: 'texto', req: true, lista: true },
      { k: 'uf', l: 'UF', t: 'select', op: UFS.map((v) => ({ v, l: v })), padrao: 'RS', lista: true },
      // Quem governa hoje. Vem preenchido à mão ou por importação, e não do
      // IBGE: o IBGE dá o retrato da cidade, não a política dela.
      { k: 'prefeito', l: 'Prefeito', t: 'texto', lista: true },
      { k: 'partidoPrefeito', l: 'Partido do prefeito', t: 'texto', lista: true },
      { k: 'vicePrefeito', l: 'Vice-prefeito', t: 'texto' },
      { k: 'presidenteCamara', l: 'Presidente da Câmara', t: 'texto' },
      // Vereadores do partido ou aliados: é com eles que o gabinete fala antes
      // de qualquer visita.
      { k: 'vereadores', l: 'Vereadores aliados', t: 'tags', lista: true },
      { k: 'anoEleicaoMunicipal', l: 'Eleição municipal de', t: 'numero' },
      // Eleito não é empossado, e quatro anos é tempo de renúncia, cassação,
      // morte e vice assumindo. Marcar aqui trava a importação do TSE: quem
      // conferiu sabe mais que o resultado da eleição.
      { k: 'governoConfirmado', l: 'Confirmado pelo gabinete', t: 'sim-nao', lista: true },
      // A votação do parlamentar naquela cidade. Sem ela a ficha não diz se
      // aquele é um reduto ou um lugar a conquistar — que muda a conversa
      // inteira.
      { k: 'votosParlamentar', l: 'Votos do parlamentar', t: 'numero', lista: true },
      { k: 'votosValidos', l: 'Votos válidos no município', t: 'numero' },
      { k: 'colocacao', l: 'Colocação do parlamentar', t: 'numero' },
      { k: 'anoEleicao', l: 'Ano da eleição', t: 'numero' },
      // O que move a cidade. Uma linha honesta vale mais que um relatório
      // genérico: é o que o parlamentar lê no carro, a caminho.
      { k: 'atividades', l: 'Principais atividades econômicas', t: 'texto' },
      { k: 'resumo', l: 'O que importa nesta cidade', t: 'area' },
      { k: 'pibPerCapita', l: 'PIB per capita', t: 'dinheiro' },
      { k: 'rendaMedia', l: 'Renda média mensal', t: 'dinheiro' },
      { k: 'populacao', l: 'População', t: 'numero' },
      { k: 'observacoes', l: 'Observações do gabinete', t: 'area', inline: true },
      // Cada importação tem sua própria origem: votação vem do TSE de um ano,
      // prefeito e vereadores de outro, e a economia do IBGE. Um campo só de
      // "fonte" faria a última importação mentir sobre as outras duas.
      { k: 'fonte', l: 'Origem da votação', t: 'texto' },
      { k: 'atualizadoNaFonte', l: 'Votação atualizada em', t: 'data' },
      { k: 'fonteGoverno', l: 'Origem de prefeito e vereadores', t: 'texto' },
      { k: 'fonteEconomia', l: 'Origem dos dados econômicos', t: 'texto' },
      { k: 'atualizadoEconomia', l: 'Economia atualizada em', t: 'data' },
    ],
  },
  {
    id: 'contatos',
    area: 'administrativo',
    nome: 'Contatos (CRM)',
    singular: 'contato',
    descricao: 'Base de relacionamento do mandato: cidadãos, lideranças, prefeituras e entidades.',
    ordenar: { campo: 'nome', dir: 'asc' },
    busca: ['nome', 'cargo', 'municipio', 'uf', 'email', 'telefone', 'temas', 'observacoes'],
    importaContatos: true,
    facetas: [
      { campo: 'categoria', l: 'Categoria' },
      { campo: 'municipio', l: 'Município' },
    ],
    campos: [
      { k: 'nome', l: 'Nome', t: 'texto', req: true, lista: true },
      { k: 'cargo', l: 'Cargo ou função', t: 'texto', lista: true },
      { k: 'categoria', l: 'Categoria', t: 'select', req: true, lista: true, op: [
        { v: 'cidadao', l: 'Cidadão', cor: 'neutro' },
        { v: 'lideranca', l: 'Liderança política', cor: 'info' },
        { v: 'prefeitura', l: 'Prefeitura', cor: 'info' },
        { v: 'vereador', l: 'Vereador', cor: 'info' },
        { v: 'entidade', l: 'Entidade / associação', cor: 'atencao' },
        { v: 'empresa', l: 'Empresa', cor: 'atencao' },
        { v: 'orgao', l: 'Órgão público', cor: 'neutro' },
      ] },
      { k: 'municipio', l: 'Município', t: 'texto', lista: true },
      { k: 'uf', l: 'UF', t: 'select', op: UFS.map((v) => ({ v, l: v })), padrao: 'RS', lista: true },
      { k: 'telefone', l: 'Telefone', t: 'tel', lista: true },
      { k: 'email', l: 'E-mail', t: 'email' },
      { k: 'temas', l: 'Temas de interesse', t: 'tags' },
      { k: 'responsavel', l: 'Responsável no gabinete', t: 'ref', ref: 'equipe', rotulo: 'nome' },
      { k: 'observacoes', l: 'Observações', t: 'area', inline: true },
      { k: 'fonte', l: 'Origem do cadastro', t: 'texto' },
      { k: 'importadoEm', l: 'Importado em', t: 'data' },
    ],
  },
  {
    id: 'interacoes',
    // Fora de uso pelo gabinete; o histórico por contato vive no CRM.
    oculto: true,
    area: 'administrativo',
    nome: 'Histórico de contato',
    singular: 'interação',
    descricao: 'Cada conversa registrada com um contato, para ninguém recomeçar do zero.',
    ordenar: { campo: 'data', dir: 'desc' },
    busca: ['resumo'],
    campos: [
      { k: 'contato', l: 'Contato', t: 'ref', ref: 'contatos', rotulo: 'nome', req: true, lista: true },
      { k: 'data', l: 'Data', t: 'data', req: true, lista: true },
      { k: 'canal', l: 'Canal', t: 'select', lista: true, op: [
        { v: 'telefone', l: 'Telefone' }, { v: 'whatsapp', l: 'WhatsApp' },
        { v: 'email', l: 'E-mail' }, { v: 'presencial', l: 'Presencial' },
        { v: 'oficio', l: 'Ofício' }, { v: 'outro', l: 'Outro' },
      ] },
      { k: 'quemAtendeu', l: 'Quem atendeu', t: 'ref', ref: 'equipe', rotulo: 'nome', lista: true },
      { k: 'resumo', l: 'Resumo', t: 'area', req: true },
    ],
  },
  {
    id: 'atendimentos',
    area: 'administrativo',
    nome: 'Atendimento ao cidadão',
    singular: 'atendimento',
    descricao: 'Demandas que chegam ao mandato, do protocolo à resposta final.',
    ordenar: { campo: 'aberturaEm', dir: 'desc' },
    busca: ['protocolo', 'assunto'],
    campos: [
      { k: 'protocolo', l: 'Protocolo', t: 'texto', lista: true, dica: 'Deixe em branco para numerar automaticamente.' },
      { k: 'solicitante', l: 'Solicitante', t: 'ref', ref: 'contatos', rotulo: 'nome', req: true, lista: true },
      { k: 'assunto', l: 'Assunto', t: 'texto', req: true, lista: true },
      { k: 'categoria', l: 'Categoria', t: 'select', lista: true, op: [
        { v: 'saude', l: 'Saúde' }, { v: 'educacao', l: 'Educação' },
        { v: 'infraestrutura', l: 'Infraestrutura' }, { v: 'seguranca', l: 'Segurança' },
        { v: 'emprego', l: 'Emprego' }, { v: 'beneficio', l: 'Benefício social' },
        { v: 'emenda', l: 'Pedido de emenda' }, { v: 'documento', l: 'Documento / certidão' },
        { v: 'outro', l: 'Outro' },
      ] },
      { k: 'aberturaEm', l: 'Aberto em', t: 'data', req: true, lista: true },
      { k: 'responsavel', l: 'Responsável', t: 'ref', ref: 'equipe', rotulo: 'nome', lista: true },
      { k: 'descricao', l: 'O que foi pedido', t: 'area', req: true },
      { k: 'encaminhamento', l: 'Encaminhamento dado', t: 'area' },
      { k: 'status', l: 'Situação', t: 'select', padrao: 'aberto', lista: true, inline: true, op: [
        { v: 'aberto', l: 'Aberto', cor: 'atencao' },
        { v: 'andamento', l: 'Em andamento', cor: 'info' },
        { v: 'aguardando', l: 'Aguardando órgão', cor: 'neutro' },
        { v: 'resolvido', l: 'Resolvido', cor: 'ok' },
        { v: 'inviavel', l: 'Sem solução possível', cor: 'neutro' },
      ] },
      { k: 'resposta', l: 'Resposta ao solicitante', t: 'area' },
    ],
  },

  // ───────────────────────────── LEGISLATIVO ─────────────────────────────
  {
    id: 'proposicoes',
    area: 'legislativo',
    nome: 'Proposições acompanhadas',
    singular: 'proposição',
    descricao: 'Lista de vigilância do gabinete. A situação vem da base de dados abertos da Câmara.',
    ordenar: { campo: 'atualizadoEm', dir: 'desc' },
    busca: ['identificacao', 'ementa', 'autor'],
    importaCamara: true,
    campos: [
      { k: 'identificacao', l: 'Proposição', t: 'texto', req: true, lista: true, dica: 'Ex.: PL 1234/2025' },
      { k: 'idCamara', l: 'ID na Câmara', t: 'numero', dica: 'Preenchido pela busca automática.' },
      { k: 'ementa', l: 'Ementa', t: 'area', lista: true },
      { k: 'autor', l: 'Autor', t: 'texto', lista: true },
      { k: 'coautores', l: 'Coautores e subscritores', t: 'numero' },
      { k: 'autoresTodos', l: 'Lista completa de assinaturas', t: 'area' },
      { k: 'situacao', l: 'Situação', t: 'texto', lista: true, subLinha: { campo: 'situacaoEm', prefixo: 'desde ' } },
      { k: 'tramitacao', l: 'Tramitação', t: 'trilha', lista: true },
      { k: 'situacaoEm', l: 'Nessa situação desde', t: 'data' },
      { k: 'despacho', l: 'Despacho', t: 'area' },
      { k: 'orgao', l: 'Onde está', t: 'texto' },
      { k: 'tramitacaoCompleta', l: 'Tramitação completa, incluindo a Mesa', t: 'trilha' },
      { k: 'mudouEm', l: 'Mudou em', t: 'data' },
      { k: 'situacaoAnterior', l: 'Situação anterior', t: 'texto' },
      { k: 'sincronizadoEm', l: 'Última consulta à Câmara', t: 'texto' },
      { k: 'prioridade', l: 'Prioridade', t: 'select', padrao: 'normal', lista: true, inline: true, op: PRIORIDADES },
      { k: 'temas', l: 'Temas', t: 'tags' },
      { k: 'notaInterna', l: 'Nota do gabinete', t: 'area', lista: true, inline: true },
    ],
  },
  {
    id: 'autorias',
    area: 'legislativo',
    nome: 'Produção do gabinete',
    singular: 'proposição',
    descricao: 'Tudo que o parlamentar assinou, separado entre o que apresentou e o que subscreveu.',
    // A data de apresentação só existe para o que foi detalhado; o ano vem da
    // própria lista e serve para todo mundo.
    ordenar: { campo: 'ano', dir: 'desc' },
    busca: ['identificacao', 'ementa', 'tema'],
    importaProducao: true,
    // A ponte para a lista de vigilância: a produção é o arquivo de tudo, e
    // acompanhar de perto é escolher um punhado dali.
    enviaParaAcompanhamento: true,
    // O conteúdo vem da Câmara; cadastrar à mão aqui só criaria divergência.
    semCriacao: true,
    // Subabas sobre a mesma coleção: o papel não é uma coluna, é a divisão.
    // "A classificar" existe porque a lista é gravada antes de saber o papel —
    // é melhor a proposição aparecer sem classificação do que não aparecer.
    segmentos: {
      campo: 'papel',
      op: [
        { v: 'autor', l: 'Autoria' },
        { v: 'subscritor', l: 'Subscrição' },
        { v: 'pendente', l: 'A classificar' },
      ],
    },
    // Os três cortes que a própria base oferece de graça. O padrão do tipo são
    // as proposições legislativas propriamente ditas: numa produção de mandato,
    // requerimentos e emendas de comissão são a maioria esmagadora e afogam o
    // que o gabinete de fato acompanha. Ficam a um clique de distância.
    facetas: [
      { campo: 'tipo', l: 'Tipo', padrao: ['PL', 'PEC', 'PLP', 'PDL', 'PDC'] },
      { campo: 'temas', l: 'Tema', normalizar: 'tema', alternativo: 'tema', ateChips: 0 },
      { campo: 'ano', l: 'Ano', ordem: 'valor-desc' },
    ],
    // O tema gravado pode vir como lista ou, nos registros antigos, como um
    // texto com vários temas juntos. O tratamento resolve os dois.
    agruparPor: { campo: 'temas', alternativo: 'tema', normalizar: 'tema' },
    campos: [
      { k: 'identificacao', l: 'Proposição', t: 'texto', req: true, lista: true },
      { k: 'ementa', l: 'Ementa', t: 'area', lista: true },
      { k: 'apresentadaEm', l: 'Apresentada em', t: 'data', lista: true },
      { k: 'situacao', l: 'Situação', t: 'texto', lista: true, subLinha: { campo: 'situacaoEm', prefixo: 'desde ' } },
      { k: 'tramitacao', l: 'Tramitação', t: 'trilha', lista: true },
      { k: 'notaInterna', l: 'Nota do gabinete', t: 'area', lista: true, inline: true },
      { k: 'papel', l: 'Papel do parlamentar', t: 'select', op: [
        { v: 'autor', l: 'Autor', cor: 'ok' },
        { v: 'subscritor', l: 'Subscritor', cor: 'neutro' },
        { v: 'pendente', l: 'A classificar', cor: 'alerta' },
      ] },
      { k: 'tema', l: 'Tema principal', t: 'texto' },
      { k: 'temas', l: 'Temas na Câmara', t: 'tags' },
      { k: 'tipo', l: 'Tipo', t: 'texto' },
      { k: 'ano', l: 'Ano', t: 'numero' },
      { k: 'situacaoEm', l: 'Nessa situação desde', t: 'data' },
      { k: 'coautores', l: 'Coautores e subscritores', t: 'numero' },
      { k: 'autoresTodos', l: 'Lista completa de assinaturas', t: 'area' },
      { k: 'idCamara', l: 'ID na Câmara', t: 'numero' },
      { k: 'detalhadoEm', l: 'Detalhada em', t: 'data' },
      { k: 'acompanhando', l: 'Em acompanhamento', t: 'sim-nao' },
    ],
  },
  {
    id: 'valores',
    area: 'legislativo',
    nome: 'Valores e diretrizes',
    singular: 'diretriz',
    descricao: 'A base doutrinária do mandato, por tema. É daqui que saem os posicionamentos de pauta e o tom das minutas.',
    ordenar: { campo: 'tema', dir: 'asc' },
    busca: ['tema', 'diretriz'],
    campos: [
      { k: 'tema', l: 'Tema', t: 'texto', req: true, lista: true },
      { k: 'posicao', l: 'Posição', t: 'select', req: true, lista: true, inline: true, op: [
        { v: 'favoravel', l: 'Favorável', cor: 'ok' },
        { v: 'contrario', l: 'Contrário', cor: 'critico' },
        { v: 'ressalvas', l: 'Favorável com ressalvas', cor: 'atencao' },
        { v: 'casoacaso', l: 'Avaliar caso a caso', cor: 'neutro' },
      ] },
      { k: 'diretriz', l: 'Diretriz', t: 'area', req: true, lista: true,
        dica: 'Em uma ou duas frases, o que o mandato defende neste tema.' },
      { k: 'fundamentacao', l: 'Fundamentação', t: 'area',
        dica: 'Os argumentos que sustentam a diretriz — é o que a IA e a equipe usam para escrever.' },
      { k: 'inegociavel', l: 'Ponto inegociável', t: 'sim-nao', lista: true, inline: true },
      { k: 'observacoes', l: 'Observações', t: 'area' },
    ],
  },
  {
    id: 'producao',
    area: 'legislativo',
    nome: 'Elaborar proposta',
    singular: 'peça',
    descricao: 'Da ideia à minuta: o teor que você descreve vira um documento pré-formatado segundo a técnica legislativa.',
    geraMinuta: true,
    ordenar: { campo: 'atualizadoEm', dir: 'desc' },
    busca: ['titulo', 'tema'],
    campos: [
      { k: 'titulo', l: 'Título', t: 'texto', req: true, lista: true },
      { k: 'tipo', l: 'Tipo', t: 'select', req: true, lista: true, op: [
        { v: 'pl', l: 'Projeto de lei' }, { v: 'pec', l: 'PEC' },
        { v: 'pdl', l: 'Decreto legislativo' }, { v: 'requerimento', l: 'Requerimento' },
        { v: 'emenda', l: 'Emenda' }, { v: 'parecer', l: 'Parecer / relatoria' },
        { v: 'discurso', l: 'Discurso' }, { v: 'questao', l: 'Questão de ordem' },
        { v: 'nota', l: 'Nota técnica' },
      ] },
      { k: 'tema', l: 'Tema', t: 'texto', lista: true },
      { k: 'autorInterno', l: 'Quem redigiu', t: 'ref', ref: 'equipe', rotulo: 'nome', lista: true },
      { k: 'status', l: 'Etapa', t: 'select', padrao: 'rascunho', lista: true, inline: true, op: [
        { v: 'rascunho', l: 'Rascunho', cor: 'neutro' },
        { v: 'revisao', l: 'Em revisão', cor: 'info' },
        { v: 'aval', l: 'Aguardando aval', cor: 'atencao' },
        { v: 'protocolado', l: 'Protocolado', cor: 'ok' },
        { v: 'arquivado', l: 'Arquivado', cor: 'neutro' },
      ] },
      { k: 'teor', l: 'Teor da proposta', t: 'area', req: true,
        dica: 'Descreva o que a proposta deve fazer, em linguagem comum. É este texto que alimenta a geração da minuta.' },
      { k: 'minuta', l: 'Minuta', t: 'area',
        dica: 'O documento formatado. Use o botão Gerar minuta para montá-lo.' },
      { k: 'protocoladoEm', l: 'Protocolado em', t: 'data' },
      { k: 'numeroProtocolo', l: 'Número após protocolo', t: 'texto' },
      { k: 'link', l: 'Arquivo no Drive', t: 'url' },
      { k: 'observacoes', l: 'Observações', t: 'area' },
    ],
  },
  {
    id: 'pauta',
    area: 'legislativo',
    nome: 'Pauta e posicionamento',
    singular: 'item de pauta',
    descricao: 'Itens de Plenário e comissões com a orientação preparada antes da sessão.',
    ordenar: { campo: 'data', dir: 'asc' },
    busca: ['item', 'orgao'],
    importaPauta: true,
    campos: [
      { k: 'data', l: 'Data', t: 'data', req: true, lista: true },
      { k: 'orgao', l: 'Órgão', t: 'texto', req: true, lista: true, dica: 'Plenário ou a sigla da comissão.' },
      { k: 'item', l: 'Matéria', t: 'texto', req: true, lista: true },
      { k: 'relator', l: 'Relator', t: 'texto' },
      { k: 'idEventoCamara', l: 'ID do evento na Câmara', t: 'numero' },
      { k: 'posicionamento', l: 'Orientação', t: 'select', lista: true, inline: true, op: [
        { v: 'favor', l: 'A favor', cor: 'ok' },
        { v: 'contra', l: 'Contra', cor: 'critico' },
        { v: 'abstencao', l: 'Abstenção', cor: 'neutro' },
        { v: 'obstrucao', l: 'Obstrução', cor: 'atencao' },
        { v: 'definir', l: 'A definir', cor: 'atencao' },
      ] },
      { k: 'justificativa', l: 'Justificativa', t: 'area' },
      { k: 'preparadoPor', l: 'Preparado por', t: 'ref', ref: 'equipe', rotulo: 'nome' },
    ],
  },
  {
    id: 'votacoes',
    area: 'legislativo',
    nome: 'Histórico por tema',
    singular: 'votação',
    descricao: 'Como o parlamentar votou no mérito de cada matéria. Só votação nominal registra nome: o voto simbólico, que é a maior parte, não aparece aqui nem na fonte.',
    ordenar: { campo: 'data', dir: 'desc' },
    busca: ['proposicao', 'descricao', 'resumo', 'tema'],
    importaVotacoes: true,
    semCriacao: true,
    // Cinco recortes, e o primeiro é o que dá sentido ao resto: uma lista de
    // "Sim" e "Não" sem a natureza da votação descreve o mandato ao contrário.
    facetas: [
      { campo: 'natureza', l: 'Natureza' },
      { campo: 'sentido', l: 'Efeito' },
      { campo: 'etiquetas', l: 'Etiqueta', multivalor: true, ateChips: 14 },
      { campo: 'temas', l: 'Tema', normalizar: 'tema', alternativo: 'tema', ateChips: 0 },
      { campo: 'ano', l: 'Ano', ordem: 'valor-desc' },
    ],
    // O tema gravado pode vir como lista ou, nos registros antigos, como um
    // texto com vários temas juntos. O tratamento resolve os dois.
    agruparPor: { campo: 'temas', alternativo: 'tema', normalizar: 'tema' },
    campos: [
      { k: 'data', l: 'Data', t: 'data', lista: true },
      { k: 'proposicao', l: 'Matéria', t: 'texto', lista: true, subLinha: { campo: 'orgao', prefixo: 'em ' } },
      { k: 'resumo', l: 'O que o voto fez', t: 'area', lista: true },
      { k: 'sentido', l: 'Efeito do voto', t: 'select', lista: true, op: [
        { v: 'a-favor', l: 'A favor da matéria', cor: 'ok' },
        { v: 'contra', l: 'Contra a matéria', cor: 'critico' },
        { v: 'avancou', l: 'Favoreceu o andamento', cor: 'info' },
        { v: 'freou', l: 'Freou o andamento', cor: 'atencao' },
        { v: 'obstruiu', l: 'Obstrução', cor: 'atencao' },
        { v: 'absteve', l: 'Absteve-se', cor: 'neutro' },
        { v: 'ausente', l: 'Não registrou voto', cor: 'neutro' },
        { v: 'depende', l: 'Depende do teor', cor: 'neutro' },
      ] },
      // Etiquetas são do gabinete, não da Câmara: é por elas que se recorta
      // "pauta do agro" ou "pacote da segurança", que vocabulário nenhum da
      // Casa reconhece. Editáveis na própria lista, senão ninguém etiqueta.
      { k: 'etiquetas', l: 'Etiquetas', t: 'tags', lista: true, inline: true },
      { k: 'notaInterna', l: 'Nota do gabinete', t: 'area', lista: true, inline: true },
      { k: 'natureza', l: 'Natureza da votação', t: 'select', op: [
        { v: 'merito', l: 'Mérito' },
        { v: 'retirada-pauta', l: 'Retirada de pauta' },
        { v: 'inversao-pauta', l: 'Inversão de pauta' },
        { v: 'adiamento', l: 'Adiamento' },
        { v: 'urgencia', l: 'Urgência' },
        { v: 'destaque', l: 'Destaque' },
        { v: 'prejudicialidade', l: 'Prejudicialidade' },
        { v: 'encerramento', l: 'Encerramento de discussão' },
        { v: 'recurso', l: 'Recurso' },
        { v: 'redacao-final', l: 'Redação final' },
        { v: 'emenda', l: 'Emenda ou substitutivo' },
        { v: 'parecer', l: 'Parecer' },
      ] },
      { k: 'voto', l: 'Voto registrado', t: 'select', op: [
        { v: 'sim', l: 'Sim', cor: 'ok' },
        { v: 'nao', l: 'Não', cor: 'critico' },
        { v: 'abstencao', l: 'Abstenção', cor: 'neutro' },
        { v: 'obstrucao', l: 'Obstrução', cor: 'atencao' },
        { v: 'ausente', l: 'Não registrou voto', cor: 'neutro' },
        { v: 'outro', l: 'Outro registro', cor: 'neutro' },
      ] },
      { k: 'descricao', l: 'Descrição da votação na Câmara', t: 'area' },
      { k: 'resultado', l: 'Resultado', t: 'select', op: [
        { v: 'aprovada', l: 'Aprovada', cor: 'ok' },
        { v: 'rejeitada', l: 'Rejeitada', cor: 'critico' },
      ] },
      { k: 'orientacaoBancada', l: 'Orientação da bancada', t: 'texto' },
      { k: 'seguiuBancada', l: 'Seguiu a bancada', t: 'sim-nao' },
      { k: 'orgao', l: 'Órgão', t: 'texto' },
      { k: 'tema', l: 'Tema principal', t: 'texto' },
      { k: 'temas', l: 'Temas na Câmara', t: 'tags' },
      { k: 'ano', l: 'Ano', t: 'numero' },
      { k: 'idVotacao', l: 'ID da votação na Câmara', t: 'texto' },
      { k: 'idProposicao', l: 'ID da proposição na Câmara', t: 'numero' },
    ],
  },
  {
    id: 'editorial',
    area: 'comunicacao',
    nome: 'Calendário editorial',
    singular: 'peça',
    descricao: 'Publicações planejadas, com canal, responsável e etapa de produção.',
    ordenar: { campo: 'dataPrevista', dir: 'asc' },
    busca: ['titulo', 'canal'],
    campos: [
      { k: 'titulo', l: 'Peça', t: 'texto', req: true, lista: true },
      { k: 'canal', l: 'Canal', t: 'select', lista: true, op: [
        { v: 'instagram', l: 'Instagram' }, { v: 'x', l: 'X' },
        { v: 'youtube', l: 'YouTube' }, { v: 'tiktok', l: 'TikTok' },
        { v: 'facebook', l: 'Facebook' }, { v: 'site', l: 'Site' },
        { v: 'whatsapp', l: 'WhatsApp' },
      ] },
      { k: 'formato', l: 'Formato', t: 'select', op: [
        { v: 'post', l: 'Post' }, { v: 'card', l: 'Card' }, { v: 'reel', l: 'Reel / vídeo curto' },
        { v: 'video', l: 'Vídeo' }, { v: 'thread', l: 'Thread' }, { v: 'story', l: 'Story' },
      ] },
      { k: 'dataPrevista', l: 'Data prevista', t: 'data', lista: true },
      { k: 'responsavel', l: 'Responsável', t: 'ref', ref: 'equipe', rotulo: 'nome', lista: true },
      { k: 'status', l: 'Etapa', t: 'select', padrao: 'ideia', lista: true, inline: true, op: [
        { v: 'ideia', l: 'Ideia', cor: 'neutro' },
        { v: 'producao', l: 'Em produção', cor: 'info' },
        { v: 'aprovacao', l: 'Aguardando aprovação', cor: 'atencao' },
        { v: 'agendado', l: 'Agendado', cor: 'info' },
        { v: 'publicado', l: 'Publicado', cor: 'ok' },
      ] },
      { k: 'linkPublicado', l: 'Link do publicado', t: 'url' },
      { k: 'observacoes', l: 'Observações', t: 'area' },
    ],
  },
  {
    id: 'clipping',
    area: 'comunicacao',
    nome: 'Clipping',
    singular: 'matéria',
    descricao: 'Menções do mandato na imprensa, com tom e tema.',
    ordenar: { campo: 'data', dir: 'desc' },
    busca: ['veiculo', 'titulo', 'tema'],
    campos: [
      { k: 'data', l: 'Data', t: 'data', req: true, lista: true },
      { k: 'veiculo', l: 'Veículo', t: 'texto', req: true, lista: true },
      { k: 'titulo', l: 'Título da matéria', t: 'texto', req: true, lista: true },
      { k: 'tom', l: 'Tom', t: 'select', lista: true, inline: true, op: [
        { v: 'positivo', l: 'Positivo', cor: 'ok' },
        { v: 'neutro', l: 'Neutro', cor: 'neutro' },
        { v: 'negativo', l: 'Negativo', cor: 'critico' },
      ] },
      { k: 'tema', l: 'Tema', t: 'texto', lista: true },
      { k: 'link', l: 'Link', t: 'url' },
      { k: 'respondido', l: 'Gabinete respondeu', t: 'sim-nao', lista: true },
      { k: 'observacoes', l: 'Observações', t: 'area' },
    ],
  },
  {
    id: 'imprensa',
    area: 'comunicacao',
    nome: 'Releases e imprensa',
    singular: 'registro',
    descricao: 'Releases produzidos e demandas de jornalistas — o prazo de fechamento é o campo que mais importa.',
    ordenar: { campo: 'prazo', dir: 'asc' },
    busca: ['assunto', 'veiculo', 'jornalista'],
    campos: [
      { k: 'tipo', l: 'Tipo', t: 'select', req: true, padrao: 'demanda', lista: true, op: [
        { v: 'demanda', l: 'Demanda de jornalista', cor: 'atencao' },
        { v: 'release', l: 'Release', cor: 'info' },
        { v: 'nota', l: 'Nota oficial', cor: 'info' },
      ] },
      { k: 'assunto', l: 'Assunto', t: 'texto', req: true, lista: true },
      { k: 'veiculo', l: 'Veículo', t: 'texto', lista: true },
      { k: 'jornalista', l: 'Jornalista', t: 'texto', lista: true },
      { k: 'prazo', l: 'Prazo de fechamento', t: 'datahora', lista: true },
      { k: 'responsavel', l: 'Responsável', t: 'ref', ref: 'equipe', rotulo: 'nome' },
      { k: 'status', l: 'Situação', t: 'select', padrao: 'pendente', lista: true, inline: true, op: [
        { v: 'pendente', l: 'Pendente', cor: 'critico' },
        { v: 'producao', l: 'Em produção', cor: 'atencao' },
        { v: 'respondido', l: 'Respondido', cor: 'ok' },
        { v: 'recusado', l: 'Recusado', cor: 'neutro' },
      ] },
      { k: 'conteudo', l: 'Conteúdo / pergunta', t: 'area' },
    ],
  },
  {
    id: 'midia',
    area: 'comunicacao',
    nome: 'Banco de mídia',
    singular: 'item',
    descricao: 'Índice de fotos, vídeos e artes. O arquivo continua no Drive; aqui fica como encontrá-lo.',
    ordenar: { campo: 'data', dir: 'desc' },
    busca: ['titulo', 'evento'],
    campos: [
      { k: 'titulo', l: 'Título', t: 'texto', req: true, lista: true },
      { k: 'tipo', l: 'Tipo', t: 'select', lista: true, op: [
        { v: 'foto', l: 'Foto' }, { v: 'video', l: 'Vídeo' },
        { v: 'arte', l: 'Arte' }, { v: 'audio', l: 'Áudio' }, { v: 'documento', l: 'Documento' },
      ] },
      { k: 'data', l: 'Data', t: 'data', lista: true },
      { k: 'evento', l: 'Evento', t: 'texto', lista: true },
      { k: 'tags', l: 'Etiquetas', t: 'tags' },
      { k: 'linkDrive', l: 'Link no Drive', t: 'url', req: true },
    ],
  },

  // ────────────────────────────── ORÇAMENTO ──────────────────────────────
  {
    id: 'destinacoes',
    area: 'orcamento',
    nome: 'Destinações',
    singular: 'destinação',
    /**
     * A unidade de trabalho do gabinete não é a emenda — é a destinação.
     *
     * Uma emenda se reparte entre várias cidades, e o que o assessor gerencia é
     * cada pedaço: esta emenda, para esta cidade, para este beneficiário, para
     * este objeto. É assim que a planilha do gabinete sempre funcionou — 764
     * linhas para 67 emendas — e foi tratar isso como detalhe de exibição, em
     * vez de como o modelo, que fez as versões anteriores desta área falharem.
     *
     * Os campos abaixo são as colunas dessa planilha, com três acréscimos que
     * não existiam em lugar nenhum: quem é o responsável na cidade, o andamento
     * datado, e qual fonte vale quando as duas divergem.
     */
    descricao: 'Uma linha por emenda, cidade e beneficiário: quanto foi, para quê, em que pé está e com quem se fala lá.',
    ordenar: { campo: 'ano', dir: 'desc' },
    busca: ['municipio', 'beneficiario', 'instituicao', 'objeto', 'numeroEmenda', 'regiao', 'andamento'],
    importaDestinacoes: true,
    agruparPor: { campo: 'municipio' },
    facetas: [
      { campo: 'situacao', l: 'Em que pé está' },
      { campo: 'area', l: 'Área' },
      { campo: 'ano', l: 'Ano' },
      { campo: 'regiao', l: 'Região' },
    ],
    campos: [
      { k: 'municipio', l: 'Município', t: 'texto', req: true, lista: true,
        subLinha: { campo: 'regiao' } },
      { k: 'ano', l: 'Ano', t: 'numero', req: true, lista: true },
      // A região é a do gabinete, não a do IBGE: 27 recortes próprios, e as
      // outras abas da planilha são organizadas por eles.
      { k: 'regiao', l: 'Região', t: 'texto' },
      { k: 'beneficiario', l: 'Beneficiário', t: 'texto', lista: true },
      { k: 'instituicao', l: 'Instituição', t: 'texto' },
      { k: 'cnpj', l: 'CNPJ', t: 'texto' },
      // Ninguém preenche endereço para relatório. Preenche para chegar lá — e
      // está em 93% das linhas da planilha do gabinete.
      { k: 'endereco', l: 'Endereço', t: 'area' },
      { k: 'objeto', l: 'Objeto', t: 'area', lista: true },
      // 19% das destinações ainda não têm número: foram indicadas e não viraram
      // emenda formal. Exigir o número deixaria um quinto do trabalho de fora.
      { k: 'numeroEmenda', l: 'Nº da emenda', t: 'texto' },
      { k: 'tipo', l: 'Tipo', t: 'select', lista: true, op: [
        { v: 'individual', l: 'Individual', cor: 'info' },
        { v: 'bancada', l: 'Bancada', cor: 'neutro' },
      ] },
      // Na planilha isto vinha grudado no tipo, entre parênteses, e com quatro
      // grafias diferentes. É um qualificador, não um tipo.
      { k: 'processoSeletivo', l: 'Processo seletivo', t: 'sim-nao' },
      { k: 'area', l: 'Área', t: 'select', lista: true, op: [
        { v: 'saude', l: 'Saúde', cor: 'info' },
        { v: 'seguranca', l: 'Segurança Pública', cor: 'atencao' },
        { v: 'infraestrutura', l: 'Infraestrutura', cor: 'neutro' },
        { v: 'turismo', l: 'Infraestrutura Turística', cor: 'neutro' },
        { v: 'educacao', l: 'Educação', cor: 'info' },
        { v: 'defesaCivil', l: 'Defesa Civil', cor: 'atencao' },
        { v: 'outra', l: 'Outra', cor: 'neutro' },
      ] },
      { k: 'areaAlocacao', l: 'Área de alocação', t: 'texto' },
      { k: 'modalidade', l: 'Modalidade', t: 'select', op: [
        { v: 'investimento', l: 'Investimento' },
        { v: 'custeio', l: 'Custeio' },
        { v: 'especial', l: 'Transferência Especial' },
        { v: 'papCusteio', l: 'PAP Custeio' },
        { v: 'papInvestimento', l: 'PAP Investimento' },
        { v: 'macCusteio', l: 'MAC Custeio' },
        { v: 'macInvestimento', l: 'MAC Investimento' },
        { v: 'misto', l: 'Misto' },
      ] },

      // ── dinheiro ──
      { k: 'valorDestinado', l: 'Destinado', t: 'dinheiro', lista: true },
      // Estes dois só entram pela planilha do governo: o gabinete não os lança
      // à mão, e inventá-los seria criar número que ninguém pode defender.
      { k: 'valorEmpenhado', l: 'Empenhado (governo)', t: 'dinheiro', lista: true },
      { k: 'valorPago', l: 'Pago (governo)', t: 'dinheiro', lista: true },

      // ── em que pé está ──
      //
      // Na planilha esta coluna fazia dois trabalhos: 54 valores distintos, dos
      // quais três respondiam por 90% e o resto era histórico escrito no lugar
      // errado. Aqui o estado é curto e o histórico tem coluna própria — que é
      // por isso que "Andamento" estava preenchida em só 11%.
      { k: 'situacao', l: 'Em que pé está', t: 'select', lista: true, padrao: 'indicado', op: [
        { v: 'indicado', l: 'Indicado', cor: 'neutro' },
        { v: 'empenhado', l: 'Empenhado', cor: 'atencao' },
        { v: 'pagoParcial', l: 'Pago em parte', cor: 'atencao' },
        { v: 'pago', l: 'Recurso pago', cor: 'ok' },
        { v: 'impedido', l: 'Impedido', cor: 'critico' },
        { v: 'perdido', l: 'Recurso perdido', cor: 'critico' },
      ] },
      { k: 'situacaoOriginal', l: 'Situação, como estava na planilha', t: 'area' },
      { k: 'andamento', l: 'Andamento', t: 'area', inline: true },

      // ── quem se procura lá ──
      //
      // A pessoa da cidade, não do gabinete. É quem o assessor liga antes de ir,
      // e não existia campo para ela em lugar nenhum.
      { k: 'responsavelNome', l: 'Responsável na cidade', t: 'texto' },
      { k: 'responsavelCargo', l: 'Cargo', t: 'texto' },
      { k: 'responsavelTelefone', l: 'Telefone', t: 'tel' },

      // ── o que o governo confirma ──
      { k: 'numeroInstrumento', l: 'Nº do instrumento', t: 'texto' },
      { k: 'linkInstrumento', l: 'Página no Transferegov', t: 'url' },
      { k: 'situacaoInstrumento', l: 'Situação do instrumento', t: 'texto' },
      { k: 'orgaoConcedente', l: 'Órgão concedente', t: 'texto' },
      { k: 'proponente', l: 'Proponente no governo', t: 'texto' },

      // ── conciliação ──
      //
      // Quando as duas fontes divergem, quem decide é gente — e a decisão fica
      // registrada com motivo e autor. Conciliar automaticamente foi o que
      // produziu, nas versões anteriores, número que ninguém sabia defender.
      // O valor do governo é do encontro (ano+emenda+município), não da linha:
      // somar por linha contaria o mesmo convênio uma vez por destinação.
      { k: 'encontroGoverno', l: 'Encontro com o painel', t: 'texto' },
      { k: 'destinacoesNoEncontro', l: 'Destinações no mesmo convênio', t: 'numero' },
      { k: 'divergente', l: 'Fontes divergem', t: 'sim-nao', lista: true },
      { k: 'fonteQueVale', l: 'Qual fonte vale', t: 'select', op: [
        { v: 'gabinete', l: 'A planilha do gabinete' },
        { v: 'governo', l: 'O painel do governo' },
      ] },
      { k: 'motivoConciliacao', l: 'Por que esta fonte vale', t: 'area' },
      { k: 'conciliadoPor', l: 'Conciliado por', t: 'texto' },
      { k: 'conciliadoEm', l: 'Conciliado em', t: 'data' },

      { k: 'observacoes', l: 'Observações', t: 'area' },
      { k: 'fonte', l: 'Origem do registro', t: 'texto' },
      { k: 'importadoEm', l: 'Importado em', t: 'data' },
    ],
  },
];

export const porId = Object.fromEntries(MODULOS.map((m) => [m.id, m]));

/**
 * Os módulos que aparecem na barra de uma área.
 *
 * `oculto` existe para tirar uma aba de circulação sem apagar a coleção: oito
 * campos de outros módulos apontam para `equipe` em "Responsável", e remover a
 * definição quebraria todos eles. A aba desaparece; o dado permanece.
 */
export function modulosDaArea(areaId) {
  return MODULOS.filter((m) => m.area === areaId && !m.oculto);
}
