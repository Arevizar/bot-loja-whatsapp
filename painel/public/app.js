const $conteudo = document.getElementById('conteudo');
const $aviso = document.getElementById('aviso');
let csrf = null;

function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [chave, valor] of Object.entries(props ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'class') el.className = valor;
    else if (chave.startsWith('on')) el.addEventListener(chave.slice(2), valor);
    else if (valor === true) el.setAttribute(chave, '');
    else el.setAttribute(chave, String(valor));
  }
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false) continue;
    el.append(filho instanceof Node ? filho : String(filho));
  }
  return el;
}

function colocar(alvo, ...filhos) {
  alvo.replaceChildren(...filhos.flat(Infinity).filter(f => f !== null && f !== undefined && f !== false));
}

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = new Intl.NumberFormat('pt-BR');

function dataHora(texto) {
  if (!texto) return '—';
  const [data, hora] = texto.split(' ');
  const [ano, mes, dia] = data.split('-');
  const doAnoAtual = ano === String(new Date().getFullYear());
  return `${dia}/${mes}${doAnoAtual ? '' : '/' + ano} ${hora.slice(0, 5)}`;
}

const dataCurta = (iso) => iso.split('-').reverse().join('/');

function dataPorExtenso(iso) {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`));
}

function isoLocal(data) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

const soLeitor = (texto) => h('span', { class: 'so-leitor' }, texto);
const ticket = (n) => h('span', { class: 'ticket' }, soLeitor('ticket '), n);
const plural = (n, um, varios) => `${numero.format(n)} ${n === 1 ? um : varios}`;

function chipSituacao(situacao) {
  if (situacao === 'esgotado') return h('span', { class: 'chip chip-esgotado' }, 'Esgotado');
  if (situacao === 'acabando') return h('span', { class: 'chip chip-acabando' }, 'Acabando');
  return null;
}

const CLASSE_STATUS = {
  pago: 'chip-pago',
  pagamento_recusado: 'chip-recusado',
  aguardando_confirmacao_dono: 'chip-atencao',
  aguardando_frete_manual: 'chip-atencao',
};

function avisar(texto) {
  $aviso.textContent = texto;
  $aviso.hidden = false;
  clearTimeout(avisar.timer);
  avisar.timer = setTimeout(() => { $aviso.hidden = true; }, 6000);
}

async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const opcoes = { method: metodo, credentials: 'same-origin', headers: {} };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.headers['X-CSRF-Token'] = csrf;
    opcoes.body = JSON.stringify(corpo);
  }
  let resposta;
  try {
    resposta = await fetch(`/api${caminho}`, opcoes);
  } catch {
    throw new Error('Sem conexão com o painel. Confira se ele está ligado no computador da loja.');
  }
  if (resposta.status === 401) {
    window.location.replace('/entrar');
    throw new Error('Sua sessão terminou.');
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.mensagem || 'Não deu certo. Tente de novo.');
  return dados;
}

function tabela({ colunas, linhas, classe = '', vazio = 'Nada por aqui.' }) {
  if (!linhas.length) return h('p', { class: 'vazio' }, vazio);
  return h('div', { class: 'tabela-rolagem' },
    h('table', { class: `tabela ${classe}` },
      h('thead', {}, h('tr', {}, colunas.map(c => h('th', { scope: 'col', class: c.classe }, c.titulo)))),
      h('tbody', {}, linhas.map(linha => h('tr', { class: linha.classe },
        colunas.map((c, i) => h('td', { class: c.classe, 'data-rotulo': c.rotulo ?? c.titulo }, h('span', { class: 'celula' }, linha.celulas[i])))
      ))),
    ),
  );
}

function figura(rotulo, valor, detalhe, destaque = false) {
  return h('div', { class: `figura${destaque ? ' figura-destaque' : ''}` },
    h('dt', {}, rotulo),
    h('dd', {}, h('span', { class: 'figura-valor' }, valor), detalhe ? h('span', { class: 'figura-detalhe' }, detalhe) : null),
  );
}

function celulaMovimento(m) {
  const entrada = m.tipo === 'entrada';
  return h('span', { class: `movimento ${entrada ? 'mov-entrada' : 'mov-saida'}` },
    soLeitor(entrada ? 'entrada de ' : 'saída de '),
    h('span', { 'aria-hidden': 'true' }, entrada ? '+' : '−'),
    numero.format(m.quantidade),
  );
}

function detalheMovimento(m) {
  return [
    m.pedido ? h('span', { class: 'detalhe-pedido' }, `Pedido nº ${m.pedido}`) : null,
    m.observacao ? h('span', { class: 'detalhe-obs' }, m.observacao) : null,
  ];
}

function tabelaMovimentos(movimentos, { vazio = 'Nenhum movimento ainda.', mostrarProduto = true } = {}) {
  const colunas = [
    { titulo: 'Quando', classe: 'col-quando' },
    ...(mostrarProduto ? [{ titulo: 'Produto', classe: 'col-produto' }] : []),
    { titulo: 'Movimento', classe: 'num col-movimento' },
    { titulo: 'Ficou', rotulo: 'Ficou com', classe: 'num col-ficou' },
    { titulo: 'Motivo', classe: 'col-motivo' },
    { titulo: 'Quem', classe: 'col-quem' },
    { titulo: 'Detalhe', classe: 'col-detalhe' },
  ];
  return tabela({
    colunas,
    vazio,
    classe: `tabela-movimentos${mostrarProduto ? '' : ' sem-produto'}`,
    linhas: movimentos.map(m => ({
      celulas: [
        dataHora(m.quando),
        ...(mostrarProduto ? [[ticket(m.ticket), ' ', m.sabor]] : []),
        celulaMovimento(m),
        numero.format(m.saldo),
        m.motivoTexto,
        m.quem,
        detalheMovimento(m),
      ],
    })),
  });
}

async function telaInicio() {
  const r = await api('/resumo');

  const atencao = [];
  for (const p of r.pedidosEmAberto) {
    if (p.status === 'aguardando_confirmacao_dono') {
      atencao.push(h('li', {},
        h('strong', {}, `Pedido nº ${p.id}: pagamento a conferir`), ` (${moeda.format(p.total)}, ${p.cliente || p.telefone}). `,
        h('span', { class: 'texto-suave' }, `No WhatsApp do dono: confirmar ${p.id} ou recusar ${p.id}`)));
    } else if (p.status === 'aguardando_frete_manual') {
      atencao.push(h('li', {},
        h('strong', {}, `Pedido nº ${p.id}: frete a calcular`), ` (${p.cliente || p.telefone}). `,
        h('span', { class: 'texto-suave' }, `No WhatsApp do dono: frete ${p.id} [valor]`)));
    }
  }
  const esperandoPagamento = r.pedidosEmAberto.filter(p => p.status === 'aguardando_pagamento').length;
  if (esperandoPagamento) {
    atencao.push(h('li', {}, `${plural(esperandoPagamento, 'pedido esperando', 'pedidos esperando')} o cliente pagar.`));
  }
  if (r.esgotados.length) {
    atencao.push(h('li', {}, h('strong', {}, 'Esgotado: '), r.esgotados.map(p => p.sabor).join(', ')));
  }
  if (r.acabando.length) {
    atencao.push(h('li', {}, h('strong', {}, 'Acabando: '), r.acabando.map(p => `${p.sabor} (${p.quantidade})`).join(', ')));
  }

  return h('div', { class: 'tela' },
    h('div', { class: 'cabecalho-tela' },
      h('h1', {}, dataPorExtenso(r.hoje)),
      h('p', { class: 'texto-suave' }, `Atualizado às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`),
    ),
    r.historicoConfere ? null : h('p', { class: 'alerta', role: 'alert' },
      'O histórico não está batendo com o estoque em algum produto. Avise o Ravi antes de dar novas baixas.'),
    h('dl', { class: 'figuras' },
      figura('Vendido hoje', moeda.format(r.vendasHoje.total), plural(r.vendasHoje.pedidosPagos, 'pedido pago', 'pedidos pagos'), true),
      figura('Neste mês', moeda.format(r.vendasMes.total), plural(r.vendasMes.pedidosPagos, 'pedido pago', 'pedidos pagos')),
      figura('Em estoque', plural(r.unidadesEmEstoque, 'unidade', 'unidades'),
        r.esgotados.length ? plural(r.esgotados.length, 'produto esgotado', 'produtos esgotados') : 'Nenhum produto esgotado'),
    ),
    h('section', { class: 'bloco', 'aria-labelledby': 't-atencao' },
      h('h2', { id: 't-atencao' }, 'Precisa de atenção'),
      atencao.length ? h('ul', { class: 'lista-atencao' }, atencao) : h('p', { class: 'vazio' }, 'Nada pendente agora.'),
    ),
    h('section', { class: 'bloco', 'aria-labelledby': 't-ultimos' },
      h('div', { class: 'bloco-topo' },
        h('h2', { id: 't-ultimos' }, 'Últimas entradas e saídas'),
        h('a', { href: '#historico' }, 'Ver todas'),
      ),
      tabelaMovimentos(r.ultimosMovimentos),
    ),
  );
}

async function telaEstoque() {
  const { produtos, limiteAcabando } = await api('/estoque');
  const total = produtos.reduce((s, p) => s + Math.max(p.quantidade, 0), 0);

  return h('div', { class: 'tela' },
    h('div', { class: 'cabecalho-tela' },
      h('h1', {}, 'Estoque'),
      h('p', { class: 'texto-suave' },
        `${plural(produtos.length, 'produto', 'produtos')}, ${plural(total, 'unidade', 'unidades')} no total. ` +
        `Com até ${limiteAcabando} unidades, o produto aparece como acabando.`),
    ),
    tabela({
      classe: 'tabela-estoque',
      colunas: [
        { titulo: 'Ticket', classe: 'col-ticket' },
        { titulo: 'Sabor', classe: 'col-sabor' },
        { titulo: 'Preço', classe: 'num col-preco' },
        { titulo: 'Em estoque', classe: 'num col-qtd' },
        { titulo: soLeitor('Ações'), rotulo: '', classe: 'acoes col-acoes' },
      ],
      linhas: produtos.map(p => ({
        classe: `situacao-${p.situacao}`,
        celulas: [
          ticket(p.ticket),
          [p.sabor, ' ', chipSituacao(p.situacao)],
          moeda.format(p.preco),
          h('span', { class: 'quantidade' }, numero.format(p.quantidade)),
          h('a', { class: 'botao botao-pequeno', href: `#movimentar?produto=${p.ticket}` }, 'Dar baixa'),
        ],
      })),
    }),
  );
}

