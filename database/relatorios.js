import db from './db.js';

// Soma quantas unidades de cada produto foram vendidas (pedidos pagos) nos últimos N dias
export function vendasPorProduto(dias = 30) {
  const pedidos = db.prepare(`
    SELECT itens FROM pedidos
    WHERE status = 'pago' AND criado_em >= datetime('now', '-' || ? || ' days')
  `).all(dias);

  const contagem = {};
  for (const pedido of pedidos) {
    const itens = JSON.parse(pedido.itens);
    for (const item of itens) {
      contagem[item.nome] = (contagem[item.nome] || 0) + 1;
    }
  }
  return contagem;
}

// Total em R$ vendido (pedidos pagos) nos últimos N dias
export function faturamentoTotal(dias = 30) {
  const pedidos = db.prepare(`
    SELECT itens FROM pedidos
    WHERE status = 'pago' AND criado_em >= datetime('now', '-' || ? || ' days')
  `).all(dias);

  let total = 0;
  for (const pedido of pedidos) {
    const itens = JSON.parse(pedido.itens);
    total += itens.reduce((soma, item) => soma + (item.preco || 0), 0);
  }
  return total;
}

function diasDeHistorico() {
  const primeiro = db.prepare(`
    SELECT MIN(criado_em) as data FROM pedidos WHERE status = 'pago'
  `).get();
  if (!primeiro?.data) return 0;
  const diffMs = new Date() - new Date(primeiro.data);
  return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Previsão simples: pega a média de vendas diárias dos últimos "diasBase" dias
 * (ou de todo o histórico, se for menor que isso) e projeta pra frente.
 * É uma média móvel simples — não considera sazonalidade nem tendência real.
 * Fica mais confiável quanto mais histórico acumular.
 */
export function preverProximosMeses(diasBase = 30) {
  const historico = diasDeHistorico();
  const diasConsiderados = Math.min(diasBase, historico);

  if (historico < 7) {
    return {
      confiavel: false,
      mensagem: `Ainda não há histórico suficiente pra previsão (${historico} dia(s) de dados). Recomendo esperar pelo menos 1-2 semanas de vendas antes de confiar em projeções.`,
    };
  }

  const vendas = vendasPorProduto(diasConsiderados);
  const faturamento = faturamentoTotal(diasConsiderados);
  const mediaDiaria = faturamento / diasConsiderados;

  const projecaoProdutos = Object.entries(vendas).map(([nome, qtd]) => {
    const mediaDiariaProduto = qtd / diasConsiderados;
    return {
      nome,
      mediaDiaria: mediaDiariaProduto,
      projecao30dias: Math.round(mediaDiariaProduto * 30),
    };
  });

  return {
    confiavel: historico >= 30,
    diasDeHistorico: historico,
    faturamentoMedioDiario: mediaDiaria,
    projecaoFaturamento30dias: mediaDiaria * 30,
    produtos: projecaoProdutos,
  };
}

export function formatarPrevisao() {
  const p = preverProximosMeses();

  if (!p.confiavel && p.mensagem) {
    return `📊 *Previsão de vendas*\n\n${p.mensagem}`;
  }

  let texto = `📊 *Previsão para os próximos 30 dias*\n`;
  texto += `_(baseado em ${p.diasDeHistorico} dia(s) de histórico${p.confiavel ? '' : ' — ainda pouco, use com cautela'})_\n\n`;
  texto += `💰 Faturamento médio diário: R$ ${p.faturamentoMedioDiario.toFixed(2)}\n`;
  texto += `💰 Projeção para 30 dias: R$ ${p.projecaoFaturamento30dias.toFixed(2)}\n\n`;
  texto += `*Por produto:*\n`;
  for (const prod of p.produtos) {
    texto += `- ${prod.nome}: ~${prod.projecao30dias} un. em 30 dias\n`;
  }
  return texto;
}