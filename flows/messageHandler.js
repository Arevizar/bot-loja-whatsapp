import db, {
  getEstado, criarEstado, atualizarEstado, resetarEstado, salvarPedido,
  buscarPedidoPorId, buscarPedidosPorStatus, atualizarStatusPedido,
  definirFretePedido, marcarPedido, ultimoPedidoDoCliente,
} from '../database/db.js';
import { formatarCatalogo, mensagemBoasVindas, buscarProduto, buscarProdutoPorTicket, nomeParaCliente } from '../database/catalogo.js';
import { statusHorario } from '../jobs/horario.js';
import { PIX_CHAVE, PIX_NOME_BENEFICIARIO, PIX_CIDADE } from '../database/pagamento.js';
import { gerarPayloadPix, gerarImagemQRCodePix } from '../database/pixPayload.js';
import { consultarEstoque, baixarEstoque, reporEstoque, formatarEstoque } from '../database/estoque.js';
import { formatarPrevisao } from '../database/relatorios.js';
import { formatarResumoDoDia } from '../jobs/resumoDiario.js';
import { calcularFrete } from '../database/frete.js';

const MAX_TENTATIVAS_ENDERECO = 2;

// Conversa parada há mais que isso (antes de fechar o pedido) é descartada,
// pra cliente que some e volta dias depois não cair num carrinho velho.
const HORAS_PARA_EXPIRAR_CONVERSA = 24;
const ETAPAS_QUE_EXPIRAM = ['aguardando_produto', 'aguardando_endereco', 'aguardando_confirmacao'];

// ---------------------------------------------------------------------------
// FILA POR CLIENTE: mensagens do MESMO cliente são processadas uma de cada vez,
// na ordem em que chegaram. Clientes diferentes continuam sendo atendidos em
// paralelo. Isso impede que duas mensagens rápidas do mesmo cliente se
// atropelem (ex: mandar o endereço 2x e calcular frete 2x ao mesmo tempo).
// ---------------------------------------------------------------------------
const filasPorCliente = new Map();

export function tratarMensagem(sock, numero, texto, nomeCliente, imagemBuffer = null) {
  const anterior = filasPorCliente.get(numero) || Promise.resolve();
  const atual = anterior
    .catch(() => {})
    .then(() => processarMensagemCliente(sock, numero, texto, nomeCliente, imagemBuffer));

  filasPorCliente.set(numero, atual);
  atual
    .catch(() => {})
    .finally(() => {
      if (filasPorCliente.get(numero) === atual) filasPorCliente.delete(numero);
    });

  return atual;
}

async function processarMensagemCliente(sock, numero, texto, nomeCliente, imagemBuffer) {
  const msg = (texto || '').trim().toLowerCase();

  const status = statusHorario();
  if (status === 'antes_da_abertura') {
    await sock.sendMessage(numero, {
      text: '🌅 Ainda não abrimos! Nosso horário de pedidos começa às 6h30. Volte mais tarde 🙂',
    });
    return;
  }
  if (status === 'fechado') {
    await sock.sendMessage(numero, {
      text: '⏰ Nosso horário de pedidos de hoje já encerrou (até 18h). Volte amanhã, vamos adorar te atender!',
    });
    return;
  }

  let estado = getEstado(numero);

  // Cliente que abandonou a compra e voltou muito tempo depois: recomeça do zero
  if (estado && ETAPAS_QUE_EXPIRAM.includes(estado.etapa) && conversaExpirada(estado)) {
    resetarEstado(numero);
    criarEstado(numero);
    await sock.sendMessage(numero, {
      text:
        '👋 Que bom te ver de novo! Seu pedido anterior não foi finalizado, então vamos começar um novo 👇\n\n' +
        formatarCatalogo(consultarEstoque),
    });
    return;
  }

  if (!estado) {
    await iniciarConversa(sock, numero, msg, nomeCliente);
    return;
  }

  switch (estado.etapa) {
    case 'aguardando_produto':
      await tratarEscolhaProduto(sock, numero, msg, estado);
      break;

    case 'aguardando_endereco':
      await tratarEndereco(sock, numero, texto, estado);
      break;

    case 'aguardando_confirmacao':
      await tratarConfirmacao(sock, numero, msg, estado, nomeCliente);
      break;

    case 'aguardando_comprovante':
      await tratarComprovante(sock, numero, imagemBuffer, texto);
      break;

    default:
      resetarEstado(numero);
      await iniciarConversa(sock, numero, msg, nomeCliente);
  }
}