const ACOES = {
  baixa: {
    nome: 'Dar baixa',
    explicacao: 'Tira unidades do estoque. Use para venda fora do WhatsApp, produto avariado, uso próprio ou brinde.',
    rotuloQuantidade: 'Quantas unidades saem',
    rotuloMotivo: 'Motivo',
    exemplo: 'Ex: venda no balcão',
    feito: 'Baixa registrada',
  },
  entrada: {
    nome: 'Registrar entrada',
    explicacao: 'Soma unidades ao estoque. Use quando chegar mercadoria.',
    rotuloQuantidade: 'Quantas unidades entram',
    rotuloMotivo: 'Observação (opcional)',
    exemplo: 'Ex: caixa do fornecedor',
    feito: 'Entrada registrada',
  },
  ajuste: {
    nome: 'Corrigir contagem',
    explicacao: 'Troca o número do estoque pelo que vocês contaram na prateleira. A diferença fica registrada como entrada ou saída.',
    rotuloQuantidade: 'Quantas unidades vocês contaram',
    rotuloMotivo: 'Motivo',
    exemplo: 'Ex: contagem do fim do mês',
    feito: 'Contagem corrigida',
  },
};

async function telaMovimentar(params) {
  let { produtos } = await api('/estoque');
  let acao = ACOES[params.get('acao')] ? params.get('acao') : 'baixa';
  const produtoInicial = Number(params.get('produto')) || produtos[0]?.ticket;

  const seletor = h('select', { id: 'mov-produto', name: 'produto', required: true });
  const preencherSeletor = (escolhido) => {
    colocar(seletor, ...produtos.map(p => h('option', { value: p.ticket, selected: p.ticket === escolhido },
      `${p.ticket}  ${p.sabor}  (${plural(p.quantidade, 'em estoque', 'em estoque')})`)));
  };
  preencherSeletor(produtoInicial);

  const quantidade = h('input', { id: 'mov-quantidade', name: 'quantidade', type: 'number', inputmode: 'numeric', min: '1', max: '100000', step: '1', required: true });
  const motivo = h('input', { id: 'mov-motivo', name: 'motivo', type: 'text', maxlength: '200', autocomplete: 'off' });
  const rotuloQuantidade = h('label', { for: 'mov-quantidade' });
  const rotuloMotivo = h('label', { for: 'mov-motivo' });
  const explicacao = h('p', { class: 'texto-suave explicacao' });
  const previa = h('p', { class: 'previa', 'aria-live': 'polite' });
  const erro = h('p', { class: 'mensagem-erro', role: 'alert', hidden: true });
  const botao = h('button', { type: 'submit', class: 'botao botao-principal' });
  const historicoProduto = h('div', { class: 'historico-produto' });

  const produtoAtual = () => produtos.find(p => p.ticket === Number(seletor.value));

  function atualizarPrevia() {
    const p = produtoAtual();
    const q = quantidade.value === '' ? null : Number(quantidade.value);
    botao.disabled = false;
    if (!p) { colocar(previa); return; }

    if (q === null || !Number.isInteger(q) || q < (acao === 'ajuste' ? 0 : 1)) {
      colocar(previa, h('span', {}, `${p.sabor} tem `), h('strong', {}, plural(p.quantidade, 'unidade', 'unidades')), ' agora.');
      return;
    }
    const novo = acao === 'baixa' ? p.quantidade - q : acao === 'entrada' ? p.quantidade + q : q;
    if (acao === 'baixa' && novo < 0) {
      colocar(previa, h('span', { class: 'previa-problema' }, `Só tem ${plural(p.quantidade, 'unidade', 'unidades')} de ${p.sabor}. Não dá pra tirar ${q}.`));
      botao.disabled = true;
      return;
    }
    colocar(previa, h('span', {},
      `${p.sabor}: `, h('strong', {}, numero.format(p.quantidade)), ' ', h('span', { 'aria-hidden': 'true' }, '→'),
      soLeitor(' vai para '), ' ', h('strong', {}, numero.format(novo)),
      acao === 'ajuste' && novo !== p.quantidade
        ? h('span', { class: 'texto-suave' }, ` (${novo > p.quantidade ? 'entrada' : 'saída'} de ${Math.abs(novo - p.quantidade)})`)
        : null,
    ));
  }

  async function carregarHistoricoProduto() {
    const p = produtoAtual();
    if (!p) return;
    try {
      const { movimentos } = await api(`/movimentos?produto=${p.ticket}&limite=5`);
      colocar(historicoProduto,
        h('h2', {}, `Últimos movimentos de ${p.sabor}`),
        tabelaMovimentos(movimentos, { mostrarProduto: false, vazio: 'Nenhum movimento desse produto ainda.' }),
      );
    } catch (e) {
      colocar(historicoProduto, h('p', { class: 'mensagem-erro' }, e.message));
    }
  }

  function aplicarAcao() {
    const a = ACOES[acao];
    explicacao.textContent = a.explicacao;
    rotuloQuantidade.textContent = a.rotuloQuantidade;
    rotuloMotivo.textContent = a.rotuloMotivo;
    motivo.placeholder = a.exemplo;
    motivo.required = acao !== 'entrada';
    quantidade.min = acao === 'ajuste' ? '0' : '1';
    botao.textContent = a.nome;
    atualizarPrevia();
  }

  const escolhaAcao = h('fieldset', { class: 'segmentos' },
    h('legend', {}, 'O que você quer fazer?'),
    Object.entries(ACOES).map(([chave, a]) => h('label', { class: 'segmento' },
      h('input', {
        type: 'radio', name: 'acao', value: chave, checked: chave === acao,
        onchange: () => { acao = chave; aplicarAcao(); history.replaceState(null, '', `#movimentar?acao=${chave}&produto=${seletor.value}`); },
      }),
      h('span', {}, a.nome),
    )),
  );

  const form = h('form', { class: 'form-movimento', novalidate: true },
    escolhaAcao,
    explicacao,
    h('div', { class: 'campos' },
      h('div', { class: 'campo campo-largo' }, h('label', { for: 'mov-produto' }, 'Produto'), seletor),
      h('div', { class: 'campo' }, rotuloQuantidade, quantidade),
      h('div', { class: 'campo campo-largo' }, rotuloMotivo, motivo),
    ),
    previa,
    erro,
    botao,
  );

  seletor.addEventListener('change', () => {
    atualizarPrevia();
    carregarHistoricoProduto();
    history.replaceState(null, '', `#movimentar?acao=${acao}&produto=${seletor.value}`);
  });
  quantidade.addEventListener('input', () => { erro.hidden = true; atualizarPrevia(); });
  motivo.addEventListener('input', () => { erro.hidden = true; });

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const p = produtoAtual();
    const q = Number(quantidade.value);
    const mostrarErro = (texto, campo) => { erro.textContent = texto; erro.hidden = false; campo?.focus(); };

    if (quantidade.value === '' || !Number.isInteger(q) || q < (acao === 'ajuste' ? 0 : 1)) {
      return mostrarErro(acao === 'ajuste' ? 'Digite quantas unidades vocês contaram (0 ou mais).' : 'Digite uma quantidade de 1 ou mais.', quantidade);
    }
    if (acao !== 'entrada' && motivo.value.trim().length < 3) {
      return mostrarErro(`Escreva o motivo (${ACOES[acao].exemplo.toLowerCase()}).`, motivo);
    }

    erro.hidden = true;
    botao.disabled = true;
    const textoBotao = botao.textContent;
    botao.textContent = 'Registrando…';
    try {
      const r = await api('/movimentos', {
        metodo: 'POST',
        corpo: { acao, produto: p.ticket, quantidade: q, observacao: motivo.value.trim() },
      });
      avisar(r.semMudanca
        ? `A contagem de ${p.sabor} já era ${r.saldo}. Nada mudou.`
        : `${ACOES[acao].feito}: ${p.sabor} agora tem ${plural(r.saldo, 'unidade', 'unidades')}.`);
      produtos = produtos.map(x => (x.ticket === p.ticket ? r.produto : x));
      preencherSeletor(p.ticket);
      quantidade.value = '';
      motivo.value = '';
      atualizarPrevia();
      carregarHistoricoProduto();
      quantidade.focus();
    } catch (e) {
      mostrarErro(e.message);
      try { ({ produtos } = await api('/estoque')); preencherSeletor(p.ticket); atualizarPrevia(); } catch {}
    } finally {
      botao.textContent = textoBotao;
      atualizarPrevia();
    }
  });

  aplicarAcao();
  carregarHistoricoProduto();

  return h('div', { class: 'tela' },
    h('div', { class: 'cabecalho-tela' }, h('h1', {}, 'Dar baixa ou registrar entrada')),
    h('div', { class: 'duas-colunas' }, form, historicoProduto),
  );
}

