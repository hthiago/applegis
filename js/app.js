import { CONFIGURADO, AREAS, PAPEIS, podeEditar, podeEditarAgenda, podeEditarTarefas, ehAdmin } from './config.js';
import { modulosDaArea, porId } from './modulos.js';
import { el, limpar, aviso, carregando, vazio, fmtDinheiro } from './ui.js';

/**
 * Montagem da aplicação.
 *
 * Só o essencial é importado de saída. O SDK do Firebase e tudo que depende
 * dele entram sob demanda, para que a tela de configuração ainda apareça num
 * projeto recém-instalado — e para que uma falha de rede vire uma mensagem
 * clara em vez de uma página em branco.
 */

const raiz = document.getElementById('app');
let nucleo = null;

// ─────────────────────────────── telas ───────────────────────────────

function cartao(titulo, paragrafos, acao = null) {
  return el('div', { class: 'tela-central' }, [
    el('div', { class: 'cartao-central' }, [
      el('h1', { texto: titulo }),
      ...paragrafos.map((t) => el('p', { texto: t })),
      acao,
    ]),
  ]);
}

function telaConfiguracao() {
  return cartao('Falta conectar o Firebase', [
    'O sistema está instalado, mas ainda não sabe a qual projeto Google se conectar.',
    'Abra o arquivo js/config.js e cole os dados do seu projeto no lugar dos campos COLE_AQUI. O passo a passo completo está no README.',
  ]);
}

/**
 * Descarta a cópia guardada pelo navegador e recomeça do zero.
 *
 * É a saída para o estado em que o service worker guardou um arquivo antigo ou
 * uma resposta de erro: a página fica quebrada de um jeito que recarregar não
 * conserta, porque o próprio recarregamento é servido do cache.
 */
async function limparCacheERecarregar() {
  try {
    const registros = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(registros.map((r) => r.unregister()));
    const chaves = await caches?.keys?.() || [];
    await Promise.all(chaves.map((k) => caches.delete(k)));
  } catch (erro) {
    console.error(erro);
  }
  location.reload();
}

/**
 * A tela de falha precisa dizer o que falhou.
 *
 * A versão anterior culpava o gstatic sempre, porque era a causa que eu tinha
 * em mente quando a escrevi. Qualquer outra — um módulo com erro, um arquivo
 * que ainda não subiu, um cache envenenado — aparecia com a mesma frase, que
 * mandava conferir a conexão de quem estava com a conexão perfeita.
 */
function telaFalhaCarregamento(erro) {
  const detalhe = erro?.message ? `O navegador disse: ${erro.message}` : null;

  return cartao('Não foi possível carregar o sistema', [
    'Um dos componentes não pôde ser carregado.',
    detalhe,
    'Se uma atualização acabou de ser publicada, espere um minuto e recarregue. Se continuar, use "Limpar e recarregar": isso descarta a cópia guardada no navegador e busca tudo de novo.',
  ].filter(Boolean), el('div', { class: 'acoes-falha' }, [
    el('button', { class: 'btn btn--primario', texto: 'Recarregar', onclick: () => location.reload() }),
    el('button', { class: 'btn btn--fantasma', texto: 'Limpar e recarregar', onclick: () => limparCacheERecarregar() }),
  ]));
}

// Uma falha de login quase sempre é uma peça de configuração faltando, não um
// problema do usuário. Dizer qual delas poupa horas de tentativa e erro.
const RECADOS_DE_LOGIN = {
  'auth/unauthorized-domain':
    'Este endereço não está liberado no Firebase. Adicione o domínio deste site em Authentication → Settings → Domínios autorizados.',
  'auth/operation-not-allowed':
    'O login com Google não está ativado no projeto. Ative em Authentication → Sign-in method → Google.',
  'auth/popup-blocked':
    'O navegador bloqueou a janela do Google. Libere os pop-ups para este site e tente de novo.',
  'auth/network-request-failed':
    'Não houve resposta da rede. Verifique a conexão e tente de novo.',
  'auth/internal-error':
    'O Firebase recusou a chamada. Confira se as chaves em js/config.js são deste projeto.',
};

function telaLogin() {
  const botao = el('button', {
    class: 'btn btn--primario btn--grande',
    texto: 'Entrar com Google',
    onclick: async () => {
      botao.disabled = true;
      try {
        await nucleo.fb.entrarComGoogle();
      } catch (erro) {
        console.error(erro);
        const cancelou = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(erro.code);
        if (!cancelou) {
          aviso(RECADOS_DE_LOGIN[erro.code] || `Não foi possível entrar (${erro.code || 'erro desconhecido'}).`, 'erro');
        }
        botao.disabled = false;
      }
    },
  });

  return el('div', { class: 'tela-central' }, [
    el('div', { class: 'cartao-central' }, [
      el('p', { class: 'marca', texto: 'Gestão de gabinete parlamentar' }),
      el('h1', { texto: 'Entre para acessar o gabinete' }),
      el('p', { texto: 'O acesso é liberado individualmente pela chefia. Use a conta Google cadastrada — funciona tanto com o e-mail institucional quanto com o pessoal.' }),
      botao,
    ]),
  ]);
}

function telaPrimeiroAcesso() {
  const s = nucleo.sessaoMod.sessao;
  const nome = el('input', { type: 'text', required: true, placeholder: 'Gabinete do Deputado Fulano' });
  const deputado = el('input', { type: 'text', placeholder: 'Nome do parlamentar' });
  const uf = el('input', { type: 'text', maxlength: '2', placeholder: 'RS' });
  const idCamara = el('input', { type: 'number', inputmode: 'numeric', placeholder: 'opcional' });

  const botao = el('button', { class: 'btn btn--primario', type: 'submit', texto: 'Criar gabinete e entrar' });

  const form = el('form', { class: 'form' }, [
    el('div', { class: 'campo' }, [el('label', { texto: 'Nome do gabinete *' }), nome]),
    el('div', { class: 'campo' }, [el('label', { texto: 'Parlamentar' }), deputado]),
    el('div', { class: 'linha-campos' }, [
      el('div', { class: 'campo' }, [el('label', { texto: 'UF' }), uf]),
      el('div', { class: 'campo' }, [
        el('label', { texto: 'ID na Câmara' }), idCamara,
        el('p', { class: 'campo-dica', texto: 'Usado depois para buscar proposições e despesas.' }),
      ]),
    ]),
    botao,
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    botao.disabled = true;
    botao.textContent = 'Criando…';
    try {
      await nucleo.sessaoMod.instalar({
        nome: nome.value.trim(),
        deputado: deputado.value.trim(),
        uf: uf.value.trim().toUpperCase(),
        idDeputadoCamara: idCamara.value ? Number(idCamara.value) : null,
      });
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível criar o gabinete. Confira se as regras de segurança foram publicadas.', 'erro');
      botao.disabled = false;
      botao.textContent = 'Criar gabinete e entrar';
    }
  });

  return el('div', { class: 'tela-central' }, [
    el('div', { class: 'cartao-central' }, [
      el('p', { class: 'marca', texto: 'Primeiro acesso' }),
      el('h1', { texto: 'Vamos criar o gabinete' }),
      el('p', { texto: `O banco está vazio, então ${s.usuario?.email || 'você'} será o chefe de gabinete e poderá liberar o acesso do resto da equipe.` }),
      el('p', { texto: 'Esta tela aparece uma única vez: assim que o gabinete for criado, ninguém mais consegue se cadastrar sozinho.' }),
      form,
    ]),
  ]);
}

