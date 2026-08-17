# Gestão de Gabinete Parlamentar

Sistema web para o trabalho diário de um gabinete parlamentar, dividido em cinco áreas:
**Chefia de gabinete**, **Administrativo**, **Legislativo**, **Comunicação** e **Orçamento**.

Entra-se com conta Google, mas só passa quem estiver na lista de pessoas autorizadas.
Todos os integrantes enxergam todas as áreas; cada setor edita a sua. A agenda do
deputado é a única exceção — apenas a chefia altera.

O mesmo sistema atende **mais de um gabinete**: cada registro nasce vinculado a um, e a
separação é garantida pelas regras de segurança do banco, não pela tela.

---

## Como é feito

Não há etapa de compilação nem dependências para instalar. São arquivos estáticos que
falam direto com o Firebase pelo navegador — publicar é copiar a pasta.

| Arquivo | Papel |
| --- | --- |
| `index.html`, `app.css` | Casca e aparência |
| `js/config.js` | Chaves do Firebase, áreas, papéis e regra de permissão |
| `js/modulos.js` | **Catálogo dos módulos.** Descreve os campos de cada tela |
| `js/crud.js` | Gera listagem e formulário a partir do catálogo |
| `js/paineis.js` | Painéis consolidados (gabinete, emendas, cota) |
| `js/sessao.js` | Login, lista de autorizados e vínculo com o gabinete |
| `js/admin.js` | Tela de liberação de acessos |
| `js/camara.js` | Integração com os dados abertos da Câmara |
| `firestore.rules` | **Onde as permissões realmente valem** |

Para acrescentar um campo — ou uma tela inteira — mexe-se em `js/modulos.js`. A interface
é derivada de lá.

---

## Instalação

### 1. Criar o projeto no Firebase

1. Abra <https://console.firebase.google.com> e crie um projeto.
2. Em **Criação › Firestore Database**, crie o banco. Três escolhas importam:
   - **Anote o ID do banco.** Um projeto aceita vários, e o SDK só acha aquele que
     estiver escrito em `FIRESTORE_DATABASE_ID`, em `js/config.js`. Banco errado dá
     erro de "cliente offline" — que parece problema de rede e não é.
   - **Edição Padrão** e **modo nativo**. O SDK do Firebase não fala com o modo
     Datastore, e a edição Corporativos tem preço e comportamento diferentes.
   - Região `southamerica-east1` (São Paulo). Essa não dá para mudar depois.
3. Em **Criação › Authentication › Sign-in method**, ative o provedor **Google**.
4. Ainda em Authentication, aba **Settings › Authorized domains**, confira que o domínio
   onde o sistema vai rodar está na lista.

### 2. Conectar o sistema ao projeto

Em **Configurações do projeto › Seus apps**, registre um app da Web e copie o bloco de
configuração. Cole os valores em `js/config.js`, no lugar dos campos `COLE_AQUI`.

Essas chaves são públicas por natureza — quem protege os dados é o `firestore.rules`.

### 3. Publicar as regras de segurança

Os comandos abaixo precisam rodar **dentro da pasta do projeto** — é lá que está o
`firebase.json`. No Cloud Shell, que abre na pasta pessoal:

```bash
cd ~/applegis || git clone https://github.com/hthiago/applegis.git ~/applegis && cd ~/applegis
git pull origin main       # publica as regras de agora, não as do último clone
```

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # escolha o projeto criado
firebase deploy --only firestore:rules
```

**Não pule este passo.** Sem as regras publicadas, o banco fica aberto ou fechado demais.

**O `firebase.json` precisa nomear o banco.** Este projeto usa um banco Firestore nomeado
(`appgab`), não o `(default)`. Sem a chave `database` no `firebase.json`, o deploy publica
no `(default)` sem avisar — e o banco que o sistema lê continua com as regras antigas.
O sintoma é traiçoeiro: as coleções que já estavam nas regras continuam gravando, só as
novas falham, e republicar não muda nada. Um teste da suíte confere essa correspondência.

**E repita-o sempre que uma aba nova aparecer no sistema.** O `firestore.rules` traz um
mapa de coleções; coleção que não está nele não é gravável por ninguém — nem pela chefia.
Quando isso acontece, o Firebase responde `Missing or insufficient permissions`, que
parece problema de perfil de usuário e não é. O sistema traduz esse erro na tela e diz
qual coleção falhou, mas quem resolve é este comando.

### 4. Publicar o site

```bash
firebase deploy --only hosting
```

### 5. Fazer o primeiro acesso

Abra o site e entre com sua conta Google. Como o banco está vazio, o sistema mostra a tela
**Vamos criar o gabinete**: preencha o nome, crie, e você entra já como chefe de gabinete.

**Faça isso logo depois de publicar as regras.** Enquanto o gabinete não existe, qualquer
pessoa que entre pode reivindicá-lo — é a única janela aberta do sistema, e ela se fecha
sozinha e em definitivo assim que o primeiro gabinete é criado.

A partir daí, use a tela **Acessos** para liberar o resto da equipe. Não é preciso voltar
ao console do Firebase.

> O ID do deputado na Câmara — campo opcional, usado depois para buscar proposições e
> despesas — está em
> <https://dadosabertos.camara.leg.br/api/v2/deputados?nome=SOBRENOME>.

### 6. Abrir outros gabinetes (opcional)

O primeiro gabinete nasce pela tela de instalação. Para atender mais de um, promova
alguém a `admin` editando o documento correspondente em `autorizados` no console: esse
papel não edita conteúdo, mas cria novos gabinetes e administra os acessos de todos eles.

---

## Papéis

| Papel | Alcance |
| --- | --- |
| `deputado` | Edita tudo, inclusive a agenda |
| `chefe` | Edita tudo, inclusive a agenda, e libera acessos do seu gabinete |
| `assessor` | Edita apenas as áreas listadas em `areas`; lê o resto |
| `escritorio` | Edita Administrativo e Orçamento; lê o resto |
| `leitor` | Lê tudo, não altera nada |
| `admin` | Não edita conteúdo; cria gabinetes e administra acessos de todos |

Duas exceções deliberadas à regra geral, ambas registradas em `firestore.rules`:

- **Agenda do deputado** — escrita só de `chefe` e `deputado`, mesmo para quem edita a
  área de Chefia.
- **Tarefas** — qualquer integrante do gabinete pode gravar, porque delegação atravessa
  áreas: quem recebe a tarefa precisa conseguir respondê-la.

---

## Integrações

**Dados abertos da Câmara** (ativa, sem cadastro). Em *Legislativo › Proposições
acompanhadas*, o botão **Buscar na Câmara** importa uma proposição pelo tipo, número e
ano; **Atualizar situações** relê a situação e o órgão de tudo que está na lista.
Em *Produção do gabinete*, **Importar da Câmara** traz tudo que o parlamentar assinou.

**Emendas por planilha** (ativa, sem cadastro). Em *Orçamento › Emendas*, o botão
**Importar planilha** lê as exportações do Portal da Transparência, do Transferegov, do
SIOP e do Fundo Nacional de Saúde. Reconhece o formato pelo cabeçalho, concilia por
código e ano — reimportar atualiza em vez de duplicar — e filtra pelo nome do
parlamentar, dizendo quantas linhas descartou e com qual nome.

**Emendas por consulta direta** (precisa das Cloud Functions; veja abaixo). Duas
camadas: *Emendas* traz o consolidado por emenda — empenhado, liquidado, pago e
restos —, e *Transferências* traz a emenda discriminada, uma linha por documento
de execução, com quem recebeu, para quê e em que fase.

**Votação por município** (ativa, sem cadastro). Em *Administrativo › Municípios*, o
botão **Importar votação (TSE)** lê o arquivo de votação por município do repositório
de dados eleitorais do TSE, casa o nome de urna com o nome do parlamentar cadastrado,
soma os votos por cidade e calcula a colocação e o percentual. Só os campos de votação
são escritos: prefeito, vereadores e o resumo econômico foram preenchidos por gente, e
uma importação de votos não os apaga.

**Ficha de apresentação** (ativa). Em *Administrativo › Ficha de apresentação*, o
município em uma folha: população e região (IBGE), um minimapa mostrando onde a cidade
fica no estado, quem governa e os vereadores aliados (cadastro de *Municípios*), a
votação do parlamentar ali (TSE), renda e produção, as emendas com o valor por
habitante, o que está travado e os contatos do gabinete na cidade. **Imprimir** gera a
folha física em A4, sem barra nem botões. **Enviar por WhatsApp** monta a versão curta
e abre a conversa com a mensagem pronta — o parlamentar aparece primeiro na lista, com
o número cadastrado em *Acessos › Dados do gabinete*. O envio usa hoje o link `wa.me`,
que funciona sem chave e sem cadastro; quando a API oficial do gabinete for definida,
muda só a função `linkDoWhatsapp`.

**Ainda por ligar:** Google Agenda (leitura para o gabinete, escrita para a chefia),
Google Drive (documentos guardam o link, não o arquivo) e as despesas da cota
(`/deputados/{id}/despesas`), que a Câmara publica com atraso e por isso servem de
conferência, nunca de saldo ao vivo.

---

## Consulta automática (Cloud Functions)

O navegador não alcança as bases de execução orçamentária, e não é limitação
contornável: o **Portal da Transparência exige chave de API** — que em código de
navegador ficaria visível para qualquer visitante, com a cota correndo por conta do
gabinete — e **nenhuma dessas bases autoriza chamada vinda de outra origem**, o que o
navegador recusa antes mesmo de a resposta chegar.

A pasta `functions/` resolve os dois: a chave vive como segredo do projeto e a chamada
parte do servidor, onde a regra de origem não se aplica. Quem pode usá-la são as contas
que já constam em `autorizados` — a mesma lista que abre o sistema.

Enquanto isto não estiver no ar, a importação por planilha continua funcionando e traz
exatamente os mesmos números.

### Passo a passo

1. **Mude o projeto para o plano Blaze.** Cloud Functions exige cartão cadastrado. O
   plano é por uso e tem cota gratuita generosa; o volume de um gabinete — algumas
   dezenas de consultas por mês — fica dentro dela.

2. **Obtenha a chave do Portal da Transparência**, gratuita, em
   `portaldatransparencia.gov.br/api-de-dados/cadastrar-email`. Ela chega por e-mail.

3. **Guarde a chave como segredo** (ela nunca entra no repositório):

   ```
   firebase functions:secrets:set CHAVE_PORTAL_TRANSPARENCIA
   ```

4. **Implante:**

   ```
   cd functions && npm install && cd ..
   firebase deploy --only functions
   ```

   O nome do banco (`appgab`) já vai em `functions/.env`, que não é segredo —
   só a chave é.

   **Se o deploy falhar com `iam.serviceaccounts.actAs denied`**, é a conta de
   serviço padrão do Compute que ainda não existe: projetos do Firebase não a
   criam até a API do Compute Engine ser ativada. Rode
   `gcloud services enable compute.googleapis.com`, espere um minuto e repita o
   deploy.

5. **Ligue no cliente.** Em `js/config.js`, mude `CONSULTA_AUTOMATICA` para `true` e
   confira que `REGIAO_FUNCOES` é a mesma região declarada em `functions/index.js`
   (`southamerica-east1`). Região divergente não dá erro de configuração: dá
   "função não encontrada", que parece falta de implantação e não é.

6. Publique o site. O botão **Consultar Portal** passa a aparecer em *Orçamento ›
   Emendas*.

### O que a função faz e o que ela não faz

Ela **repassa** — não interpreta. Devolve o que a fonte respondeu, com o status e o
corpo do erro quando há erro, e toda a leitura acontece no cliente, onde há teste. Um
proxy que também interpretasse esconderia de qual dos dois lados veio o problema.

Só aceita as fontes declaradas em `FONTES`, dentro de `functions/index.js`, e descarta
parâmetro fora da lista de cada uma. Sem isso ela seria um proxy aberto: qualquer conta
autenticada poderia usá-la para buscar qualquer endereço da internet com o projeto do
gabinete no meio.

---

## Dados pessoais

Com o CRM e o atendimento ao cidadão, o banco guarda dados de pessoas que não trabalham no
gabinete. Três cuidados que fazem parte do desenho:

- Guarde o mínimo necessário. O cadastro de equipe não pede CPF de propósito.
- Não registre dado sensível — saúde, opinião política de terceiros — em campo livre.
- Todo registro grava quem criou e quem alterou por último (`criadoPor`, `atualizadoPor`).

---

## Desenvolvimento local

```bash
npx serve .
```

Qualquer servidor estático serve. Abrir o `index.html` direto do disco **não funciona**:
os módulos JavaScript exigem `http://` ou `https://`.

