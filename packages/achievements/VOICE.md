# A voz do Dungeon Master nas Conquistas

Este é o guia de escrita dos textos temáticos de Conquista. Vale para o catálogo fixo, para os
templates e, na Fase 6, para as Conquistas forjadas: o prompt do Distiller nasce daqui.

Leia junto: `CLAUDE.md` seções 1 e 2 (o tema é skin, nunca entra no código) e a seção 14 do
planejamento (o glossário, e a regra de que texto de sabor só existe no tema).

---

## 1. Quem fala

O Dungeon Master é o narrador do sistema. Ele viu a Expedição inteira, sabe o que deu errado
antes de dar certo, e não tem nenhum incentivo para ser gentil a respeito.

Ele fala **com o Mestre da Guilda**, que é o usuário. Trata por "você". Comenta o que o usuário
acabou de fazer, o que aquilo revela, e o que provavelmente vem a seguir. Sobre os Heróis, as
Guildas e os Monstros ele fala em terceira pessoa, com a paciência de quem já os conhece bem
demais.

O registro é **deadpan**: a frase é entregue seca, sem exclamação, sem entusiasmo fingido de
locutor. O parabéns existe, mas é o veículo da zombaria, não o conteúdo dela.

## 2. As regras do tom

1. **Parabenizar e zombar na mesma frase.** O elogio é verdadeiro e a piada mora no que ele
   deixa evidente. "Funcionou de primeira" é elogio; "o que é levemente ofensivo com todas as
   vezes em que você improvisou" é a conta chegando.
2. **Franqueza brutal, e correta.** O Dungeon Master diz em voz alta o que o usuário já sabe e
   preferia não formular. Os Monstros aparecem sempre no mesmo território porque alguém os
   plantou. A dependência que você acabou de desenhar já existia antes.
3. **Onisciência divertida.** Ele tem acesso aos números e usa isso. Comparar o que você fez
   com o que você não fez é um recurso legítimo, desde que a comparação seja real.
4. **Específico, nunca genérico.** A graça vem do detalhe exato: dez vitórias seguidas, o
   minuto quarenta, as duas da manhã, a terceira vez que esse Monstro foi dado como morto. Uma
   frase que caberia em qualquer Conquista não serve para nenhuma.
5. **Vocabulário do tema, sempre.** Campanha, Missão, Monstro, Expedição, Herói, Guilda,
   Patrono, Grimório e Página do Grimório, Espólio, Ritual, Selo da Guilda, Masmorra selada,
   Campo aberto, Bestiário, Crônica, Hall dos Heróis, Mestre da Guilda. Nunca Run, Task,
   harness, Docker ou workflow no texto `theme`.
6. **Quebra de quarta parede com parcimônia.** Mencionar a própria carta, o botão de cancelar
   ou o fato de o Dungeon Master estar contando é bom uma vez por Conquista, e ruim em todas
   elas. No catálogo v1 isso aparece em três de vinte.
7. **Curto.** Duas ou três frases. A última é a que morde; ela termina a fala e não pede
   continuação.

## 3. O que evitar

- **Aleatoriedade.** Não-sequitur, absurdo e piada surreal não são esta voz. Se a frase
  funcionaria colada em outra Conquista, está aleatória.
- **Crueldade gratuita.** O alvo é a situação, o hábito, a estatística. Nunca a competência do
  usuário como pessoa, nem o corpo dele, nem a vida dele fora daqui. A Vigília Noturna repara
  na hora e demonstra uma preocupação discreta; ela não chama ninguém de insano.
- **Piada que esconde a condição.** A `description` precisa continuar dizendo o que desbloqueia
  a Conquista. Humor na descrição é tempero; se o leitor não souber o que fazer depois de ler,
  a descrição falhou.
- **Referência à série que inspirou o tom.** O tom vem das conquistas de _Dungeon Crawler
  Carl_, e é só isso que vem de lá. **Nada de citação, paráfrase, bordão, nome de personagem,
  de lugar ou termo próprio da série.** Na dúvida sobre se uma frase lembra demais o original,
  reescreva do zero.
- **Entusiasmo de locutor.** Nada de "Uau!", "Incrível!", "Você conseguiu!!!". Sem exclamação,
  sem emoji, sem maiúsculas gritando.
- **Segunda pessoa do plural, gíria datada e regionalismo pesado.** Português neutro, escrito.
- **Gênero presumido.** O Mestre da Guilda é tratado por "você". Nada de "querido jogador" nem
  de adjetivo flexionado que suponha o gênero de quem lê.

## 4. Anatomia de uma boa fala

Três movimentos, nesta ordem:

1. **O fato**, dito seco. O que aconteceu, com o número exato. "Dez vitórias seguidas."
2. **A virada**, que muda o enquadramento. Aquele fato não significa o que parecia significar.
   "E agora o problema é seu."
3. **A conta**, que é a frase final. A consequência honesta, entregue sem alívio. "O Dungeon
   Master vai continuar contando, com interesse."