/**
 * Sair apaga a cópia local antes de encerrar a sessão. Num computador
 * compartilhado do gabinete, o que ficou guardado no navegador continuaria
 * legível por quem sentasse depois.
 */
async function sair() {
  try {
    await nucleo.dados.esquecerCopiaLocal();
  } finally {
    await nucleo.fb.sair();
  }
}

function telaSemAcesso() {
  const s = nucleo.sessaoMod.sessao;
  return cartao('Sua conta ainda não tem acesso', [
    s.erro || `Entramos com ${s.usuario?.email || 'sua conta'}, mas ela não está na lista de pessoas autorizadas deste sistema.`,
    'Peça à chefia de gabinete para liberar este e-mail e entre novamente.',
  ], el('button', { class: 'btn btn--fantasma', texto: 'Sair', onclick: () => sair() }));
}

// ────────────────────────────── navegação ──────────────────────────────

function paineisDisponiveis() {
  return [
    { id: 'painel', area: 'chefia', nome: 'Painel', render: nucleo.paineis.painelChefia },
    { id: 'resumo-cota', area: 'administrativo', nome: 'Resumo da cota', render: nucleo.paineis.painelCota },
    { id: 'ficha', area: 'administrativo', nome: 'Ficha de apresentação', render: nucleo.ficha.painelFicha },
    { id: 'dashboard', area: 'orcamento', nome: 'Dashboard', render: nucleo.paineis.painelDashboard },
    { id: 'painel-emendas', area: 'orcamento', nome: 'Por município', render: nucleo.paineis.painelEmendas },
  ];
}

function abasDaArea(areaId) {
  return [
    ...paineisDisponiveis().filter((p) => p.area === areaId),
    ...modulosDaArea(areaId).map((m) => ({ id: m.id, nome: m.nome, modulo: m })),
  ];
}

/**
 * A aba pedida pelo endereço, mesmo que ela não esteja na barra.
 *
 * `oculto` tira o módulo de circulação, não do sistema: o dado continua lá, os
 * outros módulos continuam apontando para ele, e quem tem o endereço na mão
 * continua chegando. Esconder e desligar são coisas diferentes — misturá-las
 * transformaria "tire esta aba do caminho" em "perca este cadastro".
 */
function abaPorId(areaId, abaId) {
  const naBarra = abasDaArea(areaId).find((a) => a.id === abaId);
  if (naBarra) return naBarra;
  const escondido = porId[abaId];
  return escondido && escondido.area === areaId
    ? { id: escondido.id, nome: escondido.nome, modulo: escondido }
    : null;
}

function rota() {
  const partes = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  return { area: partes[0] || null, aba: partes[1] || null };
}

function areaInicial() {
  return ehAdmin(nucleo.sessaoMod.sessao.membro) ? 'acessos' : 'chefia';
}

function cabecalho() {
  const s = nucleo.sessaoMod.sessao;
  return el('header', { class: 'topo' }, [
    el('div', { class: 'topo-marca' }, [
      el('span', { class: 'topo-sigla', texto: 'GAB' }),
      el('div', {}, [
        el('strong', { texto: s.gabinete?.nome || 'Gabinete' }),
        s.gabinete?.deputado ? el('span', { class: 'topo-sub', texto: s.gabinete.deputado }) : null,
      ]),
    ]),
    el('div', { class: 'topo-direita' }, [
      el('div', { class: 'usuario-menu' }, [
        el('span', { class: 'usuario-nome', texto: s.membro.nome }),
        el('span', { class: 'usuario-papel', texto: PAPEIS[s.membro.papel]?.nome || s.membro.papel }),
      ]),
      el('button', { class: 'btn btn--fantasma btn--pequeno', texto: 'Sair', onclick: () => sair() }),
    ]),
  ]);
}

function navegacao(areaAtual) {
  const membro = nucleo.sessaoMod.sessao.membro;
  const itens = AREAS.map((a) => el('a', {
    href: `#/${a.id}`,
    class: `nav-item${areaAtual === a.id ? ' nav-item--ativo' : ''}`,
    'aria-current': areaAtual === a.id ? 'page' : null,
  }, [
    el('span', { class: 'nav-sigla', texto: a.sigla }),
    el('span', { class: 'nav-nome', texto: a.nome }),
  ]));

  if (ehAdmin(membro) || ['chefe', 'deputado'].includes(membro.papel)) {
    itens.push(el('a', {
      href: '#/acessos',
      class: `nav-item${areaAtual === 'acessos' ? ' nav-item--ativo' : ''}`,
    }, [
      el('span', { class: 'nav-sigla', texto: '••' }),
      el('span', { class: 'nav-nome', texto: 'Acessos' }),
    ]));
  }

  return el('nav', { class: 'nav', 'aria-label': 'Áreas' }, itens);
}

function subAbas(areaId, abaAtual) {
  const abas = abasDaArea(areaId);
  if (abas.length <= 1) return null;
  // Aba oculta não se acende na barra, mas não force a navegação de volta: quem
  // chegou por endereço direto continua onde pediu para estar.
  const ativa = abas.some((a) => a.id === abaAtual) || abaPorId(areaId, abaAtual)
    ? abaAtual
    : abas[0].id;
  return el('div', { class: 'abas', role: 'tablist' }, abas.map((a) => el('a', {
    href: `#/${areaId}/${a.id}`,
    class: `aba${ativa === a.id ? ' aba--ativa' : ''}`,
    role: 'tab',
    'aria-selected': ativa === a.id ? 'true' : 'false',
    texto: a.nome,
  })));
}

// ────────────────────────────── conteúdo ──────────────────────────────