## Testes

```bash
npm install -D playwright && npx playwright install chromium
node teste/rodar.mjs
```

Abre o sistema num navegador de verdade e troca o SDK do Firebase por um duplo em
memória (`teste/stub-firebase.js`), sem tocar em nenhum projeto real. São 25 verificações
em duas frentes: o uso normal — login, as cinco áreas, cadastro, busca, painéis — e a
**matriz de permissão**, papel por papel.

Vale rodar sempre que mexer em `js/config.js` ou em `firestore.rules`: a segunda suíte
existe justamente para flagrar quando a tela e as regras do banco discordam sobre quem
pode editar o quê.

## Documentação

`docs/anamnese.html` é o levantamento que originou o sistema: o escopo de cada área, a
matriz de permissão, as integrações, os riscos e o que ficou de fora. Abra no navegador.


### Leitura de bilhetes de passagem

A aba **Viagens e passagens** lê a captura de um e-ticket ou cartão de embarque e
preenche os campos — origem, destino, data, hora, voo, localizador — em vez de
alguém redigitá-los na planilha e na agenda. A leitura acontece numa Cloud
Function, porque a chave da API não pode ficar em código de navegador.

A leitura aceita dois provedores, escolhidos pela chave que estiver cadastrada.
A OpenAI vem primeiro quando as duas existem:

```bash
firebase functions:secrets:set CHAVE_OPENAI        # platform.openai.com
# ou
firebase functions:secrets:set CHAVE_ANTHROPIC     # console.anthropic.com

firebase deploy --only functions
```

Para fixar o modelo, ponha `MODELO_LEITURA` em `functions/.env` — o padrão é
`gpt-4o` na OpenAI e `claude-opus-5` na Anthropic. O gasto é por imagem lida e o
volume de um gabinete é pequeno: algumas dezenas de bilhetes por mês.

As duas implementações ficam no código de propósito. A parte difícil — o esquema
dos campos e a instrução de não adivinhar — é a mesma nas duas; o que muda é o
envelope. Arrancar uma para trocar de provedor obrigaria a reescrever tudo na
próxima troca, e "momentaneamente" é uma palavra que costuma durar.

**Nada é gravado sem confirmação.** A função devolve o que leu, a tela mostra
campo por campo com o que ficou ilegível em destaque, e quem confirma é uma
pessoa. Leitura de imagem erra, e uma viagem gravada sozinha com a data errada é
pior que uma viagem não gravada: a segunda alguém percebe que falta, a primeira
ninguém percebe até o embarque.
