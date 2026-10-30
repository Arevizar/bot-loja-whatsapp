import cron from 'node-cron';
import { pedidosDeHoje } from '../database/db.js';
import { STATUS_PEDIDO } from '../database/vendas.js';

const reais = (valor) => `R$ ${valor.toFixed(2).replace('.', ',')}`;

function itensAgrupados(itens) {
  const contagem = new Map();
  for (const item of itens) contagem.set(item.nome, (contagem.get(item.nome) || 0) + 1);
  return [...contagem].map(([nome, qtd]) => `${qtd > 1 ? `${qtd}x ` : ''}${nome}`).join(', ');
}

export function formatarResumoDoDia() {
  const pedidos = pedidosDeHoje();
  if (pedidos.length === 0) return '📦 Nenhum pedido fechado hoje.';

  const pagos = pedidos.filter(p => p.status === 'pago');
  const total = (p) => p.itens.reduce((soma, item) => soma + item.preco, 0) + (p.frete || 0);
  let texto = `📦 *Resumo dos pedidos de hoje (${pedidos.length})*\n\n`;

  pedidos.forEach((p, i) => {
    const cliente = p.nome_cliente || String(p.numero_cliente).split('@')[0];
    texto += `*${i + 1}.* ${cliente} — ${STATUS_PEDIDO[p.status] ?? p.status}\n`;
    texto += `   🛒 ${itensAgrupados(p.itens)}\n`;
    texto += `   💵 ${reais(total(p))}${p.frete > 0 ? ` (frete ${reais(p.frete)})` : ''}\n\n`;
  });

  texto += `✅ *Vendido hoje (só pagos): ${reais(pagos.reduce((s, p) => s + total(p), 0))}* em ${pagos.length} pedido(s)`;
  return texto;
}

export function iniciarCronResumo(sock, numeroDono) {
  cron.schedule('0 18 * * *', async () => {
    await sock.sendMessage(numeroDono, { text: formatarResumoDoDia() });
  });
}