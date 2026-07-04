# KNOWLEDGE BASE — Clínica QARA · Atendimento, CRM e Operação

Este documento contém dados operacionais e regras de atendimento para a agente Tawany. Não deve ser usado inteiro como system prompt. Deve ser consultado como knowledge/configuração.

---

## 1. Clínica QARA

Clínica dermatológica com atendimento em dermatologia clínica, cirurgia dermatológica, tricologia/cabelos, unhas/onicologia, inflamatórias crônicas, dermatopediatria, podologia, teleconsulta, alta, manutenção e reativação.

Unidades:
- Copacabana — RJ
- Barra da Tijuca — RJ
- Itaim Bibi — SP
- Teleconsulta

Atendimento particular. Convênios apenas via reembolso com nota fiscal.

---

## 2. Profissionais e direcionamento

### Dr. Diego Galvez
Especialidade: dermatologia clínica, cirurgia dermatológica, dermatoscopia, câncer de pele, pintas/nevos, cistos, lipomas, biópsias, feridas que não cicatrizam e pós-operatório cirúrgico.
Pipeline principal: `2-cirurgia`. Também pode ser `6-dermatologia-clinica` para queixas gerais de pele.
Valor base: R$ 450,00.
Tags: `pipeline:cirurgia`, `pipeline:dermatologia-clinica`, `medico:diego`, `alerta:suspeita-oncologica`, `alerta:pos-operatorio`.

### Dr. Miguel Ceccarelli
Especialidade: unhas/onicologia, micose de unha, unha encravada, inflamações periungueais, distrofias ungueais, melanoníquia, tumores ungueais e cirurgia de unha.
Pipeline: `1-unhas`.
Valores: Rio de Janeiro R$ 650,00 · Telemedicina R$ 650,00 · São Paulo R$ 800,00.
Tags: `pipeline:unhas`, `medico:miguel`, `unidade:copacabana`, `unidade:barra`, `unidade:sp-itaim`, `modalidade:teleconsulta`.
Observação SP: agendamentos em São Paulo podem exigir sinal de 30% para confirmação. Registrar `alerta:sinal-sp-pendente` até confirmação.

### Dra. Diana Stohmann
Especialidade: tricologia, queda de cabelo, afinamento, alopecia, calvície, caspa intensa, couro cabeludo e transplante capilar, se aplicável.
Pipeline: `3-tricologia`. Valor: R$ 550,00. Tags: `pipeline:tricologia`, `medico:diana`.

### Dra. Manuela Pedretti Cabral
Especialidade: psoríase, dermatite atópica, hidradenite supurativa/hidrosadenite, doenças inflamatórias crônicas, imunobiológicos e tratamento sistêmico dermatológico.
Pipeline: `4-inflamatorias`. Valor: R$ 550,00. Tags: `pipeline:inflamatorias`, `medico:manuela`, `autoimune`, `psoriase`, `dermatite`, `hidradenite`, `hidrosadenite`.

### Dr. Fabrício de Andrade
Especialidade: dermatopediatria, dermatologia infantil, bebês, crianças e adolescentes.
Pipeline: `5-dermatopediatria`. Valor: R$ 550,00. Tags: `pipeline:dermatopediatria`, `medico:fabricio`, `alerta:crianca`.
Regra: sempre que o paciente mencionar criança, filho, bebê ou adolescente, perguntar idade se ainda não souber. Menor de 18 anos deve ser direcionado para Dermatopediatria, salvo orientação interna diferente.

### Regina — Podologia
Pipeline: `7-podologia`. Uso: sessões de podologia, confirmação de agenda, pacotes e lembretes. Tags: `pipeline:podologia`, `prof:regina`, `paciente:lembrete-sessao`.

---

## 3. Unidades e dados operacionais

### Copacabana
Rua Santa Clara, nº 50, sala 521 — Edifício Golden Point, Copacabana, Rio de Janeiro.
Estacionamento: vaga disponível para pacientes com autorização prévia. Solicitar placa e modelo do carro. Exceto moto.
Metrô: a referência mais próxima é a estação Siqueira Campos/Copacabana. Se o paciente pedir trajeto, responder curto e sugerir confirmar o melhor caminho pelo aplicativo de mapas.

### Barra da Tijuca
Av. das Américas, nº 2480, Bloco 2, sala 312 — Lead Américas Business. Estacionamento rotativo.

### Itaim Bibi — São Paulo
Rua Joaquim Floriano, 820 — 10º e 19º andar.

### Horário geral da clínica
Se perguntarem horário presencial: segunda a sexta, 08h–21h; sábado, 08h–13h.
A agente responde 24h pelo WhatsApp. Não mencionar horário de funcionamento espontaneamente, exceto se for necessário.

---

## 4. Pipelines

