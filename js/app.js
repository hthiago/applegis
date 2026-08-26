import { CONFIGURADO, AREAS, PAPEIS, podeEditar, podeEditarAgenda, podeEditarTarefas, ehAdmin } from './config.js';
import { modulosDaArea, porId } from './modulos.js';
import { el, limpar, aviso, carregando, vazio, fmtDinheiro, fmtDinheiroCurto, modal } from './ui.js';

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
  ];
}

/** Endereços que mudaram de nome mas não podem deixar de responder. */
const APELIDOS = {};

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
  // Um endereço que já circula no gabinete não pode deixar de responder porque
  // a aba mudou de nome. Fundir duas telas é melhoria; quebrar o link de quem
  // já tinha a resposta salva, não.
  const alvo = APELIDOS[abaId] || abaId;
  const naBarra = abasDaArea(areaId).find((a) => a.id === alvo);
  if (naBarra) return naBarra;
  const escondido = porId[alvo];
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

/**
 * Municípios: três importações, três fontes oficiais, nenhuma digitação.
 *
 * Preencher 497 cidades à mão é trabalho de semanas que envelhece sozinho. O
 * TSE publica quem governa e quanto votou; o IBGE publica renda, PIB e de onde
 * vem a riqueza. Cada importação escreve só os seus campos — as três convivem
 * no mesmo registro sem se apagarem, e o que é do gabinete (presidente da
 * Câmara, "o que importa nesta cidade", observações) nenhuma delas toca.
 */
function extrasDosMunicipios() {
  const importador = (rotulo, titulo, executar) => (recarregar) => {
    const escolher = el('input', { type: 'file', accept: '.csv,.txt,text/csv', class: 'oculto-visual' });
    const btn = el('button', {
      class: 'btn btn--fantasma', texto: rotulo, title: titulo, onclick: () => escolher.click(),
    });

    escolher.addEventListener('change', async () => {
      const arquivo = escolher.files?.[0];
      if (!arquivo) return;
      btn.disabled = true;
      btn.textContent = 'Lendo…';
      try {
        // Os arquivos do TSE passam de cem megabytes e a leitura leva minutos.
        // Sem a porcentagem andando, um botão parado por três minutos é
        // indistinguível de um botão quebrado — e a pessoa recarrega a página.
        await executar(arquivo, (lido, total) => {
          btn.textContent = `Lendo ${Math.round((lido / total) * 100)}%…`;
        });
        recarregar();
      } catch (erro) {
        console.error(erro);
        aviso(erro.message || 'Não foi possível importar.', 'erro');
      } finally {
        escolher.value = '';
        btn.disabled = false;
        btn.textContent = rotulo;
      }
    });

    return el('span', { class: 'importador' }, [btn, escolher]);
  };

  return [
    // Quem governa: prefeito, vice e os vereadores do partido, para o estado
    // inteiro de uma vez.
    importador(
      'Importar candidaturas (TSE)',
      'O arquivo "consulta_cand" da eleição municipal: traz prefeito, vice e os vereadores eleitos do partido',
      async (arquivo, aoAndar) => {
        const tse = await import('./tse.js');
        const g = nucleo.sessaoMod.sessao.gabinete;
        const r = await tse.importarCandidatos(arquivo, { partidoAliado: g?.partido || null, aoAndar });
        aviso([
          `${r.municipios} municípios (${r.novos} novos, ${r.atualizados} atualizados)`,
          `${r.prefeitos} eleitos prefeitos e ${r.vices} vices`,
          r.partidoAliado
            ? `${r.aliados} vereadores do ${r.partidoAliado}, de ${r.vereadores} eleitos`
            // Dito, e não silenciado: sem o partido a coluna de aliados fica
            // vazia e alguém acharia que o arquivo estava incompleto.
            : `${r.vereadores} vereadores lidos, nenhum guardado — informe o partido em Acessos → Dados do gabinete`,
          // Quem o gabinete já conferiu não é tocado, e isso precisa aparecer:
          // do contrário parece que a importação falhou naquelas cidades.
          r.confirmados ? `${r.confirmados} preservados por já estarem confirmados pelo gabinete` : null,
        ].filter(Boolean).join(' · '), r.partidoAliado ? 'ok' : 'erro');
      },
    ),
    // Quanto votou: o que diz se aquilo é um reduto ou um lugar a conquistar.
    importador(
      'Importar votação (TSE)',
      'O arquivo de votação por município do repositório de dados eleitorais do TSE',
      async (arquivo, aoAndar) => {
        const tse = await import('./tse.js');
        const g = nucleo.sessaoMod.sessao.gabinete;
        const r = await tse.importarVotacao(arquivo, { nomeAutor: g?.deputado || null, aoAndar });
        aviso([
          `${r.municipios} municípios (${r.novos} novos, ${r.atualizados} atualizados)`,
          `${r.votos.toLocaleString('pt-BR')} votos em ${r.linhas} linhas lidas`,
          r.melhores.length ? `maiores: ${r.melhores.join(', ')}` : null,
        ].filter(Boolean).join(' · '), 'ok');
      },
    ),
    // Renda e produção: sem arquivo, direto da API do IBGE.
    (recarregar) => {
      const rotulo = 'Atualizar economia (IBGE)';
      const btn = el('button', {
        class: 'btn btn--fantasma',
        texto: rotulo,
        title: 'Busca PIB per capita, renda e a repartição da produção de cada município cadastrado',
        onclick: async () => {
          btn.disabled = true;
          btn.textContent = 'Consultando o IBGE…';
          try {
            const [ibge, dados] = await Promise.all([import('./ibge.js'), import('./dados.js')]);
            const municipios = await dados.listar('municipios', { recarregar: true });
            if (!municipios.length) {
              aviso('Nenhum município cadastrado ainda. Importe as candidaturas do TSE primeiro — elas criam as cidades do estado.', 'erro');
              return;
            }
            const g = nucleo.sessaoMod.sessao.gabinete;
            const r = await ibge.atualizarEconomia(municipios, {
              uf: g?.uf || null,
              aoAndar: (feitos, total) => { btn.textContent = `IBGE ${feitos}/${total}…`; },
            });
            aviso([
              `${r.preenchidos} municípios preenchidos de ${r.comCodigo}`,
              r.preservados ? `${r.preservados} campos preservados por já estarem preenchidos` : null,
              r.semDado ? `${r.semDado} sem dado publicado` : null,
              r.semCodigo ? `${r.semCodigo} não reconhecidos no IBGE` : null,
              r.tabelas.length ? `tabelas: ${r.tabelas.join('; ')}` : null,
              // O que a varredura procurou e não achou vale mais que o silêncio:
              // é a diferença entre "o IBGE não tem" e "eu procurei errado".
              r.faltando?.length ? `não resolvido — ${r.faltando.join('; ')}` : null,
              r.erros?.length ? `falhas de consulta: ${r.erros.join('; ')}` : null,
            ].filter(Boolean).join(' · '), r.preenchidos ? 'ok' : 'erro');
            recarregar();
          } catch (erro) {
            console.error(erro);
            aviso(erro.message || 'O IBGE não respondeu.', 'erro');
          } finally {
            btn.disabled = false;
            btn.textContent = rotulo;
          }
        },
      });
      return btn;
    },
  ];
}