// Primeira mensagem do cliente: responde já com saudação + catálogo.
// Se a mensagem já for um produto (ex: "1" ou "strawberry"), ele entra direto no carrinho.
async function iniciarConversa(sock, numero, msg, nomeCliente) {
  criarEstado(numero);
  await sock.sendMessage(numero, { text: mensagemBoasVindas(nomeCliente, consultarEstoque) });

  if (buscarProduto(msg, true)) {
    await tratarEscolhaProduto(sock, numero, msg, getEstado(numero));
  }
}

function conversaExpirada(estado) {
  if (!estado.atualizado_em) return false;
  // O SQLite grava em UTC sem o "Z" no final; adicionamos pra o JS interpretar certo
  const ultimaAtividade = new Date(estado.atualizado_em.replace(' ', 'T') + 'Z');
  const horasParado = (Date.now() - ultimaAtividade.getTime()) / (1000 * 60 * 60);
  return horasParado > HORAS_PARA_EXPIRAR_CONVERSA;
}

async function tratarEscolhaProduto(sock, numero, msg, estado) {
  if (msg === 'catalogo' || msg === 'catálogo' || msg === 'cardapio' || msg === 'cardápio') {
    await sock.sendMessage(numero, { text: formatarCatalogo(consultarEstoque) });
    return;
  }

  if (msg === 'fim') {
    if (estado.carrinho.length === 0) {
      await sock.sendMessage(numero, { text: 'Você ainda não escolheu nenhum produto. Digite o *número da opção* que quer pedir (ex: *1*) ou o nome do sabor.' });
      return;
    }
    atualizarEstado(numero, { etapa: 'aguardando_endereco' });
    await sock.sendMessage(numero, { text: '📍 Perfeito! Agora me manda seu *endereço completo* para entrega.' });
    return;
  }

  const produto = buscarProduto(msg);
  if (!produto) {
    await sock.sendMessage(numero, {
      text:
        'Não encontrei esse produto 🤔 Digite o *número da opção* (ex: *1*) ou o nome do sabor, ou *fim* pra fechar o pedido.\n\n' +
        'Quer ver o catálogo de novo? Digite *catálogo*.',
    });
    return;
  }

  const jaNoCarrinho = estado.carrinho.filter(p => p.id === produto.id).length;
  const disponivel = consultarEstoque(produto.id);

  if (jaNoCarrinho >= disponivel) {
    await sock.sendMessage(numero, {
      text: `😕 Desculpa, *${nomeParaCliente(produto)}* está esgotado no momento. Escolha outra opção ou digite *fim* pra fechar o pedido.`,
    });
    return;
  }

  const novoCarrinho = [...estado.carrinho, produto];
  atualizarEstado(numero, { etapa: 'aguardando_produto', carrinho: novoCarrinho });
  const totalCarrinho = novoCarrinho.reduce((soma, p) => soma + p.preco, 0);
  await sock.sendMessage(numero, {
    text:
      `✅ *${nomeParaCliente(produto)}* adicionado!\n` +
      `🛒 Carrinho: ${novoCarrinho.length} item(ns) · R$ ${totalCarrinho.toFixed(2)}\n\n` +
      `Digite outra *opção* pra adicionar mais, ou *fim* pra fechar o pedido.`,
  });
}

