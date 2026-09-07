# A voz do Dungeon Master nas Conquistas

Este é o guia de escrita dos textos temáticos de Conquista. Vale para o catálogo fixo, para os
templates e, na Fase 6, para as Conquistas forjadas: o prompt do Distiller nasce daqui.

Leia junto: `CLAUDE.md` seções 1 e 2 (o tema é skin, nunca entra no código) e a seção 14 do
planejamento (o glossário, e a regra de que texto de sabor só existe no tema).

---

## 1. Quem fala

O Dungeon Master **não é um narrador de romance**. Ele é a administração da Guilda: o sujeito
que recebeu a papelada da sua Expedição, leu tudo, é obrigado por regulamento a te dar um
prêmio por isso, e não concorda com o regulamento.

Ele tem acesso a todos os seus números, inclusive aos que você preferia que ele não tivesse. Ele
te acha entretenimento. Ele entrega o prêmio com uma das mãos e, com a outra, anota exatamente
por que você não merecia. Nada disso é dito com raiva: é dito com o desinteresse de quem faz
isso o dia inteiro.

Ele fala **com o Mestre da Guilda**, que é o usuário, por "você", e diz na cara. Sobre Heróis,
Guildas e Monstros fala em terceira pessoa, como quem descreve equipamento.

O registro é **glib e burocrático**: seco, curto, com cheiro de formulário. Ata, registro,
protocolo, arquivo, homologação, lista de opções, consulta futura. O humor nasce do choque entre
essa linguagem de repartição e a bagunça real que ela está descrevendo.

## 2. As regras do tom

1. **O prêmio é entregue e desvalorizado no mesmo movimento.** Esta é a regra principal. A
   Conquista é real, a condição foi cumprida, e o Dungeon Master faz questão de lembrar que a
   barra era baixa, que a raridade é comum, ou que ele conferiu duas vezes porque não esperava.
2. **Registro de repartição.** Prefira o verbo administrativo ao verbo bonito. "Conste em ata",
   "arquivou o caso", "não constava na lista de opções", "homologado pela Guilda", "para consulta
   futura". É aqui que a voz vive.
3. **A leitura desfavorável, dita na cara.** Você não cancelou por estratégia, cancelou por
   pânico. Você não escolhe mais esse Herói, você o digita por reflexo. O alvo é o hábito, a
   decisão, o número. Direto, em segunda pessoa, sem amortecer.
4. **Um exagero, ancorado num fato verdadeiro.** A frase começa exata e termina um passo além:
   a sua cabeça é um meio de armazenamento homologado que perde dados quando você dorme; a carta
   nova fica constrangida ao lado das outras. O exagero só funciona porque a base é literal.
5. **Frases curtas. Fragmentos.** "Tática. Claro." / "Você carimbou. Está feito." / "Ele sabe.
   Ele conta com isso." O ponto final é a arma. Se a frase tem três orações subordinadas, ela
   está no tom errado.
6. **Meta sobre o próprio sistema de Conquistas, com moderação.** O Dungeon Master pode comentar
   que já redigiu o texto da sua próxima derrota, ou que esta Conquista é comum justamente
   porque a parte difícil vem depois. Bom uma vez a cada poucas cartas; insuportável em todas.
7. **Específico, nunca genérico.** Dez seguidas. O minuto quarenta. A terceira certidão de
   óbito. Sete meses. Uma frase que caberia em qualquer Conquista não serve para nenhuma.
8. **Vocabulário do tema, sempre.** Campanha, Missão, Monstro, Expedição, Herói, Guilda, Patrono,
   Grimório e Página do Grimório, Espólio, Ritual, Selo da Guilda, Masmorra selada, Campo aberto,
   Bestiário, Crônica, Hall dos Heróis, Mestre da Guilda. Nunca Run, Task, harness, Docker ou
   workflow no texto `theme`.

## 3. O que evitar

- **Lirismo. Este é o erro mais provável.** A primeira versão deste catálogo errou exatamente
  aqui: ficou uma ironia literária, contemplativa, bem-educada, com frases longas e imagens
  bonitas. "Cera quente, um carimbo, e a responsabilidade mudando silenciosamente de mãos" é
  bom texto e é a voz errada. Se a frase caberia num romance, reescreva.