/**
 * Leitura do bilhete de passagem por imagem.
 *
 * A regra: nada é gravado sem confirmação. Leitura de imagem erra, e uma viagem
 * gravada sozinha com a data errada é pior que uma viagem não gravada — a segunda
 * alguém percebe que falta, a primeira ninguém percebe até o embarque.
 */
function extrasDasViagens() {
  return [
    (recarregar) => {
      if (!nucleo.fontes.disponivel()) return null;

      const escolher = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'oculto-visual' });
      const btn = el('button', {
        class: 'btn btn--fantasma',
        texto: 'Ler bilhete',
        title: 'Envie a captura do e-ticket ou do cartão de embarque; o sistema lê e você confirma',
        onclick: () => escolher.click(),
      });

      escolher.addEventListener('change', async () => {
        const arquivo = escolher.files?.[0];
        if (!arquivo) return;
        btn.disabled = true;
        btn.textContent = 'Lendo o bilhete…';
        try {
          const passagens = await import('./passagens.js');
          const lido = await passagens.lerBilhete(arquivo);
          if (!lido.trechos?.length) {
            aviso('Não achei trecho de voo nesta imagem. Tente uma captura mais nítida, ou cadastre à mão.', 'erro');
            return;
          }
          abrirConfirmacaoDeBilhete(lido, passagens, recarregar);
        } catch (erro) {
          console.error(erro);
          aviso(erro.message || 'Não foi possível ler o bilhete.', 'erro');
        } finally {
          escolher.value = '';
          btn.disabled = false;
          btn.textContent = 'Ler bilhete';
        }
      });

      return el('span', { class: 'importador' }, [btn, escolher]);
    },
  ];
}

/**
 * A tela de confirmação do bilhete lido.
 *
 * Cada trecho aparece com seus campos editáveis, e o que a leitura não conseguiu
 * ler vem em destaque. É deliberadamente um passo a mais: o ganho está em não
 * redigitar, não em confiar cegamente numa leitura de imagem.
 */