function extrasDaCamara() {
  return [
    (recarregar) => el('button', {
      class: 'btn btn--fantasma',
      texto: 'Buscar na Câmara',
      onclick: () => nucleo.camara.abrirBuscaCamara(recarregar),
    }),
    (recarregar) => el('button', {
      class: 'btn btn--fantasma',
      texto: 'Atualizar situações',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = 'Atualizando…';
        try {
          const n = await nucleo.camara.sincronizarProposicoes();
          aviso(n ? `${n} proposição(ões) mudaram de situação.` : 'Nenhuma mudança desde a última consulta.');
          recarregar();
        } catch (erro) {
          console.error(erro);
          aviso('Não foi possível consultar a base da Câmara agora.', 'erro');
          btn.disabled = false;
          btn.textContent = 'Atualizar situações';
        }
      },
    }),
  ];
}

function extrasDaProducao() {
  return [
    (recarregar) => el('button', {
      class: 'btn btn--fantasma',
      texto: 'Importar da Câmara',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const idDeputado = nucleo.sessaoMod.sessao.gabinete?.idDeputadoCamara;
        if (!idDeputado) {
          aviso('Informe o ID do deputado na Câmara em Acessos → Dados do gabinete.', 'erro');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Consultando…';
        try {
          const r = await nucleo.camara.importarProducao(idDeputado, (p) => {
            if (p.fase === 'lista') btn.textContent = `Listando ${p.total}…`;
            if (p.fase === 'gravadas') btn.textContent = `${p.gravadas} salvas. Classificando…`;
            if (p.fase === 'classificando') btn.textContent = `Classificando ${p.feitas} de ${p.total}…`;
            if (p.fase === 'detalhando') btn.textContent = `Detalhando ${p.feitas} de ${p.total}…`;
          });
          // Quantas ficaram por classificar importa: é o que explica um número
          // menor na tela do que o que a Câmara devolveu.
          aviso([
            `${r.total} proposições assinadas na Câmara.`,
            r.classificadas ? `${r.classificadas} classificadas` : null,
            r.detalhadas ? `${r.detalhadas} detalhadas` : null,
            r.pendentes ? `${r.pendentes} ficaram pendentes — importe de novo para concluir` : null,
          ].filter(Boolean).join(' · '), r.pendentes ? 'erro' : 'ok');
          recarregar();
        } catch (erro) {
          console.error(erro);
          aviso(`Não foi possível importar da Câmara: ${erro.message || erro}`, 'erro');
          btn.disabled = false;
          btn.textContent = 'Importar da Câmara';
        }
      },
    }),
  ];
}

function extrasDaPauta() {
  return [
    (recarregar) => el('button', {
      class: 'btn btn--fantasma',
      texto: 'Importar pauta da semana',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const idDeputado = nucleo.sessaoMod.sessao.gabinete?.idDeputadoCamara;
        if (!idDeputado) {
          aviso('Informe o ID do deputado na Câmara em Acessos → Dados do gabinete.', 'erro');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Consultando…';
        try {
          const r = await nucleo.camara.importarPauta(idDeputado);
          aviso(r.importados
            ? `${r.importados} itens de pauta importados de ${r.eventos} sessões e reuniões.`
            : `Nada novo. As ${r.eventos} sessões da semana já estavam registradas.`);
          recarregar();
        } catch (erro) {
          console.error(erro);
          aviso('Não foi possível consultar a pauta na Câmara agora.', 'erro');
          btn.disabled = false;
          btn.textContent = 'Importar pauta da semana';
        }
      },
    }),
  ];
}