async function tratarEndereco(sock, numero, textoOriginal, estado) {
  if (!textoOriginal || !textoOriginal.trim()) {
    await sock.sendMessage(numero, {
      text: '📍 Preciso que você *digite* seu endereço em texto (rua, número, bairro), não uma imagem 🙂',
    });
    return;
  }

  await sock.sendMessage(numero, { text: '📍 Calculando o frete pro seu endereço, só um momento...' });

  let resultadoFrete;
  try {
    resultadoFrete = await calcularFrete(textoOriginal);
  } catch (erro) {
    // Qualquer falha inesperada no serviço de mapas vira "não localizado",
    // nunca um travamento da conversa
    console.error('Erro inesperado ao calcular frete:', erro);
    resultadoFrete = { sucesso: false, motivo: 'erro_inesperado' };
  }

  if (!resultadoFrete.sucesso) {
    const tentativas = (estado.tentativas_endereco || 0) + 1;

    if (tentativas < MAX_TENTATIVAS_ENDERECO) {
      atualizarEstado(numero, { tentativas_endereco: tentativas });
      await sock.sendMessage(numero, {
        text:
          '😕 Não consegui localizar esse endereço no mapa. Pode mandar de novo com mais detalhes ' +
          '(rua, número, bairro), tipo: "Rua Exemplo, 123, Jardim Tal"?',
      });
      return;
    }

    await prosseguirSemFreteAutomatico(sock, numero, textoOriginal, estado);
    return;
  }

  const total = estado.carrinho.reduce((soma, p) => soma + p.preco, 0);
  const totalComFrete = total + resultadoFrete.valorFrete;

  atualizarEstado(numero, {
    etapa: 'aguardando_confirmacao',
    endereco: textoOriginal,
    frete: resultadoFrete.valorFrete,
    frete_confirmado: 1,
    tentativas_endereco: 0,
  });

  const resumo = estado.carrinho.map(p => `- ${nomeParaCliente(p)} (R$ ${p.preco.toFixed(2)})`).join('\n');
  const linhaFrete = resultadoFrete.gratis
    ? '🚚 Frete: *Grátis* (dentro de 5km da loja)'
    : `🚚 Frete: R$ ${resultadoFrete.valorFrete.toFixed(2)} (${resultadoFrete.distanciaKm.toFixed(1)}km de distância)`;

  await sock.sendMessage(numero, {
    text:
      `📋 *Confirme seu pedido:*\n\n${resumo}\n\n` +
      `${linhaFrete}\n\n` +
      `*Total: R$ ${totalComFrete.toFixed(2)}*\n📍 Endereço: ${textoOriginal}\n\n` +
      `Digite *A* para confirmar ou *B* para cancelar.`,
  });
}

async function prosseguirSemFreteAutomatico(sock, numero, textoOriginal, estado) {
  atualizarEstado(numero, {
    etapa: 'aguardando_confirmacao',
    endereco: textoOriginal,
    frete: 0,
    frete_confirmado: 0,
    tentativas_endereco: 0,
  });

  const total = estado.carrinho.reduce((soma, p) => soma + p.preco, 0);
  const resumo = estado.carrinho.map(p => `- ${nomeParaCliente(p)} (R$ ${p.preco.toFixed(2)})`).join('\n');

  await sock.sendMessage(numero, {
    text:
      `📋 *Confirme seu pedido:*\n\n${resumo}\n\n` +
      `🚚 Frete: *a confirmar* (nossa equipe vai calcular e te avisar o valor antes do pagamento)\n\n` +
      `*Subtotal (sem frete): R$ ${total.toFixed(2)}*\n📍 Endereço: ${textoOriginal}\n\n` +
      `Digite *A* para confirmar ou *B* para cancelar.`,
  });
}

// Checa estoque + salva pedido + baixa estoque + avança etapa do cliente,
// TUDO numa única transação do banco: ou acontece tudo, ou nada acontece.
// Mesmo que o processo morra no meio, o banco nunca fica "pela metade".
const fecharPedidoAtomico = db.transaction((numero, nomeCliente, estado) => {
  const necessarioPorProduto = {};
  for (const item of estado.carrinho) {
    necessarioPorProduto[item.id] = (necessarioPorProduto[item.id] || 0) + 1;
  }

  const idsIndisponiveis = [];
  for (const [produtoId, quantidade] of Object.entries(necessarioPorProduto)) {
    if (consultarEstoque(Number(produtoId)) < quantidade) {
      idsIndisponiveis.push(Number(produtoId));
    }
  }

  if (idsIndisponiveis.length > 0) {
    return { ok: false, idsIndisponiveis };
  }

  const pedidoId = salvarPedido({
    numero_cliente: numero,
    nome_cliente: nomeCliente,
    itens: estado.carrinho,
    endereco: estado.endereco,
    frete: estado.frete,
    frete_confirmado: estado.frete_confirmado,
    status: estado.frete_confirmado ? 'aguardando_pagamento' : 'aguardando_frete_manual',
  });

  for (const item of estado.carrinho) {
    baixarEstoque(item.id, 1);
  }

  // Avança a etapa junto com o pedido: se o bot cair logo depois e o cliente
  // mandar "A" de novo, ele NÃO cria um segundo pedido.
  atualizarEstado(numero, { etapa: 'aguardando_comprovante' });

  return { ok: true, pedidoId };
});