function abrirConfirmacaoDeBilhete(lido, passagens, recarregar) {
  const trechos = lido.trechos.map((t) => passagens.viagemDoTrecho(t, {
    viajante: nucleo.sessaoMod.sessao.gabinete?.deputado || null,
  }));

  const campos = [
    ['viajante', 'Quem viaja'], ['origem', 'Origem'], ['destino', 'Destino'],
    ['ida', 'Data (AAAA-MM-DD)'], ['horaPartida', 'Partida'], ['horaChegada', 'Chegada'],
    ['companhia', 'Companhia'], ['voo', 'Voo'], ['localizador', 'Localizador'],
    ['assento', 'Assento'], ['custo', 'Valor'],
  ];

  const entradas = trechos.map((v, i) => {
    const linha = {};
    const bloco = el('fieldset', { class: 'bilhete-trecho' }, [
      el('legend', { texto: `Trecho ${i + 1}` }),
      ...campos.map(([k, rotulo]) => {
        const entrada = el('input', {
          type: 'text',
          id: `bilhete-${i}-${k}`,
          // Campo que a leitura não conseguiu preencher fica marcado: vazio pede
          // atenção, palpite passa por conferido.
          class: v[k] === null || v[k] === undefined ? 'bilhete-falta' : null,
        });
        entrada.value = v[k] ?? '';
        linha[k] = entrada;
        return el('div', { class: 'campo' }, [
          el('label', { for: `bilhete-${i}-${k}`, texto: rotulo }), entrada,
        ]);
      }),
    ]);
    return { bloco, linha };
  });

  const naAgenda = el('input', { type: 'checkbox', id: 'bilhete-agenda' });
  naAgenda.checked = true;

  const corpo = el('div', {}, [
    el('p', { class: 'campo-dica', texto: lido.ilegivel?.length
      ? `A imagem não permitiu ler com segurança: ${lido.ilegivel.join(', ')}. Confira os campos marcados antes de salvar.`
      : 'Confira os campos antes de salvar. A leitura de imagem acerta quase sempre, e "quase" é o motivo desta tela existir.' }),
    ...entradas.map((e) => e.bloco),
    el('div', { class: 'campo campo--linha' }, [
      naAgenda,
      el('label', { for: 'bilhete-agenda', texto: 'Criar também o compromisso na agenda do deputado' }),
    ]),
  ]);

  const salvar = el('button', { class: 'btn btn--primario', type: 'button', texto: 'Salvar viagens' });
  const fechar = modal('Bilhete lido', corpo);

  corpo.appendChild(el('div', { class: 'modal-acoes' }, [
    el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Cancelar', onclick: () => fechar() }),
    salvar,
  ]));

  salvar.addEventListener('click', async () => {
    salvar.disabled = true;
    salvar.textContent = 'Salvando…';
    try {
      const hoje = new Date().toISOString().slice(0, 10);
      const viagens = [];
      for (const { linha } of entradas) {
        const v = {};
        for (const [k] of campos) {
          const valor = linha[k].value.trim();
          v[k] = valor === '' ? null : valor;
        }
        v.custo = v.custo ? Number(String(v.custo).replace(',', '.')) : null;
        v.status = 'emitida';
        v.fonte = 'bilhete lido por imagem';
        // "Quando" é calculado, não digitado: é o que faz o filtro "o que vem por
        // aí" funcionar sem ninguém manter um campo em dia.
        v.quando = !v.ida ? 'sem-data' : (v.ida > hoje ? 'futura' : (v.ida === hoje ? 'hoje' : 'passada'));
        viagens.push(v);
      }

      const registros = viagens
        .map((v) => ({ id: passagens.chaveDaViagem(v), dados: v }))
        .filter((r) => r.id);
      if (!registros.length) {
        aviso('Sem data ou número de voo não é possível identificar o trecho. Preencha ao menos a data.', 'erro');
        return;
      }

      const gravacao = await nucleo.dados.salvarEmLote('viagens', registros);
      if (gravacao.falhas.length) throw gravacao.falhas[0];

      let naAgendaCriados = 0;
      if (naAgenda.checked) {
        const compromissos = viagens
          .map((v) => passagens.compromissoDaViagem(v))
          .filter(Boolean)
          .map((c, i) => ({ id: `voo-${registros[i]?.id || i}`, dados: c }));
        if (compromissos.length) {
          const g2 = await nucleo.dados.salvarEmLote('agenda', compromissos);
          if (!g2.falhas.length) naAgendaCriados = compromissos.length;
        }
      }

      aviso([
        `${registros.length} trecho(s) salvos`,
        naAgendaCriados ? `${naAgendaCriados} na agenda` : null,
      ].filter(Boolean).join(' · '));
      fechar();
      recarregar();
    } catch (erro) {
      console.error(erro);
      aviso(erro.message || 'Não foi possível salvar as viagens.', 'erro');
    } finally {
      salvar.disabled = false;
      salvar.textContent = 'Salvar viagens';
    }
  });
}


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
  else if (modulo.importaContatos) extras = extrasDosContatos();
  else if (modulo.leBilhete) extras = extrasDasViagens();
  else if (modulo.importaVotacao) extras = extrasDosMunicipios();

  const acoesItem = modulo.geraMinuta ? acoesDaMinuta() : [];
  const acoesLinha = modulo.enviaParaAcompanhamento ? [acaoAcompanhar] : [];
  await nucleo.crud.renderModulo(alvo, modulo, { editavel, extras, acoesItem, acoesLinha });

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
    const [fb, sessaoMod, crud, admin, paineis, camara, minuta, dados, ficha, fontes] = await Promise.all([
      import('./firebase.js'),
      import('./sessao.js'),
      import('./crud.js'),
      import('./admin.js'),
      import('./paineis.js'),
      import('./camara.js'),
      import('./minuta.js'),
      import('./dados.js'),
      import('./ficha.js'),
      import('./fontes.js'),
    ]);
    nucleo = { fb, sessaoMod, crud, admin, paineis, camara, minuta, dados, ficha, fontes };
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