- **Ironia de salão.** Fingir delicadeza para ser mais afiado ("o Dungeon Master resistiu à
  tentação de comparar") é um recurso de outro registro. Aqui ele não resiste: ele diz que tem
  o número na tela e que vai se comportar, o que é pior.
- **Aleatoriedade.** Não-sequitur e surrealismo puro não são esta voz. O exagero da regra 4 sai
  sempre de um fato real da Conquista. Se a frase funcionaria colada em outra carta, está solta.
- **Crueldade sobre a pessoa.** O alvo é o hábito, a decisão e a estatística, e nisso pode ser
  direto e sem panos quentes. Fora do alvo: a inteligência ou o valor do usuário, o corpo dele,
  a saúde dele, a vida dele fora daqui. A Vigília Noturna registra a hora, diz que não recomenda
  e se recusa a perguntar quantas vezes já aconteceu. Ela não diagnostica ninguém.
- **Piada que esconde a condição.** A `description` precisa continuar dizendo o que desbloqueia
  a Conquista. Humor na descrição é tempero; se o leitor não souber o que fazer depois de ler,
  a descrição falhou.
- **Entusiasmo de locutor.** Nada de "Uau!", "Incrível!", "Você conseguiu!!!". Sem exclamação,
  sem emoji, sem maiúsculas gritando. O "parabéns" aparece seco, e sempre a serviço da zombaria.
- **Gênero presumido.** O Mestre da Guilda é tratado por "você". Nada de vocativo com gênero nem
  de adjetivo flexionado que suponha o gênero de quem lê.

## 4. Propriedade intelectual: tom sim, mundo não

A referência declarada do usuário são as conquistas da série _Dungeon Crawler Carl_. **O que vem
de lá é exclusivamente o registro cômico**: o anúncio glib, o prêmio desvalorizado, a franqueza
administrativa, o tempo curto da piada.

O que **não** vem de lá, e é proibido:

- citação, paráfrase, bordão, título de conquista, nome de personagem, de lugar ou termo próprio;
- a premissa da série. Nada de plateia assistindo, audiência, patrocinador, transmissão, prêmio
  comercial, nem de uma entidade narradora com nome próprio. Isso é o **mundo** daquela obra,
  não o tom dela. O nosso mundo é uma Guilda, e quem fala é o Dungeon Master.

Na dúvida sobre se uma frase lembra demais o original, reescreva do zero. O teste é simples: se
a graça depende de o leitor conhecer a série, está errada.

## 5. Anatomia de uma boa fala

Três movimentos:

1. **O fato, seco.** Curto, com o número exato. "Cinco Campanhas abertas." / "Você já matou esse
   Monstro. Duas vezes."
2. **A leitura desfavorável.** O que aquele fato realmente diz sobre você, sem eufemismo. "O
   registro diz Retirada Tática porque Pânico Administrativo não constava na lista de opções."
3. **O desmonte.** A última frase, que desvaloriza o prêmio, escala para o exagero ancorado, ou
   comenta o próprio sistema. É a mais curta das três. "A sua." / "Você vai gostar." / "O Dungeon
   Master viu."

Quando uma fala não está funcionando, quase sempre é porque o terceiro movimento ficou longo,
explicativo ou gentil.

## 6. Como os campos dividem o trabalho

| Campo               | Papel                                          | Tom                       |
| ------------------- | ---------------------------------------------- | ------------------------- |
| `name.theme`        | o título da carta, no vocabulário do tema      | seco, sem piada           |
| `description.theme` | **o que desbloqueia**, com os números          | claro, com uma alfinetada |
| `flavor`            | o anúncio do Dungeon Master                    | é aqui que morde          |
| `name.plain`        | o mesmo feito, sem tema                        | literal                   |
| `description.plain` | **o que desbloqueia**, no vocabulário canônico | literal, sem humor        |

A versão `plain` é para quem desligou o tema. Ela é sóbria de propósito: nome curto, descrição
que diz a condição e mais nada. Com o tema desligado o `flavor` some inteiro, então a `plain`
precisa se sustentar sozinha.

## 7. Restrições técnicas

- `name` e `description`, nas duas versões, têm **no máximo 120 caracteres** cada
  (`LocalizedTextSchema`). `flavor` tem no máximo 240. Estourar reprova a definição inteira, e o
  carregador é fail-closed: ela some do catálogo.
- O `flavor` é **um único campo por Conquista**, inclusive nas de tier. Em Caçador de Monstros e
  Escriba do Grimório a mesma fala precisa funcionar no primeiro tier e no último, então fale do
  hábito, não do número.
- Templates usam os placeholders `{project}`, `{harness}`, `{agent}` e `{task}`, e só esses. O
  nome precisa de pelo menos um. Escreva a frase e depois leia com um nome real no lugar.
- **Não use placeholder no `flavor`.** O schema não o valida ali, e a substituição na
  instanciação cobre nome e descrição. Uma fala genérica sobre "esta Campanha" funciona; um
  `{project}` cru na carta, não.
- Em template, deixe folga: o nome real substitui o placeholder e o texto instanciado passa pelo
  mesmo limite de 120. Uma descrição de template com 90 caracteres já é longa.
- Conquista forjada (Fase 6) passa por `escapeXmlTags` antes de persistir e de exibir, e nunca é
  reinjetada em prompt. Ela tem só a versão `theme`, porque é texto de sabor por natureza.

## 8. Calibração: a mesma Conquista, errada e certa

Os três pares abaixo são reais: a coluna da esquerda saiu da primeira versão deste catálogo e
foi rejeitada por tom.

**Selo da Guilda**

> Errado: Cera quente, um carimbo, e a responsabilidade mudando silenciosamente de mãos. O Herói
> executou, você aprovou. A Crônica guarda os dois nomes, mas só um deles perde o sono.
>
> Certo: Você carimbou. Está feito. Daqui em diante, se algo desandar, o registro mostra um Herói
> que executou e um nome que autorizou, e não é o do Herói que aparece em negrito.

O errado é bonito e melancólico, e abre com uma imagem sensorial. O certo abre com dois
fragmentos, troca "Crônica" por "registro", e termina numa consequência administrativa concreta.

**Fundador de Campanhas**

> Errado: Cinco Campanhas fundadas. O Dungeon Master resistiu à tentação de comparar esse número
> com o de Campanhas concluídas, e espera que o esforço seja devidamente notado.
>
> Certo: Cinco Campanhas abertas. O Dungeon Master tem o número de Campanhas concluídas bem aqui,
> na mesma tela, e vai se comportar. Fundar é a parte fácil. É exatamente por isso que esta
> Conquista é comum.

O errado usa delicadeza fingida, que é ironia de salão. O certo mostra que ele está com o dado
aberto na frente, não desiste de nada, e ainda desvaloriza o prêmio pela própria raridade.

**Cartógrafo**

> Errado: A dependência já existia. Sempre existiu. A diferença é que agora ela está desenhada,
> em vez de guardada na sua cabeça, onde vinha sendo esquecida com admirável regularidade.
>
> Certo: Você desenhou uma ligação que já existia há meses. Ela estava guardada na sua cabeça,
> que é o pior meio de armazenamento já homologado pela Guilda, e que perde dados toda vez que
> você dorme.

Os dois dizem a mesma verdade. O errado a entrega como observação contemplativa; o certo a
entrega como parecer técnico sobre um equipamento defeituoso, que é você.

## 9. Antes de dar por pronto

- [ ] A descrição diz claramente o que desbloqueia, com os números, mesmo tirando o humor.
- [ ] A fala entrega o prêmio e o desvaloriza; não é só uma observação espirituosa.
- [ ] Tem pelo menos um fragmento ou frase de menos de cinco palavras.
- [ ] A última frase é a mais curta e não explica a piada.
- [ ] Nenhuma imagem lírica, nenhuma delicadeza fingida, nenhuma frase que caberia num romance.
- [ ] O alvo é o hábito ou a decisão, nunca a pessoa, o corpo ou a saúde.
- [ ] A fala serve **só** a esta Conquista; colada em outra, não faria sentido.
- [ ] Só vocabulário do tema no `theme`; nada de Run, Task, harness ou Docker.
- [ ] Em tier, a fala funciona no primeiro e no último limiar.
- [ ] Em template, li a frase com um nome real no lugar do placeholder e ela soa bem.
- [ ] Nada remete a personagem, lugar, bordão, termo próprio ou à premissa da série de referência.
- [ ] `name` e `description` até 120 caracteres, `flavor` até 240.