async function telaHistorico(params) {
  const { produtos } = await api('/estoque');
  const resultado = h('div', { class: 'resultado' });

  const campoProduto = h('select', { id: 'f-produto' },
    h('option', { value: '' }, 'Todos os produtos'),
    produtos.map(p => h('option', { value: p.ticket, selected: String(p.ticket) === params.get('produto') }, `${p.ticket}  ${p.sabor}`)));
  const campoTipo = h('select', { id: 'f-tipo' },
    h('option', { value: '' }, 'Entradas e saídas'),
    h('option', { value: 'entrada', selected: params.get('tipo') === 'entrada' }, 'Só entradas'),
    h('option', { value: 'saida', selected: params.get('tipo') === 'saida' }, 'Só saídas'));
  const campoDe = h('input', { id: 'f-de', type: 'date', value: params.get('de') ?? '' });
  const campoAte = h('input', { id: 'f-ate', type: 'date', value: params.get('ate') ?? '' });

  async function buscar() {
    const filtros = new URLSearchParams();
    if (campoProduto.value) filtros.set('produto', campoProduto.value);
    if (campoTipo.value) filtros.set('tipo', campoTipo.value);
    if (campoDe.value) filtros.set('de', campoDe.value);
    if (campoAte.value) filtros.set('ate', campoAte.value);
    history.replaceState(null, '', `#historico${filtros.size ? '?' + filtros : ''}`);

    resultado.setAttribute('aria-busy', 'true');
    try {
      const r = await api(`/movimentos?${filtros}`);
      const periodo = campoDe.value || campoAte.value
        ? ` de ${campoDe.value ? dataCurta(campoDe.value) : 'o começo'} até ${campoAte.value ? dataCurta(campoAte.value) : 'hoje'}`
        : '';
      colocar(resultado,
        h('p', { class: 'resumo-filtro' },
          h('span', { class: 'mov-entrada' }, `Entraram ${plural(r.entradas, 'unidade', 'unidades')}`), ' e ',
          h('span', { class: 'mov-saida' }, `saíram ${plural(r.saidas, 'unidade', 'unidades')}`), `${periodo}.`),
        r.truncado ? h('p', { class: 'texto-suave' }, 'Mostrando os 1.000 movimentos mais recentes. Use as datas para ver os mais antigos.') : null,
        tabelaMovimentos(r.movimentos, { vazio: 'Nenhum movimento com esses filtros.' }),
      );
    } catch (e) {
      colocar(resultado, h('p', { class: 'mensagem-erro' }, e.message));
    } finally {
      resultado.removeAttribute('aria-busy');
    }
  }

  for (const campo of [campoProduto, campoTipo, campoDe, campoAte]) campo.addEventListener('change', buscar);
  const limpar = h('button', {
    type: 'button', class: 'botao botao-discreto',
    onclick: () => { campoProduto.value = ''; campoTipo.value = ''; campoDe.value = ''; campoAte.value = ''; buscar(); },
  }, 'Limpar filtros');

  await buscar();

  return h('div', { class: 'tela' },
    h('div', { class: 'cabecalho-tela' },
      h('h1', {}, 'Entradas e saídas'),
      h('p', { class: 'texto-suave' }, 'Tudo que entrou e saiu do estoque: vendas do bot, baixas, reposições e correções, com quem fez.'),
    ),
    h('form', { class: 'filtros', onsubmit: (e) => { e.preventDefault(); buscar(); } },
      h('div', { class: 'campo' }, h('label', { for: 'f-produto' }, 'Produto'), campoProduto),
      h('div', { class: 'campo' }, h('label', { for: 'f-tipo' }, 'Tipo'), campoTipo),
      h('div', { class: 'campo' }, h('label', { for: 'f-de' }, 'De'), campoDe),
      h('div', { class: 'campo' }, h('label', { for: 'f-ate' }, 'Até'), campoAte),
      h('div', { class: 'campo campo-botao' }, limpar),
    ),
    resultado,
  );
}