async function tratarConfirmacao(sock, numero, msg, estado, nomeCliente) {
  if (msg === 'a') {
    const resultado = fecharPedidoAtomico(numero, nomeCliente, estado);

    if (!resultado.ok) {
      const nomesIndisponiveis = [...new Set(
        estado.carrinho.filter(p => resultado.idsIndisponiveis.includes(p.id)).map(p => nomeParaCliente(p))
      )];
      const novoCarrinho = estado.carrinho.filter(p => !resultado.idsIndisponiveis.includes(p.id));
      atualizarEstado(numero, { etapa: 'aguardando_produto', carrinho: novoCarrinho });

      await sock.sendMessage(numero, {
        text:
          `😕 Ih, alguém acabou de levar o último: *${nomesIndisponiveis.join(', ')}*. ` +
          `Removi do seu carrinho. Escolha outro produto ou digite *fim* pra fechar com o que sobrou.`,
      });
      return;
    }

    const pedidoId = resultado.pedidoId;

    if (!estado.frete_confirmado) {
      await enviarAvisoFreteManual(sock, numero, pedidoId, estado.carrinho, estado.endereco, nomeCliente);
      return;
    }

    await enviarInstrucoesPagamento(sock, numero, pedidoId, estado.carrinho, estado.frete);
  } else if (msg === 'b') {
    resetarEstado(numero);
    await sock.sendMessage(numero, { text: 'Pedido cancelado. Se quiser começar de novo, é só mandar uma mensagem 🙂' });
  } else {
    await sock.sendMessage(numero, { text: 'Não entendi. Digite *A* para confirmar o pedido ou *B* para cancelar.' });
  }
}

async function enviarInstrucoesPagamento(sock, numero, pedidoId, carrinho, frete) {
  const totalItens = carrinho.reduce((soma, p) => soma + p.preco, 0);
  const total = totalItens + (frete || 0);

  const payloadPix = gerarPayloadPix({
    chave: PIX_CHAVE,
    nome: PIX_NOME_BENEFICIARIO,
    cidade: PIX_CIDADE,
    valor: total,
    txid: `PEDIDO${pedidoId}`,
  });

  await sock.sendMessage(numero, {
    text:
      `💳 *Pedido nº ${pedidoId}*\n\n` +
      `Pra confirmar, pague R$ ${total.toFixed(2)} via Pix — pode escanear o QR code abaixo ou usar o "copia e cola".`,
  });

  const imagemQR = await gerarImagemQRCodePix(payloadPix);
  await sock.sendMessage(numero, {
    image: imagemQR,
    caption: '📷 Escaneie este QR code no app do seu banco',
  });

  await sock.sendMessage(numero, {
    text: `📋 *Pix Copia e Cola:*\n\n${payloadPix}\n\nDepois de pagar, é só mandar *"paguei"* aqui ou o print do comprovante! ✅`,
  });

  // Só marca como entregue depois que as 3 mensagens saíram sem erro
  marcarPedido(pedidoId, 'pix_enviado');
}

async function enviarAvisoFreteManual(sock, numero, pedidoId, carrinho, endereco, nomeCliente) {
  await sock.sendMessage(numero, {
    text:
      `📦 *Pedido nº ${pedidoId} registrado!*\n\n` +
      `Não conseguimos calcular o frete automaticamente pro seu endereço — nossa equipe vai calcular ` +
      `manualmente e te mandar o valor final e as instruções de pagamento em instantes. Aguarde só um pouquinho! 🙏`,
  });

  const numeroDono = process.env.NUMERO_DONO;
  if (numeroDono) {
    const itensTexto = carrinho.map(i => `- ${i.nome}`).join('\n');
    await sock.sendMessage(numeroDono, {
      text:
        `⚠️ *Frete não calculado automaticamente — Pedido nº ${pedidoId}*\n\n` +
        `Cliente: ${nomeCliente || numero}\n` +
        `${itensTexto}\n` +
        `📍 ${endereco}\n\n` +
        `Calcule o frete manualmente e responda aqui:\n` +
        `*frete ${pedidoId} [valor]* — ex: frete ${pedidoId} 5.50`,
    });
  }
  marcarPedido(pedidoId, 'dono_notificado');
}