function extrasDasVotacoes() {
  return [
    (recarregar) => el('button', {
      class: 'btn btn--fantasma',
      texto: 'Importar votações',
      onclick: async (e) => {
        const btn = e.currentTarget;
        const idDeputado = nucleo.sessaoMod.sessao.gabinete?.idDeputadoCamara;
        if (!idDeputado) {
          aviso('Informe o ID do deputado na Câmara em Acessos → Dados do gabinete.', 'erro');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Consultando…';
        try {
          const r = await nucleo.camara.importarVotacoes(idDeputado, {}, (p) => {
            const feito = `${p.funil.registradas} guardadas`;
            if (p.fase === 'listando') btn.textContent = `Período ${p.posicao}/${p.janelas} · ${feito}`;
            if (p.fase === 'lendo') btn.textContent = `Lendo ${p.feitas}/${p.total} · ${feito}`;
          });

          // O funil inteiro, e não só o total. Quando o resultado é zero, o
          // número sozinho não diz se faltou listagem, se a peneira levou tudo,
          // se as votações eram simbólicas ou se o parlamentar não constava —
          // e são quatro problemas diferentes.
          aviso([
            `${r.registradas} votações de mérito guardadas.`,
            `Examinadas ${r.listadas} no período`,
            `${r.deMerito} eram de mérito nos colegiados dele`,
            r.simbolicas ? `${r.simbolicas} simbólicas, sem registro individual na fonte` : null,
            r.semVotoDele ? `${r.semVotoDele} sem voto dele registrado` : null,
            r.semOrgao ? `${r.semOrgao} vieram sem órgão identificado` : null,
          ].filter(Boolean).join(' · '), r.registradas ? 'ok' : 'erro');
          recarregar();
        } catch (erro) {
          console.error(erro);
          aviso(`Não foi possível importar as votações: ${erro.message || erro}`, 'erro');
          btn.disabled = false;
          btn.textContent = 'Importar votações';
        }
      },
    }),
  ];
}

/**
 * Promove a proposição da produção para a lista de vigilância, direto da linha.
 * Quando já está lá, o botão diz isso em vez de sumir: some seria pior, porque
 * a pergunta de quem olha é "esta já está sendo acompanhada?".
 */
function acaoAcompanhar(item, recarregar) {
  if (item.acompanhando) {
    return el('span', {
      class: 'ja-feito',
      title: 'Já está em Proposições acompanhadas',
      texto: 'acompanhando',
    });
  }

  return el('button', {
    class: 'btn-icone btn-icone--acao',
    type: 'button',
    title: 'Enviar para Proposições acompanhadas',
    'aria-label': 'Enviar para acompanhamento',
    texto: '★',
    onclick: async (e) => {
      e.stopPropagation();
      const botao = e.currentTarget;
      botao.disabled = true;
      try {
        const r = await nucleo.camara.enviarParaAcompanhamento(item);
        aviso(r.novo
          ? `${r.identificacao} entrou em Proposições acompanhadas.`
          : `${r.identificacao} já estava em acompanhamento.`);
        recarregar();
      } catch (erro) {
        console.error(erro);
        aviso(`Não foi possível enviar para acompanhamento: ${erro.message || erro}`, 'erro');
        botao.disabled = false;
      }
    },
  });
}

/**
 * Importação das emendas por planilha.
 *
 * A execução de emendas mora no Portal da Transparência, no Transferegov e no
 * Fundo Nacional de Saúde, e nenhum dos três entrega os dados a um site no
 * navegador — o Portal exige chave de API, que não pode ficar em código
 * público, e nenhum libera a chamada de outra origem. A exportação em planilha
 * traz os mesmos números, é pública e o gabinete já a baixa hoje.
 */
function extrasDasEmendas() {
  return [
    (recarregar) => {
      const escolher = el('input', {
        type: 'file',
        accept: '.csv,.txt,text/csv,text/plain',
        style: 'display:none',
      });

      const btn = el('button', {
        class: 'btn btn--fantasma',
        texto: 'Importar planilha',
        title: 'Portal da Transparência, Transferegov, SIOP ou Fundo Nacional de Saúde',
        onclick: () => escolher.click(),
      });

      escolher.addEventListener('change', async () => {
        const arquivo = escolher.files?.[0];
        if (!arquivo) return;
        btn.disabled = true;
        btn.textContent = 'Lendo…';
        try {
          const nomeAutor = nucleo.sessaoMod.sessao.gabinete?.deputado || null;
          const r = await nucleo.emendas.importarPlanilha(arquivo, { nomeAutor });

          // O funil inteiro. O passo que mais falha em silêncio é o filtro por
          // autor: o nome parlamentar nem sempre é o nome cadastrado aqui, e
          // sem esse número uma importação vazia parece um arquivo errado.
          aviso([
            `${r.novas} emendas novas, ${r.atualizadas} atualizadas.`,
            `Planilha lida como ${r.origem}, ${r.linhas} linhas`,
            r.deOutroAutor
              ? `${r.deOutroAutor} eram de outros parlamentares (filtrei por "${r.nomeUsado}")`
              : null,
            !r.temColunaAutor ? 'a planilha não traz coluna de autor, então importei tudo' : null,
            r.semChave ? `${r.semChave} linhas sem código, proposta ou convênio` : null,
            // A consolidação é o ponto: o que a planilha acrescenta e onde ela
            // discorda. Sem esses dois números, importar parece sobrescrever.
            r.colunasExtras?.length
              ? `${r.colunasExtras.length} colunas próprias da planilha guardadas (${r.colunasExtras.slice(0, 4).join(', ')}${r.colunasExtras.length > 4 ? '…' : ''})`
              : null,
            r.divergentes
              ? `${r.divergentes} divergem do Portal — mantive o Portal; filtre por "Divergente" para ver`
              : null,
          ].filter(Boolean).join(' · '), (r.novas + r.atualizadas) ? 'ok' : 'erro');
          recarregar();
        } catch (erro) {
          console.error(erro);
          aviso(`Não foi possível ler a planilha: ${erro.message || erro}`, 'erro');
        } finally {
          escolher.value = '';
          btn.disabled = false;
          btn.textContent = 'Importar planilha';
        }
      });

      return el('span', { class: 'importador' }, [btn, escolher]);
    },

    // Sondagem: descobre qual caminho das bases responde, em vez de custar uma
    // implantação por palpite. Fica junto da consulta porque é dali que a
    // pergunta nasce quando algo não vem.
    (recarregar) => {
      if (!nucleo.fontes.disponivel()) return null;

      return el('button', {
        class: 'btn btn--fantasma',
        texto: 'Sondar fontes',
        title: 'Descobre quais endereços das bases federais respondem',
        onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          btn.textContent = 'Sondando…';
          try {
            const emendas = await nucleo.dados.listar('emendas');
            const codigo = (emendas.find((x) => x.codigo) || {}).codigo || null;
            const achados = await nucleo.emendas.sondarFontes(codigo, {
              nomeAutor: nucleo.sessaoMod.sessao.gabinete?.deputado || null,
              aoProgredir: (p) => { btn.textContent = `${p.etapa} ${p.feitos}/${p.total}`; },
            });
            abrirSondagem(achados, codigo);
          } catch (erro) {
            console.error(erro);
            aviso(erro.message || 'Não foi possível sondar as fontes.', 'erro');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Sondar fontes';
          }
        },
      });
    },

    // A mesma varredura da aba de Transferências. A pergunta "para onde foi
    // esta emenda" nasce aqui, olhando a lista — e era aqui que o botão faltava.
    botaoDetalhar,

    // A consulta direta só aparece quando a ponte no servidor está no ar. Um
    // botão que só sabe explicar por que não funciona é pior do que botão
    // nenhum — a importação por planilha continua ali, ao lado, funcionando.
    (recarregar) => {
      if (!nucleo.fontes.disponivel()) return null;

      return el('button', {
        class: 'btn btn--fantasma',
        texto: 'Consultar Portal',
        title: 'Busca a execução direto no Portal da Transparência',
        onclick: async (e) => {
          const btn = e.currentTarget;
          const nomeAutor = nucleo.sessaoMod.sessao.gabinete?.deputado || null;
          btn.disabled = true;
          btn.textContent = 'Consultando…';
          try {
            const r = await nucleo.emendas.consultarPortal({
              nomeAutor,
              aoProgredir: ({ rotulo, trazidas }) => {
                btn.textContent = `${rotulo} · ${trazidas} emendas`;
              },
            });
            if (r.diagnostico) {
              const d = r.diagnostico;
              aviso(d.falhou
                ? `Nada encontrado para "${d.enviamos}", e a consulta de diagnóstico falhou: ${d.falhou}`
                : `Nada encontrado para "${d.enviamos}". Sem filtro o Portal devolveu ${d.semFiltro} registros.`
                  + ` Campos: ${d.campos.join(', ') || '(nenhum)'}.`
                  + ` Autores de exemplo: ${d.autores.join(' | ') || '(nenhum)'}`, 'erro');
            } else if (r.camposRecebidos) {
              // Nome de campo divergente é o erro mais provável desta ponte, e
              // o único que não dá para prever daqui. Mostrar o que a fonte
              // mandou é o que permite corrigir sem uma rodada de suposição.
              aviso(`O Portal respondeu ${r.linhas} registros, mas nenhum campo foi reconhecido. Ele devolveu: ${r.camposRecebidos.join(', ')}`, 'erro');
            } else {
              // A distribuição por ano é o que denuncia um exercício faltando —
              // exatamente o que um total sozinho esconde.
              const porAno = Object.entries(r.porAno || {})
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([ano, n]) => `${ano}: ${n}`)
                .join(' · ');

              aviso([
                `${r.novas} emendas novas, ${r.atualizadas} atualizadas.`,
                porAno || `${r.linhas} registros`,
                r.deOutroAutor ? `${r.deOutroAutor} de nomes parecidos, descartados` : null,
                r.semChave ? `${r.semChave} sem código de emenda` : null,
              ].filter(Boolean).join(' · '), (r.novas + r.atualizadas) ? 'ok' : 'erro');
            }
            recarregar();
          } catch (erro) {
            console.error(erro);
            aviso(erro.message || 'Não foi possível consultar o Portal.', 'erro');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Consultar Portal';
          }
        },
      });
    },
  ];
}