function periodosProntos() {
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioMesPassado = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const fimMesPassado = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  const seteDias = new Date(hoje); seteDias.setDate(hoje.getDate() - 6);
  return [
    { nome: 'Hoje', de: isoLocal(hoje), ate: isoLocal(hoje) },
    { nome: 'Últimos 7 dias', de: isoLocal(seteDias), ate: isoLocal(hoje) },
    { nome: 'Este mês', de: isoLocal(inicioMes), ate: isoLocal(hoje) },
    { nome: 'Mês passado', de: isoLocal(inicioMesPassado), ate: isoLocal(fimMesPassado) },
  ];
}

function celulaPagamento(p) {
  const lista = p.comprovantes ?? [];
  if (!lista.length) return h('span', { class: 'texto-suave' }, '—');
  return lista.map(c => {
    const alertas = [];
    if (!c.leu) alertas.push('não deu pra ler');
    if (c.valorConfere === false) alertas.push('valor diferente');
    if (c.recebedorConfere === false) alertas.push('outra conta');
    if (c.dataConfere === false) alertas.push('data antiga');
    if (c.repetidoDoPedido) alertas.push(`repetido do pedido ${c.repetidoDoPedido}`);
    const data = c.data ? `${c.data.split('-').reverse().join('/')}${c.hora ? ` ${c.hora}` : ''}` : null;
    return h('div', { class: 'comprovante' },
      h('span', { class: 'cliente-nome' }, [c.valor != null ? moeda.format(c.valor) : 'valor ?', c.pagador || 'pagador ?'].join(' · ')),
      h('span', { class: 'texto-suave detalhe-pedido' }, [c.banco, data].filter(Boolean).join(' · ') || ' '),
      alertas.length
        ? h('span', { class: 'chip chip-atencao' }, alertas.join(', '))
        : h('span', { class: 'chip chip-pago' }, 'confere'),
      c.temArquivo ? h('a', { class: 'detalhe-pedido', href: `/api/comprovantes/${c.id}/arquivo`, target: '_blank', rel: 'noopener' }, c.pdf ? 'baixar comprovante (PDF)' : 'ver comprovante') : null,
    );
  });
}