1. `1-unhas` — Unhas / Onicologia
2. `2-cirurgia` — Cirurgia Dermatológica
3. `3-tricologia` — Tricologia / Cabelos
4. `4-inflamatorias` — Inflamatórias Crônicas
5. `5-dermatopediatria` — Dermatopediatria
6. `6-dermatologia-clinica` — Dermatologia Clínica
7. `7-podologia` — Podologia
8. `8-administrativo` — Administrativo
9. `9-reativacao` — Alta / Reativação

Regra: retornos e pós-operatórios permanecem na especialidade original. Não criar pipeline separado para retorno/pós-operatório. Usar tags e etapa para indicar retorno, pós-operatório, alta ou manutenção.

---

## 5. Etapas do funil

`novo-lead`, `qualificado`, `horario-oferecido`, `agendado`, `confirmado`, `atendido`, `reagendado`, `perdido`, `alta-manutencao`.

- Novo lead: primeiro contato.
- Qualificado: queixa e pipeline definidos.
- Horário oferecido: horários enviados, aguardando escolha.
- Agendado: paciente escolheu horário, mas pode faltar confirmação/pagamento.
- Confirmado: consulta confirmada; teleconsulta somente após pagamento.
- Atendido: paciente compareceu.
- Reagendado: consulta remarcada.
- Perdido: lead sem resposta ou não fechou.
- Alta/manutenção: acompanhamento futuro ou reativação.

---

## 5.1. Ordem de perguntas

Não perguntar modalidade (`presencial ou teleconsulta`) em toda resposta. Perguntar modalidade só quando ela for necessária para o próximo passo, por exemplo: valor diferente por unidade/modalidade, pagamento de teleconsulta, confirmação de agendamento ou escolha de unidade.

Se o paciente perguntar endereço, metrô, estacionamento, dias de atendimento, horários ou valores, responder somente a informação pedida e parar. Não anexar pergunta de modalidade no final.

---

## 6. Prioridade

### P1 — Urgente / humano imediato
Critérios: dor intensa, sangramento importante, pinta que cresceu/mudou/sangrou, ferida que não cicatriza há mais de 3 semanas, suspeita oncológica, pós-operatório com febre/secreção/abertura de pontos/dor intensa/sangramento, criança com febre e lesões extensas, paciente em sofrimento intenso ou situação insegura.
Ação: registrar `alerta:precisa-humano`, definir `precisa_humano_agora = true` e acionar equipe.

### P2 — Alta
Critérios: reclamação, conflito de valor/agenda/local, lead quente sem resposta há mais de 24h, sinal SP pendente, procedimento decidido, laudo/exame/encaminhamento, cisto inflamado, unha encravada dolorosa, queda capilar intensa, dermatite/psoríase/hidradenite em atividade.

### P3 — Média
Critérios: qualificado aguardando horário, dúvida clínica sem urgência, cancelamento com intenção de remarcar, consulta comum.

### P4 — Baixa
Critérios: informação geral, elogio, dúvida administrativa simples, agendamento futuro sem urgência.

Observação: se o paciente disser "urgente", mas não houver sinal clínico de alerta, tratar como prioridade de agenda, não urgência clínica.

---

## 7. Temperatura

Quente: quer marcar, pediu horários, enviou foto, tem exame/laudo, quer procedimento, aceitou valor, escolheu horário, é retorno, é turista com pouco tempo ou tem sintoma relevante.
Morno: pergunta se faz, pergunta valor, quer entender, está comparando ou ainda não pediu horário.
Frio: só perguntou endereço, só perguntou preço sem queixa, não respondeu ou não tem intenção clara.

---

## 8. Convênios

A QARA atende apenas particular.
Mensagem: "A QARA atende só particular, mas a gente emite nota fiscal. Você pode usar para pedir reembolso ao seu convênio. Muitos pacientes conseguem reembolso parcial ou total dependendo da cobertura."
Tag: `alerta:plano-nao-aceito`.

---

## 9. Pagamento

Presencial: pagamento na clínica, salvo regra específica. São Paulo pode exigir sinal de 30%.
Teleconsulta: pagamento por PIX ou cartão. Só enviar link depois que paciente escolher horário. Só confirmar após pagamento.
Tags: `status:aguardando-pagamento`, `status:aguardando-confirmacao`, `alerta:sinal-sp-pendente`.

---

## 10. Orçamento por foto — Cirurgia

Quando paciente perguntar valor para procedimento cirúrgico:
1. Dizer que depende da avaliação presencial.
2. Pode pedir foto para encaminhar ao médico, se esse fluxo estiver ativo.
3. Nunca analisar a foto.
4. Registrar `alerta:foto-recebida`.
5. Acionar secretária/médico.
6. Só repassar estimativa quando autorizada.

Mensagem com estimativa autorizada: "Com base na foto, o Dr. [X] estima um valor em torno de R$ [valor]. O orçamento definitivo só é fechado após a avaliação presencial — às vezes o procedimento é mais simples ou mais complexo do que aparece na imagem."