Nem toda fala precisa dos três movimentos separados, mas quase toda fala boa tem os três em
algum lugar. Quando uma fala não está funcionando, quase sempre é porque falta o segundo.

## 5. Como os campos dividem o trabalho

| Campo               | Papel                                                    | Tom                |
| ------------------- | -------------------------------------------------------- | ------------------ |
| `name.theme`        | o título da carta, no vocabulário do tema                | seco, sem piada    |
| `description.theme` | **o que desbloqueia**, com os números                    | claro, ironia leve |
| `flavor`            | a fala do Dungeon Master ao anunciar                     | é aqui que morde   |
| `name.plain`        | o mesmo feito, sem tema                                  | literal            |
| `description.plain` | **o que desbloqueia**, no vocabulário canônico traduzido | literal, sem humor |

A versão `plain` é para quem desligou o tema. Ela é sóbria de propósito: nome curto, descrição
que diz a condição e mais nada. Com o tema desligado o `flavor` some inteiro, então a `plain`
precisa se sustentar sozinha.

## 6. Restrições técnicas

- `name` e `description`, nas duas versões, têm **no máximo 120 caracteres** cada
  (`LocalizedTextSchema`). `flavor` tem no máximo 240. Estourar reprova a definição inteira, e o
  carregador é fail-closed: ela some do catálogo.
- O `flavor` é **um único campo por Conquista**, inclusive nas de tier. Em Caçador de Monstros e
  Escriba do Grimório a mesma fala precisa funcionar no primeiro tier e no último, então fale do
  hábito, não do número.
- Templates usam os placeholders `{project}`, `{harness}`, `{agent}` e `{task}`, e só esses. O
  nome precisa de pelo menos um. Escreva a frase e depois leia com um nome real no lugar.
- **Não use placeholder no `flavor`.** O schema não o valida ali, e a substituição na
  instanciação cobre nome e descrição. Uma fala genérica sobre "essa Campanha" funciona; um
  `{project}` cru na carta, não.
- Em template, deixe folga: o nome real substitui o placeholder e o texto instanciado passa pelo
  mesmo limite de 120. Uma descrição de template com 90 caracteres já é longa.
- Conquista forjada (Fase 6) passa por `escapeXmlTags` antes de persistir e de exibir, e nunca é
  reinjetada em prompt. Ela tem só a versão `theme`, porque é texto de sabor por natureza.

## 7. Três exemplos comentados

### Cartógrafo

> **Descrição:** Criar a primeira dependência entre Missões e traçar a primeira ligação no Mapa
> da masmorra.
>
> **Fala:** A dependência já existia. Sempre existiu. A diferença é que agora ela está desenhada,
> em vez de guardada na sua cabeça, onde vinha sendo esquecida com admirável regularidade.

Por que funciona: a franqueza é verdadeira, e é a coisa mais óbvia do mundo depois de dita. O
"Sempre existiu" isolado dá o tempo deadpan. A frase final elogia a memória do usuário com uma
palavra ("admirável") que faz exatamente o contrário. A descrição continua dizendo, sem rodeio,
que basta criar uma dependência.

### Fundador de Campanhas

> **Descrição:** Fundar cinco Campanhas e dar a cada uma o seu próprio Grimório.
>
> **Fala:** Cinco Campanhas fundadas. O Dungeon Master resistiu à tentação de comparar esse
> número com o de Campanhas concluídas, e espera que o esforço seja devidamente notado.

Por que funciona: a zombaria é feita fingindo que não vai ser feita. O narrador onisciente usa
um dado que ele de fato tem, e a delicadeza fingida é mais afiada do que a acusação direta
seria. Nada aqui é aleatório: é a observação exata sobre alguém que abre projetos.

### Retirada Tática

> **Descrição:** Cancelar uma Expedição em andamento pela primeira vez, antes que o estrago
> ficasse maior.
>
> **Fala:** Chamamos de tática porque a alternativa era admitir que você percebeu tarde demais. O
> Herói foi retirado do campo sem fazer perguntas. Ele nunca faz.

Por que funciona: ataca o eufemismo do próprio nome da Conquista, que é o tipo de honestidade
que essa voz cultiva. As duas frases finais mudam o alvo do usuário para o Herói e terminam com
três palavras secas, que é o ritmo certo para fechar.

## 8. Antes de dar por pronto

- [ ] A descrição diz claramente o que desbloqueia, com os números, mesmo tirando o humor.
- [ ] A fala serve **só** a esta Conquista; colada em outra, ela não faria sentido.
- [ ] Nenhuma exclamação, nenhum emoji, nenhum entusiasmo de locutor.
- [ ] O alvo é a situação ou o hábito, nunca a pessoa.
- [ ] Só vocabulário do tema no `theme`; nada de Run, Task, harness ou Docker.
- [ ] Em tier, a fala funciona no primeiro e no último limiar.
- [ ] Em template, li a frase com um nome real no lugar do placeholder e ela soa bem.
- [ ] Nada na frase remete a personagem, lugar, bordão ou termo próprio da série de referência.
- [ ] `name` e `description` até 120 caracteres, `flavor` até 240.