async function telaVendas(params) {
  const prontos = periodosProntos();
  const campoDe = h('input', { id: 'v-de', type: 'date', value: params.get('de') ?? prontos[2].de });
  const campoAte = h('input', { id: 'v-ate', type: 'date', value: params.get('ate') ?? prontos[2].ate });
  const resultado = h('div', { class: 'resultado' });
  const botoesPeriodo = prontos.map(p => h('button', {
    type: 'button', class: 'botao botao-periodo',
    onclick: () => { campoDe.value = p.de; campoAte.value = p.ate; buscar(); },
  }, p.nome));

  async function buscar() {
    for (const [i, b] of botoesPeriodo.entries()) {
      b.setAttribute('aria-pressed', String(prontos[i].de === campoDe.value && prontos[i].ate === campoAte.value));
    }
    if (!campoDe.value || !campoAte.value) {
      colocar(resultado, h('p', { class: 'mensagem-erro' }, 'Escolha as duas datas.'));
      return;
    }
    history.replaceState(null, '', `#vendas?de=${campoDe.value}&ate=${campoAte.value}`);
    resultado.setAttribute('aria-busy', 'true');
    try {
      const v = await api(`/vendas?de=${campoDe.value}&ate=${campoAte.value}`);
      const t = v.totais;
      colocar(resultado,
        h('dl', { class: 'figuras' },
          figura('Total vendido', moeda.format(t.total), `${moeda.format(t.valorItens)} em produtos + ${moeda.format(t.frete)} de frete`, true),
          figura('Pedidos pagos', numero.format(t.pedidosPagos), t.pedidosPagos ? `${moeda.format(t.valorMedioPorPedido)} por pedido, em média` : null),
          figura('Unidades vendidas', numero.format(t.unidades), null),
        ),
        h('p', { class: 'texto-suave' }, 'Contam como venda só os pedidos pagos, pela data em que o pedido foi feito.'),
        h('section', { class: 'bloco', 'aria-labelledby': 't-por-produto' },
          h('h2', { id: 't-por-produto' }, 'Por produto'),
          tabela({
            vazio: 'Nenhuma venda paga nesse período.',
            colunas: [{ titulo: 'Ticket' }, { titulo: 'Sabor' }, { titulo: 'Unidades', classe: 'num' }, { titulo: 'Valor', classe: 'num' }],
            linhas: v.porProduto.map(p => ({ celulas: [ticket(p.id), p.sabor, numero.format(p.unidades), moeda.format(p.valor)] })),
          }),
        ),
        h('section', { class: 'bloco', 'aria-labelledby': 't-pedidos' },
          h('h2', { id: 't-pedidos' }, 'Pedidos do período'),
          t.pedidosNaoPagos ? h('p', { class: 'texto-suave' }, `${plural(t.pedidosNaoPagos, 'pedido não pago aparece', 'pedidos não pagos aparecem')} na lista, com a situação de cada um.`) : null,
          tabela({
            vazio: 'Nenhum pedido nesse período.',
            classe: 'tabela-pedidos',
            colunas: [{ titulo: 'Nº', rotulo: 'Pedido' }, { titulo: 'Data' }, { titulo: 'Cliente' }, { titulo: 'Itens' }, { titulo: 'Total', classe: 'num' }, { titulo: 'Pagamento' }, { titulo: 'Situação' }],
            linhas: v.pedidos.map(p => ({
              celulas: [
                p.id,
                dataHora(p.criado_em),
                [p.cliente ? h('span', { class: 'cliente-nome' }, p.cliente) : null, h('span', { class: 'texto-suave cliente-telefone' }, p.telefone)],
                p.itens.map(i => `${i.quantidade}× ${i.sabor}`).join(', '),
                moeda.format(p.total),
                celulaPagamento(p),
                [h('span', { class: `chip ${CLASSE_STATUS[p.status] ?? ''}` }, p.statusTexto), p.resolvidoPor ? h('span', { class: 'texto-suave detalhe-pedido' }, `por ${p.resolvidoPor}`) : null],
              ],
            })),
          }),
        ),
      );
    } catch (e) {
      colocar(resultado, h('p', { class: 'mensagem-erro' }, e.message));
    } finally {
      resultado.removeAttribute('aria-busy');
    }
  }

  campoDe.addEventListener('change', buscar);
  campoAte.addEventListener('change', buscar);
  await buscar();

  return h('div', { class: 'tela' },
    h('div', { class: 'cabecalho-tela' }, h('h1', {}, 'Vendas')),
    h('div', { class: 'filtros filtros-vendas' },
      h('div', { class: 'periodos', role: 'group', 'aria-label': 'Períodos prontos' }, botoesPeriodo),
      h('div', { class: 'campo' }, h('label', { for: 'v-de' }, 'De'), campoDe),
      h('div', { class: 'campo' }, h('label', { for: 'v-ate' }, 'Até'), campoAte),
    ),
    resultado,
  );
}