function montarAvisoPagamentoDono(pedido, comImagem) {
  const itensTexto = pedido.itens.map(i => `- ${i.nome}`).join('\n');
  const freteTexto = pedido.frete > 0 ? `🚚 Frete: R$ ${pedido.frete.toFixed(2)}\n` : '🚚 Frete: Grátis\n';
  const total = pedido.itens.reduce((s, i) => s + i.preco, 0) + (pedido.frete || 0);
  return (
    `💰 *Pagamento a confirmar — Pedido nº ${pedido.id}*\n\n` +
    `Cliente: ${pedido.nome_cliente || pedido.numero_cliente}\n` +
    `${itensTexto}\n` +
    freteTexto +
    `💵 Total: R$ ${total.toFixed(2)}\n` +
    `📍 ${pedido.endereco}\n` +
    (comImagem ? '' : '_(cliente avisou que pagou; se ele mandou comprovante, confira a conversa com ele)_\n') +
    `\nConfira no extrato e responda aqui:\n` +
    `*confirmar ${pedido.id}* → aprova o pedido\n` +
    `*recusar ${pedido.id}* → recusa (pagamento não encontrado)`
  );
}

async function enviarAvisoPagamentoDono(sock, pedido, imagemBuffer) {
  const numeroDono = process.env.NUMERO_DONO;
  if (numeroDono) {
    const texto = montarAvisoPagamentoDono(pedido, !!imagemBuffer);
    if (imagemBuffer) {
      await sock.sendMessage(numeroDono, { image: imagemBuffer, caption: texto });
    } else {
      await sock.sendMessage(numeroDono, { text: texto });
    }
  }
  marcarPedido(pedido.id, 'pagamento_notificado');
}

async function tratarComprovante(sock, numero, imagemBuffer, textoOriginal) {
  const pedido = ultimoPedidoDoCliente(numero);

  if (!pedido) {
    resetarEstado(numero);
    await sock.sendMessage(numero, { text: 'Não encontrei seu pedido. Pode mandar uma mensagem pra começar de novo 🙂' });
    return;
  }

  if (pedido.status === 'aguardando_frete_manual') {
    await sock.sendMessage(numero, {
      text: '🕐 Ainda estamos calculando o frete do seu pedido. Assim que tivermos o valor, te mandamos as instruções de pagamento!',
    });
    return;
  }

  if (pedido.status !== 'aguardando_pagamento') {
    // Pedido já está em análise ou já foi concluído: não reabre nada
    resetarEstado(numero);
    await sock.sendMessage(numero, {
      text: `Seu pedido nº ${pedido.id} já está sendo processado 🙂 Se quiser fazer um novo pedido, é só mandar uma mensagem.`,
    });
    return;
  }

  const pareceConfirmacao =
    imagemBuffer || /pag(uei|o|amento)/i.test(textoOriginal || '');

  if (!pareceConfirmacao) {
    await sock.sendMessage(numero, {
      text: 'Assim que fizer o pagamento, manda *"paguei"* aqui ou o print do comprovante 🙂',
    });
    return;
  }

  // Status + limpeza do marcador numa transação só
  db.transaction(() => {
    atualizarStatusPedido(pedido.id, 'aguardando_confirmacao_dono');
    marcarPedido(pedido.id, 'pagamento_notificado', 0);
    resetarEstado(numero);
  })();

  await sock.sendMessage(numero, {
    text: '🕐 Recebido! Estamos confirmando o pagamento e já te avisamos assim que o pedido for aprovado.',
  });

  await enviarAvisoPagamentoDono(sock, { ...pedido, status: 'aguardando_confirmacao_dono' }, imagemBuffer);
}

async function enviarResultadoAoCliente(sock, pedido) {
  if (pedido.status === 'pago') {
    await sock.sendMessage(pedido.numero_cliente, {
      text: `✅ Pagamento do pedido nº ${pedido.id} confirmado! Já vamos preparar e enviar. Obrigado pela compra 🎉`,
    });
  } else if (pedido.status === 'pagamento_recusado') {
    await sock.sendMessage(pedido.numero_cliente, {
      text:
        `⚠️ Não localizamos o pagamento do pedido nº ${pedido.id}, por isso ele foi cancelado. ` +
        `Se você já pagou, fique tranquilo: nossa equipe vai conferir de novo e falar com você. ` +
        `Pra fazer um novo pedido, é só mandar uma mensagem 🙂`,
    });
  }
  marcarPedido(pedido.id, 'resultado_notificado');
}

