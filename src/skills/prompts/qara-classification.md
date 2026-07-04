# Regras de Classificação — Clínica QARA

Regras para qualificar leads: intenção (`intent` no lead), prioridade, temperatura e gatilhos de handoff.

## Direcionamento por queixa → intent + médico

| Intent (CRM) | Médico | Palavras-chave |
|---|---|---|
| `UNHAS` | Dr. Miguel Ceccarelli | unha(s), micose de unha, unha encravada, onicomicose, melanoníquia, mancha escura na unha, inflamação na unha, granuloma, paroníquia, distrofia ungueal |
| `CIRURGIA` | Dr. Diego Galvez | pinta, sinal, nevo, cisto, lipoma, biópsia, câncer de pele, cbc, cec, melanoma, ferida que não cicatriza, retirar/retirada de lesão, cirurgia dermatológica, verruga para tirar, blefaroplastia |
| `TRICOLOGIA` | Dra. Diana Stohmann | queda de cabelo, cabelo caindo, calvície, alopecia, afinamento, falhas no cabelo, couro cabeludo, caspa, tricologia |
| `AUTOIMUNE` | Dra. Manuela Pedretti Cabral | psoríase, dermatite atópica, hidradenite, hidrosadenite, imunobiológico, autoimune, doença inflamatória |
| `DERMATOPEDIATRIA` | Dr. Fabrício de Andrade | filho(a), criança, bebê, adolescente, dermatopediatria, dermatologia infantil, assadura, molusco, verruga infantil |
| `OUTRO` (dermatologia clínica) | Dr. Diego Galvez | acne, mancha(s), melasma, rosácea, alergia, coceira, micose, verruga, herpes, pele, dermatite de contato |

Regra criança: sempre que mencionar criança/filho/bebê/adolescente, perguntar idade se ainda não souber. Menor de 18 anos → Dermatopediatria.

## P1 — Urgência (handoffToHuman imediato)

sangrando muito, sangramento importante, dor intensa, febre, secreção, abriu os pontos, pinta cresceu/mudou/sangrou, ferida que não cicatriza, melanoma, câncer de pele, pós-operatório com complicação, criança com febre e lesões extensas.

## Administrativo (responder e parar, sem qualificar)

endereço, valor, preço, convênio, reembolso, nota fiscal, horário de funcionamento, cancelar, remarcar, comprovante, metrô, estacionamento, garagem.

## Temperatura → score e tags

- **Quente** (score 75-100, tag `LEAD_QUENTE`): quer marcar, pediu horários, enviou foto, tem exame/laudo, quer procedimento, aceitou valor, escolheu horário, é retorno, turista com pouco tempo, sintoma relevante.
- **Morno** (score 40-74): pergunta se faz, pergunta valor, quer entender, está comparando, ainda não pediu horário.
- **Frio** (score 0-39, tag `LEAD_FRIO`): só perguntou endereço, só preço sem queixa, sem resposta, sem intenção clara.

## Regras obrigatórias

1. Se P1 → `handoffToHuman` imediato.
2. Se apenas administrativo → responder a informação e parar; não puxar qualificação.
3. Se criança/adolescente → perguntar idade se ainda não souber.
4. Se foto recebida → não analisar; agradecer e direcionar.
5. Se teleconsulta → confirmar somente após pagamento.
6. Se valor de procedimento → orçamento final depende de avaliação.
7. Se retorno/pós-operatório → manter a especialidade original.
8. Atualize `updateLead` com score/intent quando a classificação mudar; registre a razão em `notes`.