/**
 * A emenda discriminada: os planos de ação do Transferegov, que é onde a emenda
 * se reparte por beneficiário. É daqui que a sanfona de cada emenda se enche —
 * uma varredura só traz tudo, e a partir dela abrir uma linha não custa consulta.
 */
/**
 * Importação de contatos, com padronização na entrada.
 *
 * As listas do gabinete vêm de todo lado e cada uma escreve telefone, nome e
 * município do seu jeito. Importar sem padronizar transfere a bagunça para
 * dentro do sistema, onde ela fica pior: dois contatos para a mesma pessoa, e o
 * CRM deixa de responder a única pergunta que se faz dele — quem eu conheço
 * nesta cidade.
 */
function extrasDosContatos() {
  return [
    (recarregar) => {
      const escolher = el('input', { type: 'file', accept: '.csv,.txt,text/csv', class: 'oculto-visual' });
      const btn = el('button', {
        class: 'btn btn--fantasma',
        texto: 'Importar lista',
        title: 'Lê uma planilha em CSV e padroniza telefone, nome, município e categoria',
        onclick: () => escolher.click(),
      });

      escolher.addEventListener('change', async () => {
        const arquivo = escolher.files?.[0];
        if (!arquivo) return;
        btn.disabled = true;
        btn.textContent = 'Lendo…';
        try {
          const crm = await import('./crm.js');
          const r = await crm.importarContatos(arquivo, {
            ufPadrao: nucleo.sessaoMod.sessao.gabinete?.uf || null,
          });
          const porCategoria = Object.entries(r.porCategoria)
            .sort((a, b) => b[1] - a[1]).slice(0, 4)
            .map(([c, n]) => `${n} ${c}`).join(', ');
          aviso([
            `${r.novos} contatos novos, ${r.atualizados} atualizados`,
            `${r.linhas} linhas lidas`,
            porCategoria ? `classificados: ${porCategoria}` : null,
            // Sem telefone o contato não se identifica entre listas: na próxima
            // importação ele volta como duplicata se o nome vier diferente.
            r.semTelefone ? `${r.semTelefone} sem telefone` : null,
            r.colunasIgnoradas.length
              ? `colunas não reconhecidas: ${r.colunasIgnoradas.slice(0, 5).join(', ')}`
              : null,
          ].filter(Boolean).join(' · '), (r.novos + r.atualizados) ? 'ok' : 'erro');
          recarregar();
        } catch (erro) {
          console.error(erro);
          aviso(`Não foi possível importar: ${erro.message || erro}`, 'erro');
        } finally {
          escolher.value = '';
          btn.disabled = false;
          btn.textContent = 'Importar lista';
        }
      });

      return el('span', { class: 'importador' }, [btn, escolher]);
    },
  ];
}

function extrasDasTransferencias() {
  return [botaoDetalhar, botaoReorganizar];
}

/**
 * O pós-processamento, como ação explícita.
 *
 * O que está guardado por versões anteriores está em grão de documento contábil:
 * milhares de linhas quase todas vazias, e filtros com uma opção "sem
 * classificação" que não filtra nada. Reorganizar reúne cada destino numa linha,
 * soma por fase e aposenta o ruído. É um botão, e não algo escondido dentro de
 * outra tarefa, porque mexer em massa no que já está gravado é decisão de quem
 * usa — e o aviso diz exatamente quantas linhas entraram e quantas saíram.
 */
function botaoReorganizar(recarregar) {
  return el('button', {
    class: 'btn btn--fantasma',
    texto: 'Reorganizar',
    title: 'Reúne os documentos de cada destino numa linha, soma por fase e descarta o que não informa nada',
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Reorganizando…';
      try {
        const r = await nucleo.emendas.reorganizar();
        aviso([
          `${r.antes} linhas viraram ${r.depois} destinos`,
          r.aposentadas ? `${r.aposentadas} em grão de documento foram aposentadas` : null,
          r.descartadas ? `${r.descartadas} não informavam nada` : null,
        ].filter(Boolean).join(' · '), r.depois ? 'ok' : 'erro');
        recarregar();
      } catch (erro) {
        console.error(erro);
        aviso(erro.message || 'Não foi possível reorganizar.', 'erro');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Reorganizar';
      }
    },
  });
}

/**
 * A varredura completa, oferecida nas duas abas.
 *
 * Ela nasceu em Transferências, mas a pergunta nasce em Emendas: é olhando a
 * emenda de sete milhões que se quer saber para onde ela foi. Botão que só
 * existe na outra tela é botão que não se acha.
 */
function botaoDetalhar(recarregar) {
  if (!nucleo.fontes.disponivel()) return null;

  return el('button', {
    class: 'btn btn--fantasma',
    texto: 'Detalhar emendas',
    title: 'Varre Transferegov e Portal: quem recebeu cada emenda, para quê, quanto e em que situação',
    onclick: async (e) => {
      const btn = e.currentTarget;
      const nomeAutor = nucleo.sessaoMod.sessao.gabinete?.deputado || null;
      if (!nomeAutor) {
        aviso('Informe o nome do parlamentar em Acessos → Dados do gabinete.', 'erro');
        return;
      }
      btn.disabled = true;
      try {
        // Os códigos já importados são o filtro exato do fundo a fundo,
        // onde a grafia do nome nem sempre bate.
        const codigos = (await nucleo.dados.listar('emendas'))
          .map((e) => e.codigo).filter(Boolean);

        const r = await nucleo.emendas.detalharEmendas({
          nomeAutor,
          codigos,
          aoProgredir: (p) => {
            btn.textContent = `${p.etapa || 'Buscando'}… ${p.linhas} linhas`;
          },
        });
        if (r.amostra) {
          aviso(`O Transferegov devolveu ${r.linhas} linhas, mas nenhuma virou repasse.`
            + ` A primeira veio assim → ${r.amostra}`, 'erro');
        } else if (!r.linhas) {
          aviso(`Nada encontrado para "${nomeAutor}" nos planos de ação do Transferegov.`
            + ' Confira a grafia do nome em Acessos → Dados do gabinete —'
            + ' é por ele que a busca filtra.', 'erro');
        } else {
          aviso([
            `${r.gravadas} destinos guardados`,
            `${r.emendas} emendas`,
            r.executores ? `${r.executores} executores` : null,
            r.metas ? `${r.metas} metas` : null,
            r.empenhos ? `${r.empenhos} empenhos` : null,
            r.fundoAFundo ? `${r.fundoAFundo} fundo a fundo` : null,
            r.documentos ? `${r.documentos} documentos no Portal` : null,
          ].filter(Boolean).join(' · '), r.gravadas ? 'ok' : 'erro');
        }
        recarregar();
      } catch (erro) {
        console.error(erro);
        aviso(erro.message || 'Não foi possível detalhar as emendas.', 'erro');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Detalhar emendas';
      }
    },
  });
}

