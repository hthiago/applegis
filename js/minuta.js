import { listar, salvar } from './dados.js';
import { sessao } from './sessao.js';
import { el, limpar, aviso } from './ui.js';

/**
 * Geração de minutas.
 *
 * O documento é montado a partir de três pedaços: as regras de redação
 * legislativa (fixas), os valores do mandato (do módulo Valores e diretrizes)
 * e o teor que a equipe descreveu. Nada aqui inventa o mérito da proposta —
 * o teor é sempre humano.
 *
 * Enquanto não houver um servidor para chamar a IA, a tela entrega o texto
 * montado para colar em qualquer assistente e devolve o resultado ao campo
 * Minuta. Ligar a chamada automática depois é trocar apenas a função
 * `gerar` por uma requisição.
 */

const ESTRUTURAS = {
  pl: `PROJETO DE LEI
1. Ementa: uma única frase, sem ponto final, iniciada por verbo ("Dispõe sobre…", "Altera a Lei nº …").
2. Preâmbulo: O CONGRESSO NACIONAL decreta:
3. Articulado.
4. Cláusula de vigência como último artigo.
5. JUSTIFICAÇÃO em texto corrido.`,
  pec: `PROPOSTA DE EMENDA À CONSTITUIÇÃO
1. Ementa.
2. Preâmbulo: As Mesas da Câmara dos Deputados e do Senado Federal, nos termos do § 3º do art. 60 da Constituição Federal, promulgam a seguinte Emenda ao texto constitucional:
3. Articulado, indicando com precisão o dispositivo constitucional alterado.
4. Cláusula de vigência.
5. JUSTIFICAÇÃO, demonstrando que a proposta não fere cláusula pétrea.`,
  pdl: `PROJETO DE DECRETO LEGISLATIVO
1. Ementa.
2. Preâmbulo: O CONGRESSO NACIONAL decreta:
3. Articulado.
4. Cláusula de vigência.
5. JUSTIFICAÇÃO, indicando a competência exclusiva do art. 49 da Constituição.`,
  requerimento: `REQUERIMENTO
1. Endereçamento à autoridade competente (Presidente da Câmara, da Comissão, ou Ministro).
2. Fundamento regimental expresso.
3. Pedido, objetivo e delimitado.
4. JUSTIFICAÇÃO breve.`,
  emenda: `EMENDA
1. Identificação da proposição emendada e do dispositivo atingido.
2. Tipo: supressiva, aditiva, substitutiva, modificativa ou de redação.
3. Texto da emenda.
4. JUSTIFICAÇÃO objetiva.`,
  parecer: `PARECER
1. Relatório: histórico da matéria e do que foi apensado.
2. Voto do relator: mérito, constitucionalidade, juridicidade e técnica legislativa.
3. Conclusão explícita pela aprovação ou rejeição.`,
  discurso: `DISCURSO
Texto corrido para leitura em voz alta, entre dois e cinco minutos.
Abertura que prenda, desenvolvimento com dados verificáveis, fecho com a posição do mandato.
Sem tópicos, sem subtítulos, sem linguagem de documento escrito.`,
  questao: `QUESTÃO DE ORDEM
1. Fundamento regimental preciso, com artigo e inciso.
2. Descrição objetiva do fato que a motiva.
3. Formulação da questão em uma pergunta clara ao Presidente.`,
  nota: `NOTA TÉCNICA
1. Objeto da análise.
2. Análise de mérito e de legalidade.
3. Conclusão com recomendação ao parlamentar.`,
};

const REGRAS = `Regras de redação (Lei Complementar 95/1998):
- Um único assunto por artigo; um único comando por dispositivo.
- Artigos: "Art. 1º" a "Art. 9º" em ordinais; "Art. 10" em diante em cardinais.
- Subdivisões nesta ordem: parágrafos (§ 1º), incisos (I, II), alíneas (a, b), itens (1, 2).
- Frases curtas, ordem direta, verbo no presente do indicativo. Não use "deverá" onde cabe "deve".
- Não use remissão vaga ("na forma da legislação vigente"); cite a norma pelo número e artigo.
- Não repita na justificação o que o articulado já diz; a justificação argumenta, não resume.
- Não invente números, datas, valores, citações ou jurisprudência. Se um dado for necessário e
  não tiver sido fornecido, escreva [VERIFICAR] no lugar em vez de estimar.`;

