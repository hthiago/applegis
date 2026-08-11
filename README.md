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
   - **ID do banco: `(default)`.** O sistema fala com o banco padrão. Um banco com
     outro nome existe, aparece no console e ainda assim não é encontrado — e o SDK
     relata isso como "cliente offline", mandando você procurar problema de rede.
   - **Modo nativo**, não modo Datastore. O SDK do Firebase não fala com o segundo.
   - Região `southamerica-east1` (São Paulo). Essa não dá para mudar depois.
3. Em **Criação › Authentication › Sign-in method**, ative o provedor **Google**.
4. Ainda em Authentication, aba **Settings › Authorized domains**, confira que o domínio
   onde o sistema vai rodar está na lista.

### 2. Conectar o sistema ao projeto

Em **Configurações do projeto › Seus apps**, registre um app da Web e copie o bloco de
configuração. Cole os valores em `js/config.js`, no lugar dos campos `COLE_AQUI`.

Essas chaves são públicas por natureza — quem protege os dados é o `firestore.rules`.

### 3. Publicar as regras de segurança

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # escolha o projeto criado
firebase deploy --only firestore:rules
```

**Não pule este passo.** Sem as regras publicadas, o banco fica aberto ou fechado demais.

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

**Ainda por ligar**, nesta ordem:

1. **Transferegov** (`api-publica.transferegov.gestao.gov.br`) e **Portal da
   Transparência** para preencher empenho, instrumento e pagamento das emendas. O Portal
   exige cadastro para obter uma chave de acesso.
2. **Despesas da Câmara** (`/deputados/{id}/despesas`) para conferir os lançamentos da
   cota contra o reembolso oficial. A base publica com atraso, então serve de conferência
   — nunca de saldo ao vivo.
3. **Google Agenda** — leitura para todo o gabinete, escrita apenas para a chefia.
4. **Google Drive** — documentos, ofícios e banco de mídia guardam o link, não o arquivo.

As três primeiras devem rodar no servidor (Cloud Functions), e não no navegador: assim a
chave do Portal da Transparência não é exposta e a atualização acontece sozinha, sem
depender de alguém abrir a tela.

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
