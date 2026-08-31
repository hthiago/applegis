# Maquetes de leiaute

Três propostas de superfície para a mesma tela — *Orçamento › Por município* —, com
os dados de verdade do gabinete. **Nenhuma está aplicada no sistema.** São arquivos
estáticos, autocontidos, para abrir no navegador e comparar lado a lado:

```bash
python3 -m http.server 8080     # e abra /teste/leiautes/a-impresso.html
```

Existem porque a primeira tentativa de redesenho trocou a pele e manteve o desenho:
o gabinete olhou e disse que continuava com "fundo cinza e caixas genéricas". Discutir
leiaute por descrição não funciona — precisa ser olhando.

| Arquivo | Proposta | A ideia |
| --- | --- | --- |
| `a-impresso.html` | **Impresso institucional** | A área de trabalho vira uma folha branca com contorno, sobre margem cinza: o cinza deixa de ser fundo do conteúdo e passa a ser mesa. Títulos e valores em serifa do sistema (Georgia — sem custo de rede). Busca com filete no lugar de caixa. |
| `b-produto.html` | **Produto, branco e alto contraste** | Branco de ponta a ponta, sem cinza atrás de nada. O caráter vem do peso tipográfico. Traz uma coluna nova, *Execução*, com barra proporcional — informação que a pílula de status nunca deu. |
| `c-brasao.html` | **Cabeçalho institucional** | O azul sai do detalhe e vira faixa no topo, com selo, identificação do mandato e as áreas dentro dela. Cabeçalho de tabela sólido, linhas zebradas. |

As três compartilham duas decisões, que são o diagnóstico do que estava genérico:

- **Nada de pílula para situação.** Vinte retângulos arredondados cinza descendo pela
  direita é o componente mais reconhecível de template pronto, e ele não diz mais do que
  a palavra sozinha diria. Vira ponto colorido com a palavra ao lado.
- **Fundo cinza não fica atrás de texto.** Ou o conteúdo está sobre papel branco, ou o
  cinza é margem em volta de uma folha — nunca o plano em que o texto se apoia.