function valoresRelevantes(valores, tema) {
  if (!valores.length) return null;
  const chave = String(tema || '').toLowerCase();
  const alvo = valores.filter((v) => chave && String(v.tema || '').toLowerCase().includes(chave.slice(0, 6)));
  const usar = alvo.length ? alvo : valores;

  return usar.slice(0, 8).map((v) => {
    const posicao = { favoravel: 'favorável', contrario: 'contrário', ressalvas: 'favorável com ressalvas', casoacaso: 'avalia caso a caso' }[v.posicao] || v.posicao;
    const linhas = [`- ${v.tema} (${posicao}${v.inegociavel ? ', ponto inegociável' : ''}): ${v.diretriz}`];
    if (v.fundamentacao) linhas.push(`  Fundamentação: ${v.fundamentacao}`);
    return linhas.join('\n');
  }).join('\n');
}

/** Monta o texto completo: regras fixas + valores do mandato + teor da peça. */
export function montarPrompt(peca, valores) {
  const g = sessao.gabinete || {};
  const estrutura = ESTRUTURAS[peca.tipo] || ESTRUTURAS.pl;
  const doutrina = valoresRelevantes(valores, peca.tema);

  return [
    `Você é assessor legislativo do gabinete do Deputado Federal ${g.deputado || '(parlamentar)'}${g.uf ? ` (${g.uf})` : ''}, na Câmara dos Deputados.`,
    'Redija a peça abaixo pronta para revisão humana. Devolva apenas o documento, sem comentários seus.',
    '',
    'ESTRUTURA EXIGIDA',
    estrutura,
    '',
    REGRAS,
    '',
    doutrina
      ? `VALORES DO MANDATO\nA peça deve ser coerente com estas diretrizes:\n${doutrina}`
      : 'VALORES DO MANDATO\nNenhuma diretriz cadastrada. Mantenha tom sóbrio e evite juízos político-partidários.',
    '',
    'PEÇA A REDIGIR',
    `Título de trabalho: ${peca.titulo || '(sem título)'}`,
    peca.tema ? `Tema: ${peca.tema}` : null,
    '',
    'Teor pretendido, descrito pela equipe:',
    peca.teor || '(não informado)',
  ].filter((l) => l !== null).join('\n');
}

export async function abrirMinuta(peca, aoSalvar) {
  const valores = await listar('valores').catch(() => []);
  const texto = montarPrompt(peca, valores);

  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', aoTeclar); };
  const aoTeclar = (e) => { if (e.key === 'Escape') fechar(); };

  const prompt = el('textarea', { class: 'minuta-prompt', rows: '12', readonly: true });
  prompt.value = texto;

  const resultado = el('textarea', {
    class: 'minuta-resultado',
    rows: '10',
    placeholder: 'Cole aqui o documento gerado. Ele será salvo no campo Minuta da peça.',
  });
  resultado.value = peca.minuta || '';

  const btnCopiar = el('button', {
    class: 'btn btn--fantasma',
    type: 'button',
    texto: 'Copiar instruções',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(texto);
        btnCopiar.textContent = 'Copiado';
        setTimeout(() => { btnCopiar.textContent = 'Copiar instruções'; }, 2000);
      } catch {
        prompt.select();
        aviso('Selecione e copie o texto — o navegador bloqueou a cópia automática.', 'erro');
      }
    },
  });

  const btnSalvar = el('button', {
    class: 'btn btn--primario',
    type: 'button',
    texto: 'Salvar minuta',
    onclick: async () => {
      btnSalvar.disabled = true;
      try {
        await salvar('producao', peca.id, { minuta: resultado.value.trim() || null });
        aviso('Minuta salva na peça.');
        fechar();
        aoSalvar();
      } catch (erro) {
        console.error(erro);
        aviso('Não foi possível salvar a minuta.', 'erro');
        btnSalvar.disabled = false;
      }
    },
  });

  const fundo = el('div', { class: 'modal-fundo', onclick: (e) => { if (e.target === fundo) fechar(); } }, [
    el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { class: 'modal-titulo', texto: `Gerar minuta — ${peca.titulo || 'peça sem título'}` }),
      el('p', { class: 'modal-texto', texto: 'O texto abaixo reúne as regras de redação legislativa, os valores do mandato e o teor que a equipe descreveu. Cole-o num assistente de IA e traga o documento de volta.' }),

      el('div', { class: 'campo' }, [
        el('label', { texto: 'Instruções montadas' }),
        prompt,
      ]),
      btnCopiar,

      el('div', { class: 'campo' }, [
        el('label', { texto: 'Documento gerado' }),
        resultado,
      ]),

      el('div', { class: 'modal-acoes' }, [
        el('button', { class: 'btn btn--fantasma', type: 'button', texto: 'Fechar', onclick: fechar }),
        btnSalvar,
      ]),
    ]),
  ]);

  document.body.appendChild(fundo);
  document.addEventListener('keydown', aoTeclar);
  resultado.focus();
}