/**
 * Mostra o resultado da sondagem, com um botão para copiar.
 *
 * O texto é para ser colado numa conversa: é ele que diz qual endereço existe e
 * com que campos, e é o que fecha em uma rodada uma investigação que de outro
 * modo levaria várias.
 */
function abrirSondagem(achados, codigo) {
  const resumo = achados.map((a) => {
    // Página HTML de erro é ruído: o que importa é que o caminho não existe.
    if (!a.ok) {
      const enxuto = /<html|<!doctype/i.test(a.erro)
        ? a.erro.replace(/\s*<[\s\S]*$/, '') || 'resposta HTML do servidor — caminho inexistente'
        : a.erro;
      return `FALHA ${a.caminho} — ${enxuto}`;
    }
    // Um catálogo de tabelas vale mais que uma amostra: é a lista dos nomes
    // que faltavam para parar de adivinhar.
    // Uma lista longa em linha única é ilegível justamente onde ela é a
    // resposta. Acima de meia dúzia, cada uma na sua linha.
    if (a.tabelas?.length) {
      return a.tabelas.length > 6
        ? `TABELAS ${a.caminho} —\n${a.tabelas.map((t) => `     ${t}`).join('\n')}`
        : `TABELAS ${a.caminho} — ${a.tabelas.join(', ')}`;
    }

    // Colunas de ligação e uma linha de verdade do parlamentar valem mais que a
    // lista de campos: são elas que dizem como pendurar a tabela na emenda.
    const partes = [`OK   ${a.caminho} — ${a.campos.join(', ') || '(sem campos)'}`];
    if (a.chaves?.length) partes.push(`     liga por: ${a.chaves.join(', ')}`);
    if (a.amostra) partes.push(`     exemplo: ${a.amostra}`);
    return partes.join('\n');
  }).join('\n');

  const texto = `Sondagem com a emenda ${codigo || '(nenhuma)'}\n\n${resumo}`;
  const area = el('textarea', { class: 'sondagem-texto', rows: '16', readonly: true });
  area.value = texto;

  const fundo = el('div', { class: 'modal-fundo', onclick: (ev) => { if (ev.target === fundo) fundo.remove(); } }, [
    el('div', { class: 'modal modal--largo', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { class: 'modal-titulo', texto: 'O que cada endereço respondeu' }),
      el('p', { class: 'campo-dica', texto: `${achados.filter((a) => a.ok).length} de ${achados.length} responderam.` }),
      area,
      el('div', { class: 'modal-acoes' }, [
        el('button', {
          class: 'btn btn--primario',
          type: 'button',
          texto: 'Copiar',
          onclick: async (ev) => {
            await navigator.clipboard.writeText(texto).catch(() => {});
            ev.currentTarget.textContent = 'Copiado';
          },
        }),
        el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Fechar', onclick: () => fundo.remove() }),
      ]),
    ]),
  ]);
  document.body.appendChild(fundo);
}

/**
 * O detalhamento de uma emenda, aberto na própria linha.
 *
 * Uma emenda de sete milhões aparece com município "MÚLTIPLO" porque se reparte
 * entre vários — e é justamente essa repartição que o gabinete precisa ver. A
 * sanfona mostra para onde cada parte foi, sem tirar ninguém da lista.
 */