/**
 * RECUPERAÇÃO AUTOMÁTICA — roda toda vez que o bot conecta (inclusive depois
 * de cair e religar, ou reconectar sozinho). Procura qualquer mensagem que
 * deveria ter saído mas não saiu, e envia. Pedidos já concluídos não são
 * reenviados, graças aos marcadores no banco.
 */
export async function recuperarPedidosPendentes(sock) {
  let recuperados = 0;

  async function tentar(descricao, fn) {
    try {
      console.log(`🔄 ${descricao}`);
      await fn();
      recuperados++;
    } catch (erro) {
      console.error(`Erro ao recuperar (${descricao}):`, erro);
    }
  }

  for (const p of buscarPedidosPorStatus('aguardando_pagamento').filter(p => !p.pix_enviado)) {
    await tentar(`Pedido nº ${p.id}: reenviando instruções de pagamento`, () =>
      enviarInstrucoesPagamento(sock, p.numero_cliente, p.id, p.itens, p.frete));
  }

  for (const p of buscarPedidosPorStatus('aguardando_frete_manual').filter(p => !p.dono_notificado)) {
    await tentar(`Pedido nº ${p.id}: reenviando aviso de frete manual`, () =>
      enviarAvisoFreteManual(sock, p.numero_cliente, p.id, p.itens, p.endereco, p.nome_cliente));
  }

  for (const p of buscarPedidosPorStatus('aguardando_confirmacao_dono').filter(p => !p.pagamento_notificado)) {
    await tentar(`Pedido nº ${p.id}: reenviando aviso de pagamento pro dono`, () =>
      enviarAvisoPagamentoDono(sock, p, null));
  }

  for (const status of ['pago', 'pagamento_recusado']) {
    for (const p of buscarPedidosPorStatus(status).filter(p => !p.resultado_notificado)) {
      await tentar(`Pedido nº ${p.id}: reenviando resultado (${status}) pro cliente`, () =>
        enviarResultadoAoCliente(sock, p));
    }
  }

  if (recuperados === 0) console.log('✅ Nenhum pedido pendente de recuperação.');
  return recuperados;
}

