import db from './db.js';
import { comprovantesDosPedidos } from './comprovantes.js';

export const STATUS_PEDIDO = {
  aguardando_frete_manual: 'Aguardando frete',
  aguardando_pagamento: 'Aguardando pagamento',
  aguardando_confirmacao_dono: 'Pagamento a conferir',
  pago: 'Pago',
  pagamento_recusado: 'Recusado',
  cancelado: 'Cancelado pelo cliente',
  confirmado: 'Confirmado',
};

const somaItens = (itens) => itens.reduce((s, i) => s + (Number(i.preco) || 0), 0);
const centavos = (valor) => Math.round(valor * 100) / 100;

function telefone(numeroWhatsapp) {
  return String(numeroWhatsapp ?? '').split('@')[0];
}

function formatarPedido(p) {
  const itens = JSON.parse(p.itens);
  const valorItens = somaItens(itens);
  const frete = Number(p.frete) || 0;

  const porProduto = new Map();
  for (const item of itens) {
    const atual = porProduto.get(item.id) ?? { id: item.id, nome: item.nome, sabor: item.sabor ?? item.nome, quantidade: 0, valor: 0 };
    atual.quantidade++;
    atual.valor += Number(item.preco) || 0;
    porProduto.set(item.id, atual);
  }

  return {
    id: p.id,
    criado_em: p.criado_em_local,
    cliente: p.nome_cliente || null,
    telefone: telefone(p.numero_cliente),
    endereco: p.endereco,
    itens: [...porProduto.values()].map(i => ({ ...i, valor: centavos(i.valor) })),
    unidades: itens.length,
    valorItens: centavos(valorItens),
    frete: centavos(frete),
    total: centavos(valorItens + frete),
    status: p.status,
    statusTexto: STATUS_PEDIDO[p.status] ?? p.status,
    resolvidoPor: p.resolvido_por || null,
  };
}

export function listarPedidos({ de = null, ate = null, status = null, limite = 500 } = {}) {
  const condicoes = [];
  const parametros = [];
  if (de) { condicoes.push(`date(criado_em, 'localtime') >= ?`); parametros.push(de); }
  if (ate) { condicoes.push(`date(criado_em, 'localtime') <= ?`); parametros.push(ate); }
  if (status) {
    const lista = [].concat(status);
    condicoes.push(`status IN (${lista.map(() => '?').join(', ')})`);
    parametros.push(...lista);
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';

  const pedidos = db.prepare(`
    SELECT *, datetime(criado_em, 'localtime') AS criado_em_local
    FROM pedidos ${where}
    ORDER BY id DESC
    LIMIT ?
  `).all(...parametros, Math.min(Math.max(Number(limite) || 500, 1), 5000)).map(formatarPedido);
  return anexarComprovantes(pedidos);
}

function anexarComprovantes(pedidos) {
  const mapa = comprovantesDosPedidos(pedidos.map(p => p.id));
  for (const p of pedidos) {
    p.comprovantes = (mapa.get(p.id) ?? []).map(c => ({
      id: c.id,
      valor: c.valor,
      pagador: c.pagador,
      banco: c.banco_pagador,
      recebedor: c.recebedor,
      data: c.data_pagamento,
      hora: c.hora_pagamento,
      idTransacao: c.id_transacao,
      valorConfere: c.valor_confere === null ? null : !!c.valor_confere,
      recebedorConfere: c.recebedor_confere === null ? null : !!c.recebedor_confere,
      dataConfere: c.data_confere === null ? null : !!c.data_confere,
      repetidoDoPedido: c.duplicado_do_pedido,
      leu: !!c.leu_o_comprovante,
      temArquivo: !!c.arquivo,
      pdf: c.tipo_arquivo === 'application/pdf',
      recebidoEm: c.recebido_em,
    }));
  }
  return pedidos;
}

export function vendasDoPeriodo({ de, ate }) {
  const pedidos = listarPedidos({ de, ate, limite: 5000 });
  const pagos = pedidos.filter(p => p.status === 'pago');

  const porProduto = new Map();
  for (const pedido of pagos) {
    for (const item of pedido.itens) {
      const atual = porProduto.get(item.id) ?? { id: item.id, nome: item.nome, sabor: item.sabor, unidades: 0, valor: 0 };
      atual.unidades += item.quantidade;
      atual.valor += item.valor;
      porProduto.set(item.id, atual);
    }
  }

  const soma = (lista, campo) => centavos(lista.reduce((s, p) => s + p[campo], 0));

  return {
    de, ate,
    totais: {
      pedidosPagos: pagos.length,
      unidades: pagos.reduce((s, p) => s + p.unidades, 0),
      valorItens: soma(pagos, 'valorItens'),
      frete: soma(pagos, 'frete'),
      total: soma(pagos, 'total'),
      valorMedioPorPedido: pagos.length ? centavos(soma(pagos, 'total') / pagos.length) : 0,
      pedidosNaoPagos: pedidos.length - pagos.length,
    },
    porProduto: [...porProduto.values()]
      .map(p => ({ ...p, valor: centavos(p.valor) }))
      .sort((a, b) => b.unidades - a.unidades || a.id - b.id),
    pedidos,
  };
}

export function pedidosEmAberto() {
  return listarPedidos({
    status: ['aguardando_frete_manual', 'aguardando_confirmacao_dono', 'aguardando_pagamento'],
    limite: 100,
  });
}

export function maisVendidos({ limite = 3, dias = 90 } = {}) {
  const pedidos = db.prepare(`
    SELECT itens FROM pedidos
    WHERE status = 'pago' AND criado_em >= datetime('now', ?)
  `).all(`-${dias} days`);
  const unidades = new Map();
  for (const pedido of pedidos) {
    for (const item of JSON.parse(pedido.itens)) unidades.set(item.id, (unidades.get(item.id) || 0) + 1);
  }
  const ranking = [...unidades]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limite)
    .map(([id, total]) => ({ id, unidades: total }));
  return { pedidosPagos: pedidos.length, ranking };
}