async function sanfonaDaEmenda(emenda, alvo, recarregar) {
  const desenhar = (linhas, aviso_ = null) => {
    limpar(alvo);
    if (aviso_) alvo.appendChild(el('p', { class: 'sanfona-recado', texto: aviso_ }));
    if (!linhas.length) return;

    // As colunas dependem da procedência: o Transferegov traz objeto e
    // situação e não traz data; a planilha do Portal traz fase e data e não traz
    // situação. Mostrar coluna sempre vazia gasta largura e não informa nada.
    const tem = (campo) => linhas.some((t) => t[campo]);
    const somar = (campo) => linhas.reduce((soma, t) => soma + (Number(t[campo]) || 0), 0);
    const dinheiro = (v) => (Number(v) ? fmtDinheiro(v) : '—');

    // As colunas seguem o que os destinos têm. Depois do pós-processamento cada
    // linha é um destino com as fases em colunas próprias — e a escada do
    // dinheiro (destinado → empenhado → pago) é a resposta a "já foi pago?".
    const colunas = [
      tem('municipio') && { titulo: 'Município', agrupa: true, valor: (t) => t.municipio || '—' },
      { titulo: 'Quem recebeu', agrupa: !tem('municipio'), valor: (t) => rotuloDoDestino(t) },
      tem('objeto') && { titulo: 'Objeto', valor: (t) => t.objeto || '—' },
      tem('metas') && { titulo: 'Metas', valor: (t) => t.metas || '—' },
      tem('acao') && { titulo: 'Ação orçamentária', valor: (t) => t.acao || '—' },
      somar('valorDestinado') && { titulo: 'Destinado', num: true, valor: (t) => dinheiro(t.valorDestinado) },
      somar('valorEmpenhado') && { titulo: 'Empenhado', num: true, valor: (t) => dinheiro(t.valorEmpenhado) },
      somar('valorPago') && { titulo: 'Pago', num: true, valor: (t) => dinheiro(t.valorPago) },
      // O impedimento é o que trava o repasse — é sobre isso que a prefeitura
      // liga para o gabinete, e por isso ele vem colado na situação.
      tem('situacao') && { titulo: 'Situação', valor: (t) => t.situacao || '—' },
      tem('ultimaData') && {
        titulo: 'Último movimento',
        valor: (t) => (t.ultimaData ? t.ultimaData.split('-').reverse().join('/') : '—'),
      },
      tem('data') && {
        titulo: 'Data',
        valor: (t) => (t.data ? t.data.split('-').reverse().join('/') : '—'),
      },
      { titulo: 'Valor', num: true, valor: (t) => dinheiro(t.valor) },
    ].filter(Boolean);

    // Por município, somando as parcelas: é a leitura que responde "quanto foi
    // para cada cidade", que é a pergunta de quem abre esta linha.
    const porMunicipio = new Map();
    linhas.forEach((t) => {
      const chave = t.municipio || t.favorecido || 'Sem município identificado';
      if (!porMunicipio.has(chave)) porMunicipio.set(chave, []);
      porMunicipio.get(chave).push(t);
    });

    // Somar linhas cujo valor a fonte não informou dá zero — e "R$ 0,00" ao pé
    // de uma emenda de sete milhões lê-se como "nada foi pago", que é o oposto
    // do que os dados dizem. Sem valor informado, não se afirma total nenhum.
    const comValor = linhas.filter((t) => Number(t.valor));
    const total = comValor.reduce((soma, t) => soma + Number(t.valor), 0);
    const parcial = comValor.length && comValor.length < linhas.length;

    alvo.appendChild(el('table', { class: 'sanfona-tabela' }, [
      el('thead', {}, [el('tr', {}, colunas.map(
        (c) => el('th', { class: c.num ? 'num' : null, texto: c.titulo }),
      ))]),
      el('tbody', {}, [...porMunicipio.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
        .flatMap(([, doLugar]) => doLugar.map((t, i) => el('tr', {}, colunas.map(
          // O nome do grupo repetido em cada parcela vira ruído; escrito uma
          // vez, agrupa a leitura sem precisar de linha de cabeçalho.
          (c) => el('td', {
            class: c.num ? 'num' : null,
            texto: (c.agrupa && i > 0) ? '' : c.valor(t),
          }),
        ))))),
      el('tfoot', {}, [el('tr', {}, [
        el('td', {
          colspan: String(Math.max(1, colunas.length - 1)),
          texto: [
            `${porMunicipio.size} destino(s)`,
            `${linhas.length} repasse(s)`,
            parcial ? `valor informado em ${comValor.length} deles` : null,
          ].filter(Boolean).join(' · '),
        }),
        el('td', {
          class: 'num',
          texto: comValor.length ? fmtDinheiro(total) : 'valores não informados',
        }),
      ])]),
    ]));
  };

  alvo.appendChild(el('p', { class: 'sanfona-recado', texto: 'Carregando…' }));

  try {
    const mesmoCodigo = (a, b) => nucleo.emendas.normalizarCodigo(a) === nucleo.emendas.normalizarCodigo(b);
    const guardadas = (await nucleo.dados.listar('transferencias'))
      .filter((t) => mesmoCodigo(t.codigoEmenda, emenda.codigo));

    // Guardado não é o mesmo que completo, e a conta tem de ser por linha. Bastar
    // que UMA tivesse dado deixava as outras vinte e seis congeladas vazias para
    // sempre: a versão que sabia completá-las nunca chegava a rodar. O cache
    // serve para não repetir consulta, não para preservar buracos.
    // Guardado basta, exceto quando sobrou documento sem destino resolvido — aí
    // vale reconsultar a fonte, que é onde a retentativa mora.
    const resolvido = guardadas.length && !nucleo.emendas.faltaResolver(guardadas);
    if (resolvido || (guardadas.length && !nucleo.fontes.disponivel())) {
      desenhar(guardadas);
      return;
    }
    if (guardadas.length) desenhar(guardadas);

    if (!nucleo.fontes.disponivel()) {
      desenhar([], 'Nada detalhado ainda. A consulta automática está desligada — use "Importar planilha" ou ligue as Cloud Functions.');
      return;
    }

    const r = await nucleo.emendas.detalharEmenda(emenda.codigo, {
      nomeAutor: nucleo.sessaoMod.sessao.gabinete?.deputado || null,
      aoProgredir: (p) => {
        limpar(alvo);
        alvo.appendChild(el('p', {
          class: 'sanfona-recado',
          texto: `Detalhando documento ${p.feitos} de ${p.total}…`,
        }));
      },
    });
    if (r.motivo === 'codigo-ilegivel') {
      desenhar([], `Não dá para consultar por este código: "${r.procurado || '(vazio)'}".`
        + ' O Transferegov procura a emenda pelos doze dígitos — ano, código do'
        + ' parlamentar e sequencial —, e este não os tem.');
      return;
    }
    if (r.amostra) {
      desenhar([], `O Transferegov achou ${r.linhas} plano(s) de ação desta emenda,`
        + ` mas nenhum virou repasse. A primeira linha veio assim → ${r.amostra}`);
      return;
    }
    // Nenhum plano com este código, mas há planos de outras emendas do mesmo
    // ano: isto não é falha, é resposta. Esta emenda não foi por transferência
    // especial. Dizer quais foram poupa abrir uma a uma para descobrir.
    if (r.codigosVistos) {
      desenhar([], `Esta emenda não é transferência especial — o Transferegov não tem`
        + ` plano de ação para o código ${r.procurado}. Em ${r.ano} ele tem plano para`
        + ` ${r.codigosVistos.length === 1 ? 'a emenda' : 'as emendas'}`
        + ` ${r.codigosVistos.join(', ')}. As de finalidade definida, que passam por`
        + ' convênio, ficam em outra base e ainda não estão ligadas.');
      return;
    }
    // Zero linhas não é "esta emenda não é especial": é "ninguém apareceu nesta
    // consulta". Afirmar a primeira sem ter perguntado pelo nome também já foi
    // dito aqui, e estava errado. O recado passa a contar o que foi perguntado.
    // Documento sem favorecido nem valor é execução real com detalhe faltando,
    // não linha inútil. Dizer isso evita que a tela pareça quebrada quando na
    // verdade é a fonte que não desceu a esse nível.
    const incompleto = r.documentos && !r.completados
      ? `${r.documentos} documentos de execução, do índice do Portal.`
        + ' Ele publica fase, data e número; quem recebeu e quanto ficaram num'
        + ' nível abaixo que esta consulta ainda não alcança.'
      : null;

    desenhar(r.transferencias, r.transferencias.length
      ? incompleto
      : `O Transferegov não devolveu nenhum plano de ação de ${r.ano} para este`
        + ` gabinete. Procurei por ${r.tentativas.join(' e depois por ')}.`
        + ' Ou nenhuma emenda deste ano foi por transferência especial, ou o nome do'
        + ' parlamentar em Acessos → Dados do gabinete não é o que essa base usa.');
  } catch (erro) {
    console.error(erro);
    desenhar([], `Não foi possível detalhar: ${erro.message || erro}`);
  }
}

/**
 * Como chamar um destino que a fonte não identificou.
 *
 * Depois do pós-processamento, os documentos sem favorecido conhecido viram uma
 * linha só. Deixá-la com um travessão faria parecer erro de tela; dizer quantos
 * documentos ela reúne diz o que ela é — execução que existe, destino a resolver.
 */
function rotuloDoDestino(t) {
  if (t.favorecido) return t.favorecido;
  if (t.qtdDocumentos) {
    return `${t.qtdDocumentos} documento(s) de execução, destino a resolver`;
  }
  return '—';
}

const ROTULO_FASE = {
  empenho: 'Empenho',
  liquidacao: 'Liquidação',
  pagamento: 'Pagamento',
  convenio: 'Convênio',
  proposta: 'Proposta',
  especial: 'Transferência especial',
};

function acoesDaMinuta() {
  return [
    (peca, aoConcluir) => el('button', {
      class: 'btn btn--fantasma',
      type: 'button',
      texto: 'Gerar minuta',
      onclick: () => nucleo.minuta.abrirMinuta(peca, aoConcluir),
    }),
  ];
}

async function desenharConteudo(alvo, areaId, abaId) {
  if (areaId === 'acessos') {
    await nucleo.admin.renderAdmin(alvo);
    return;
  }

  const abas = abasDaArea(areaId);
  const aba = abaPorId(areaId, abaId) || abas[0];
  if (!aba) {
    limpar(alvo).appendChild(vazio('Esta área ainda não tem conteúdo.'));
    return;
  }

  if (aba.render) {
    await aba.render(alvo);
    return;
  }

  const modulo = aba.modulo;
  const membro = nucleo.sessaoMod.sessao.membro;
  // A ordem espelha firestore.rules: agenda é a exceção restrita, tarefas é a
  // exceção aberta, e o resto segue a regra de editar apenas a própria área.
  let editavel;
  if (modulo.restrita) editavel = podeEditarAgenda(membro);
  else if (modulo.abertaATodos) editavel = podeEditarTarefas(membro);
  else editavel = podeEditar(membro, modulo.area);

  let extras = [];
  if (modulo.importaCamara) extras = extrasDaCamara();
  else if (modulo.importaProducao) extras = extrasDaProducao();
  else if (modulo.importaPauta) extras = extrasDaPauta();
  else if (modulo.importaVotacoes) extras = extrasDasVotacoes();
  else if (modulo.importaEmendas) extras = extrasDasEmendas();
  else if (modulo.importaTransferencias) extras = extrasDasTransferencias();
  else if (modulo.importaContatos) extras = extrasDosContatos();

  const acoesItem = modulo.geraMinuta ? acoesDaMinuta() : [];
  const acoesLinha = modulo.enviaParaAcompanhamento ? [acaoAcompanhar] : [];
  const sanfona = modulo.temSanfona ? sanfonaDaEmenda : null;

  await nucleo.crud.renderModulo(alvo, modulo, { editavel, extras, acoesItem, acoesLinha, sanfona });

  // Consulta a Câmara sozinha ao abrir a lista, se a última já estiver velha.
  // Roda em segundo plano: a tela já está montada e só é redesenhada se algo
  // tiver de fato mudado, e apenas se o usuário ainda estiver nela.
  if (modulo.importaCamara && editavel) {
    const rotaQuandoComecou = location.hash;
    nucleo.camara.sincronizarSeNecessario()
      .then((mudaram) => {
        if (!mudaram || location.hash !== rotaQuandoComecou) return;
        aviso(`${mudaram} proposição(ões) mudaram de situação desde a última consulta.`);
        desenharApp();
      })
      .catch((erro) => console.error('Consulta automática à Câmara falhou', erro));
  }
}

async function desenharApp() {
  const { area, aba } = rota();

  if (!location.hash) {
    location.hash = `#/${areaInicial()}`;
    return;
  }

  const areaId = area;
  if (!AREAS.some((a) => a.id === areaId) && areaId !== 'acessos') {
    location.hash = `#/${areaInicial()}`;
    return;
  }

  limpar(raiz);
  raiz.appendChild(cabecalho());

  const painel = el('main', { class: 'painel' });
  const abasEl = areaId === 'acessos' ? null : subAbas(areaId, aba);
  if (abasEl) painel.appendChild(abasEl);

  const conteudo = el('div', { class: 'conteudo' }, [carregando()]);
  painel.appendChild(conteudo);
  raiz.appendChild(el('div', { class: 'corpo' }, [navegacao(areaId), painel]));

  try {
    await desenharConteudo(conteudo, areaId, aba);
  } catch (erro) {
    console.error(erro);
    limpar(conteudo).appendChild(vazio('Algo deu errado ao montar esta tela. Recarregue a página.'));
  }
}

function desenhar() {
  switch (nucleo.sessaoMod.sessao.estado) {
    case 'carregando':
      limpar(raiz).appendChild(el('div', { class: 'tela-central' }, [carregando('Verificando seu acesso…')]));
      break;
    case 'anonimo': limpar(raiz).appendChild(telaLogin()); break;
    case 'primeiro-acesso': limpar(raiz).appendChild(telaPrimeiroAcesso()); break;
    case 'sem-acesso': limpar(raiz).appendChild(telaSemAcesso()); break;
    case 'pronto': desenharApp(); break;
    default: break;
  }
}

// ─────────────────────────────── partida ───────────────────────────────

async function iniciar() {
  if (!CONFIGURADO) {
    limpar(raiz).appendChild(telaConfiguracao());
    return;
  }

  try {
    const [fb, sessaoMod, crud, admin, paineis, camara, minuta, dados, emendas, ficha, fontes] = await Promise.all([
      import('./firebase.js'),
      import('./sessao.js'),
      import('./crud.js'),
      import('./admin.js'),
      import('./paineis.js'),
      import('./camara.js'),
      import('./minuta.js'),
      import('./dados.js'),
      import('./emendas.js'),
      import('./ficha.js'),
      import('./fontes.js'),
    ]);
    nucleo = { fb, sessaoMod, crud, admin, paineis, camara, minuta, dados, emendas, ficha, fontes };
  } catch (erro) {
    console.error(erro);
    limpar(raiz).appendChild(telaFalhaCarregamento(erro));
    return;
  }

  nucleo.sessaoMod.aoMudarSessao(desenhar);
  window.addEventListener('hashchange', () => {
    if (nucleo.sessaoMod.sessao.estado === 'pronto') desenharApp();
  });
  nucleo.sessaoMod.iniciarSessao();
}

iniciar();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