const TELAS = {
  inicio: { titulo: 'Visão geral', montar: telaInicio, atualizarSozinha: true },
  estoque: { titulo: 'Estoque', montar: telaEstoque, atualizarSozinha: true },
  movimentar: { titulo: 'Dar baixa', montar: telaMovimentar },
  historico: { titulo: 'Entradas e saídas', montar: telaHistorico },
  vendas: { titulo: 'Vendas', montar: telaVendas },
};

function lerRota() {
  const [nome, busca = ''] = window.location.hash.slice(1).split('?');
  return { nome: TELAS[nome] ? nome : 'inicio', params: new URLSearchParams(busca) };
}

let pedidoDeTela = 0;
async function mostrarTela({ focar = false } = {}) {
  const { nome, params } = lerRota();
  for (const aba of document.querySelectorAll('.abas a')) {
    if (aba.dataset.aba === nome) aba.setAttribute('aria-current', 'page');
    else aba.removeAttribute('aria-current');
  }
  document.title = `${TELAS[nome].titulo} | Painel da loja`;

  const meu = ++pedidoDeTela;
  try {
    const tela = await TELAS[nome].montar(params);
    if (meu !== pedidoDeTela) return;
    colocar($conteudo, tela);
  } catch (e) {
    if (meu !== pedidoDeTela) return;
    colocar($conteudo, h('div', { class: 'tela' },
      h('p', { class: 'mensagem-erro' }, e.message),
      h('button', { type: 'button', class: 'botao', onclick: () => mostrarTela() }, 'Tentar de novo')));
  }
  if (focar) $conteudo.focus({ preventScroll: false });
}

window.addEventListener('hashchange', () => mostrarTela({ focar: true }));

setInterval(() => {
  if (!document.hidden && TELAS[lerRota().nome].atualizarSozinha) mostrarTela();
}, 60 * 1000);

document.getElementById('botao-sair').addEventListener('click', async () => {
  try { await api('/sair', { metodo: 'POST', corpo: {} }); } catch {}
  window.location.replace('/entrar');
});

try {
  const eu = await api('/eu');
  csrf = eu.csrf;
  document.getElementById('nome-usuario').textContent = eu.usuario.nome;
  await mostrarTela();
} catch (e) {
  colocar($conteudo, h('p', { class: 'mensagem-erro' }, e.message));
}
