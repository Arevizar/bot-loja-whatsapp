import cron from 'node-cron';
import { pedidosDeHoje } from '../database/db.js';

export function formatarResumoDoDia() {
  const pedidos = pedidosDeHoje();
  if (pedidos.length === 0) return '📦 Nenhum pedido fechado hoje.';

  let texto = `📦 *Resumo dos pedidos de hoje (${pedidos.length})*\n\n`;
  let totalGeral = 0;

  pedidos.forEach((p, i) => {
    const totalItens = p.itens.reduce((soma, item) => soma + item.preco, 0);
    const totalPedido = totalItens + (p.frete || 0);
    totalGeral += totalPedido;
    texto += `*Pedido ${i + 1}* — ${p.nome_cliente || p.numero_cliente} (${p.status})\n`;
    texto += p.itens.map(item => `  - ${item.nome}`).join('\n') + '\n';
    texto += `  📍 ${p.endereco}\n`;
    texto += `  🚚 Frete: ${p.frete > 0 ? 'R$ ' + p.frete.toFixed(2) : 'Grátis'}\n`;
    texto += `  💰 Total: R$ ${totalPedido.toFixed(2)}\n\n`;
  });

  texto += `*Total geral do dia: R$ ${totalGeral.toFixed(2)}*`;
  return texto;
}

export function iniciarCronResumo(sock, numeroDono) {
  cron.schedule('0 18 * * *', async () => {
    await sock.sendMessage(numeroDono, { text: formatarResumoDoDia() });
  });
}