export async function tratarComandoDono(sock, texto) {
  const msg = (texto || '').trim().toLowerCase();
  const partes = msg.split(/\s+/);
  const numeroDono = process.env.NUMERO_DONO;

  if (msg === 'estoque') {
    await sock.sendMessage(numeroDono, { text: formatarEstoque() });
    return true;
  }

  if (msg === 'previsao' || msg === 'previsão') {
    await sock.sendMessage(numeroDono, { text: formatarPrevisao() });
    return true;
  }

  if (msg === 'resumo') {
    await sock.sendMessage(numeroDono, { text: formatarResumoDoDia() });
    return true;
  }

  if (partes[0] === 'repor' && partes.length === 3) {
    const produtoId = Number(partes[1]);
    const quantidade = Number(partes[2]);

    if (!Number.isInteger(produtoId) || !Number.isInteger(quantidade) || quantidade <= 0) {
      await sock.sendMessage(numeroDono, { text: 'Uso: *repor [ticket] [quantidade]*, ex: repor 61 10' });
      return true;
    }
    const produtoRepor = buscarProdutoPorTicket(produtoId);
    if (!produtoRepor) {
      await sock.sendMessage(numeroDono, { text: `Não existe produto com ticket ${produtoId} no catálogo.` });
      return true;
    }

    reporEstoque(produtoId, quantidade);
    await sock.sendMessage(numeroDono, {
      text: `✅ Estoque atualizado! ${produtoRepor.nome} agora tem ${consultarEstoque(produtoId)} unidade(s).`,
    });
    return true;
  }

  if (partes[0] === 'frete' && partes.length === 3) {
    const pedidoId = Number(partes[1]);
    const valorFrete = Number(partes[2].replace(',', '.'));

    if (!Number.isInteger(pedidoId) || isNaN(valorFrete) || valorFrete < 0) {
      await sock.sendMessage(numeroDono, { text: 'Uso: *frete [número do pedido] [valor]*, ex: frete 12 5.50' });
      return true;
    }

    const pedido = buscarPedidoPorId(pedidoId);
    if (!pedido) {
      await sock.sendMessage(numeroDono, { text: `Não encontrei o pedido nº ${pedidoId}.` });
      return true;
    }
    if (pedido.status !== 'aguardando_frete_manual') {
      await sock.sendMessage(numeroDono, {
        text: `O pedido nº ${pedidoId} não está aguardando frete (status atual: ${pedido.status}).`,
      });
      return true;
    }

    db.transaction(() => {
      definirFretePedido(pedidoId, valorFrete);
      atualizarStatusPedido(pedidoId, 'aguardando_pagamento');
      marcarPedido(pedidoId, 'pix_enviado', 0);
    })();

    await sock.sendMessage(numeroDono, {
      text: `✅ Frete do pedido nº ${pedidoId} definido em R$ ${valorFrete.toFixed(2)}. Mandando instruções de pagamento pro cliente...`,
    });

    await enviarInstrucoesPagamento(sock, pedido.numero_cliente, pedidoId, pedido.itens, valorFrete);
    return true;
  }

  if (partes.length !== 2 || !['confirmar', 'recusar'].includes(partes[0])) {
    return false;
  }

  const [comando, idTexto] = partes;
  const id = Number(idTexto);
  const pedido = buscarPedidoPorId(id);

  if (!pedido) {
    await sock.sendMessage(numeroDono, { text: `Não encontrei o pedido nº ${idTexto}.` });
    return true;
  }

  // Regras de status:
  // - confirmar: pedido pendente, OU recusado por engano (re-reserva o estoque)
  // - recusar: só pedido pendente (evita devolver o estoque em dobro)
  const pendentes = ['aguardando_confirmacao_dono', 'aguardando_pagamento'];
  const podeConfirmar = pendentes.includes(pedido.status) || pedido.status === 'pagamento_recusado';
  const podeRecusar = pendentes.includes(pedido.status);

  if ((comando === 'confirmar' && !podeConfirmar) || (comando === 'recusar' && !podeRecusar)) {
    await sock.sendMessage(numeroDono, {
      text: `O pedido nº ${id} já foi finalizado (status atual: *${pedido.status}*). Nada foi alterado.`,
    });
    return true;
  }

  const novoStatus = comando === 'confirmar' ? 'pago' : 'pagamento_recusado';

  const aplicar = db.transaction(() => {
    // Confirmando um pedido que tinha sido recusado: o estoque já tinha voltado,
    // então precisa reservar de novo (se ainda houver)
    if (novoStatus === 'pago' && pedido.status === 'pagamento_recusado') {
      const necessario = {};
      for (const item of pedido.itens) necessario[item.id] = (necessario[item.id] || 0) + 1;
      for (const [pid, qtd] of Object.entries(necessario)) {
        if (consultarEstoque(Number(pid)) < qtd) return { ok: false };
      }
      for (const item of pedido.itens) baixarEstoque(item.id, 1);
    }

    atualizarStatusPedido(id, novoStatus);
    marcarPedido(id, 'resultado_notificado', 0);

    if (novoStatus === 'pagamento_recusado') {
      for (const item of pedido.itens) reporEstoque(item.id, 1);
    }

    // Se o cliente ainda está "esperando comprovante" DESTE pedido, encerra essa etapa
    const estadoCliente = getEstado(pedido.numero_cliente);
    const ultimo = ultimoPedidoDoCliente(pedido.numero_cliente);
    if (estadoCliente?.etapa === 'aguardando_comprovante' && ultimo?.id === id) {
      resetarEstado(pedido.numero_cliente);
    }
    return { ok: true };
  })();

  if (!aplicar.ok) {
    await sock.sendMessage(numeroDono, {
      text: `⚠️ Não dá pra confirmar o pedido nº ${id}: não há mais estoque suficiente dos itens dele. Use *repor* antes, se for o caso.`,
    });
    return true;
  }

  await enviarResultadoAoCliente(sock, { ...pedido, status: novoStatus });
  await sock.sendMessage(numeroDono, {
    text: `Pedido nº ${id} marcado como *${novoStatus === 'pago' ? 'pago' : 'pagamento recusado'}*.`,
  });

  return true;
}