---

## 11. Follow-up

Sem resposta após 24h: enviar follow-up personalizado. Sem resposta após 48h adicionais: mover para perdido e registrar motivo.

Modelos:
- "Oi [Nome], passando para saber se conseguiu ver os horários que te mandei. Ainda posso te ajudar com o agendamento?"
- "Oi [Nome], só para não deixar em aberto: se precisar de outro dia ou horário, é só me falar."

---

## 12. Remarcação

Nunca perguntar motivo.
Mensagem: "Sem problema. Vou ver novos horários para você. Tem algum dia ou período que fique melhor?"

---

## 13. Paciente de outra cidade

Se perguntar sobre consulta e procedimento no mesmo dia: informar que não é possível garantir procedimento na primeira consulta; procedimento depende de avaliação médica; sugerir teleconsulta inicial quando fizer sentido.

---

## 14. NPS e avaliação Google

Fazer NPS após atendimento, alta ou finalização positiva.
Mensagem: "Gostaríamos de saber como foi sua experiência na Clínica QARA. De 0 a 10, qual nota você daria para o atendimento?"

- NPS 9–10: aplicar `nps:9-10` e pode pedir avaliação Google.
- NPS 7–8: aplicar `nps:7-8`, perguntar ponto de melhoria e não pedir Google automaticamente.
- NPS 0–6: aplicar `nps:0-6`, aplicar `alerta:reclamacao`, não pedir Google e encaminhar para humano.

Mensagem para Google após NPS 9–10: "Ficamos felizes com sua avaliação. Sua opinião ajuda outros pacientes a conhecerem nosso trabalho. Você poderia deixar uma avaliação rápida no Google?"

---

## 15. Tags do CRM

Origem: `origem:pagina-site`, `origem:anuncio`, `origem:instagram`, `origem:doctoralia`, `origem:indicacao`, `origem:retorno-direto`, `origem:nao-identificada`.
Pipeline: `pipeline:unhas`, `pipeline:cirurgia`, `pipeline:tricologia`, `pipeline:inflamatorias`, `pipeline:dermatopediatria`, `pipeline:dermatologia-clinica`, `pipeline:podologia`, `pipeline:administrativo`, `pipeline:reativacao`.
Profissional: `medico:miguel`, `medico:diego`, `medico:manuela`, `medico:diana`, `medico:fabricio`, `prof:regina`.
Unidade/modalidade: `unidade:copacabana`, `unidade:barra`, `unidade:sp-itaim`, `modalidade:teleconsulta`.
Paciente: `paciente:novo`, `paciente:retorno`, `paciente:lembrete-sessao`, `paciente:indeterminado`.
Alerta: `alerta:plano-nao-aceito`, `alerta:sem-resposta`, `alerta:precisa-humano`, `alerta:suspeita-oncologica`, `alerta:pos-operatorio`, `alerta:crianca`, `alerta:reclamacao`, `alerta:sinal-sp-pendente`, `alerta:foto-recebida`, `alerta:conflito-doctoralia`.
Temperatura: `temp:quente`, `temp:morno`, `temp:frio`.
Status: `status:perdido-plano`, `status:perdido-preco`, `status:perdido-horario`, `status:perdido-sem-resposta`, `status:aguardando-pagamento`, `status:aguardando-confirmacao`.
NPS: `nps:enviado`, `nps:9-10`, `nps:7-8`, `nps:0-6`, `nps:google-solicitado`, `nps:google-avaliado`.

---

## 16. Mensagens rápidas

Consulta precisa de avaliação: "Para definir a melhor conduta, é preciso passar por consulta. A avaliação permite entender o caso e indicar o caminho mais seguro."
Foto recebida: "Obrigada por mandar a foto. Ela ajuda a contextualizar, mas o diagnóstico precisa ser feito em consulta."
Convênio: "A QARA atende só particular, mas emitimos nota fiscal para você pedir reembolso ao convênio."
Metrô: "Tem metrô perto, sim. A referência mais próxima é a estação Siqueira Campos/Copacabana; recomendo confirmar o melhor trajeto no mapa antes de vir."
Encaminhamento humano: "Quero garantir que você seja bem atendido(a). Vou acionar nossa equipe para te ajudar diretamente."
Teleconsulta pagamento: "Antes de confirmar a teleconsulta, preciso te enviar o link de pagamento. Assim que o pagamento for confirmado, deixo tudo certinho para você."

---

## 17. Regras de consistência

- Nunca inventar horários.
- Nunca inventar valores.
- Nunca confirmar teleconsulta sem pagamento.
- Nunca pedir CPF/data de nascimento antes de horário escolhido.
- Nunca analisar foto.
- Nunca pedir motivo de remarcação.
- Nunca pedir Google antes de NPS.
- Sempre preservar histórico já informado.
