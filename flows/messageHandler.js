import fs from 'node:fs';
import {
  transacao, getEstado, criarEstado, atualizarEstado, resetarEstado, salvarPedido,
  buscarPedidoPorId, buscarPedidosPorStatus, atualizarStatusPedido,
  definirFretePedido, marcarPedido, ultimoPedidoDoCliente, registrarResolucao,
} from '../database/db.js';
import {
  CATALOGO, formatarCatalogo, mensagemBoasVindas, buscarProdutoPorTicket, nomeParaCliente, formatarPreco,
  PROMOCAO_ATUAL, MINIMO_PEDIDOS_PARA_RANKING, COMO_PEDIR, PROXIMO_PASSO,
} from '../database/catalogo.js';
import { maisVendidos } from '../database/vendas.js';
import {
  interpretarItens, ehFim, ehPedidoDeCatalogo, ehSoConversa, lerAcoes, lerCancelamento, lerConfirmacao,
  querTrocarEndereco, lerQuantidadeResposta, ehMaisUmDoUltimo, ehPedidoDeCarrinho, lerPerguntaSobreProdutos,
  lerPerguntaFrequente, lerPagamentoFeito, temIntencaoDePedir,
} from './interpretar.js';
import { statusHorario } from '../jobs/horario.js';
import { PIX_CHAVE, PIX_NOME_BENEFICIARIO, PIX_CIDADE } from '../database/pagamento.js';
import { gerarPayloadPix } from '../database/pixPayload.js';
import {
  consultarEstoque, baixarEstoque, reporEstoque, formatarEstoque,
  USUARIO_BOT, USUARIO_DONO_WHATSAPP,
} from '../database/estoque.js';
import { formatarPrevisao } from '../database/relatorios.js';
import { formatarResumoDoDia } from '../jobs/resumoDiario.js';
import { calcularFrete, calcularFretePorCoordenadas } from '../database/frete.js';
import { NUMEROS_DONOS } from '../database/donos.js';
import {
  salvarArquivoComprovante, registrarComprovante, comprovanteRepetido, somaDosComprovantes,
  ultimoComprovanteDoPedido, buscarComprovante, caminhoDoArquivo, registrarAvisoDono, avisoDono,
} from '../database/comprovantes.js';
import { lerComprovante, prepararArquivoParaGuardar, nomesParecidos } from './lerComprovante.js';
import { lerComandoDono, lerValor, sentidoDoEmoji } from './interpretarDono.js';

const MAX_TENTATIVAS_ENDERECO = 2;

const HORAS_PARA_EXPIRAR_CONVERSA = 24;
const ETAPAS_QUE_EXPIRAM = ['aguardando_produto', 'aguardando_endereco', 'aguardando_confirmacao'];
const ETAPAS_COM_CARRINHO_ABERTO = ['aguardando_produto', 'aguardando_endereco', 'aguardando_confirmacao'];

const SO_REMOVEU = PROXIMO_PASSO;
const PEDIR_ENDERECO_DE_NOVO = '📍 Agora só falta o seu *endereço completo* pra entrega (rua, número e bairro).';
const OPCOES_CONFIRMACAO = 'Digite *A* para confirmar, *B* para cancelar, *remover* pra tirar o último item ou *endereço* pra trocar o endereço.';

const MINUTOS_ENTRE_LOCALIZACOES_AO_VIVO = 30;
const MINUTOS_ENTRE_LEMBRETES_DE_FRETE = 10;

const filasPorCliente = new Map();
const ultimaLocalizacaoAoVivo = new Map();
const ultimoLembreteDeFrete = new Map();
const tentativasIlegiveis = new Map();
const pixEnviadoEm = new Map();
const MINUTOS_PARA_IGNORAR_CONFIRMACAO_REPETIDA = 3;

function ehAtualizacaoDeLocalizacao(numero) {
  const agora = Date.now();
  const anterior = ultimaLocalizacaoAoVivo.get(numero);
  ultimaLocalizacaoAoVivo.set(numero, agora);
  return anterior !== undefined && agora - anterior < MINUTOS_ENTRE_LOCALIZACOES_AO_VIVO * 60 * 1000;
}

const TIPOS_DE_ARQUIVO_ACEITOS = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);

function arquivoRecebido(arquivo) {
  if (!arquivo) return null;
  if (Buffer.isBuffer(arquivo)) return arquivo.length ? { buffer: arquivo, tipo: 'image/jpeg' } : null;
  if (!arquivo.buffer?.length) return null;
  const tipo = String(arquivo.tipo || 'image/jpeg').toLowerCase().split(';')[0].trim();
  return TIPOS_DE_ARQUIVO_ACEITOS.has(tipo) ? { buffer: arquivo.buffer, tipo } : null;
}

export function tratarMensagem(sock, numero, texto, nomeCliente, arquivo = null, localizacao = null) {
  if (localizacao?.aoVivo && ehAtualizacaoDeLocalizacao(numero)) return Promise.resolve();
  const recebido = arquivoRecebido(arquivo);
  const anterior = filasPorCliente.get(numero) || Promise.resolve();
  const atual = anterior
    .catch(() => {})
    .then(() => processarMensagemCliente(sock, numero, texto, nomeCliente, recebido, localizacao));

  filasPorCliente.set(numero, atual);
  atual
    .catch(() => {})
    .finally(() => {
      if (filasPorCliente.get(numero) === atual) filasPorCliente.delete(numero);
    });

  return atual;
}

async function processarMensagemCliente(sock, numero, texto, nomeCliente, arquivo, localizacao = null) {
  const status = statusHorario();
  const pagandoPedido = status !== 'aberto' && (
    getEstado(numero)?.etapa === 'aguardando_comprovante' || (!!arquivo && !!pedidoEsperandoComprovante(numero))
  );
  if (!pagandoPedido && status === 'antes_da_abertura') {
    await sock.sendMessage(numero, {
      text: '🌅 Ainda não abrimos! Nosso horário de pedidos começa às 6h30. Volte mais tarde 🙂',
    });
    return;
  }
  if (!pagandoPedido && status === 'fechado') {
    await sock.sendMessage(numero, {
      text: '⏰ Nosso horário de pedidos de hoje já encerrou (até 18h). Volte amanhã, vamos adorar te atender!',
    });
    return;
  }

  let estado = getEstado(numero);

  if (estado && ETAPAS_QUE_EXPIRAM.includes(estado.etapa) && conversaExpirada(estado)) {
    resetarEstado(numero);
    criarEstado(numero);
    await sock.sendMessage(numero, {
      text:
        '👋 Que bom te ver de novo! Seu pedido anterior não foi finalizado, então vamos começar um novo 👇\n\n' +
        formatarCatalogo(consultarEstoque),
    });
    if (!localizacao) return;
    estado = getEstado(numero);
  }

  if (localizacao) {
    await tratarLocalizacao(sock, numero, localizacao, estado, nomeCliente);
    return;
  }

  if (arquivo && (!estado || (estado.etapa === 'aguardando_produto' && !estado.carrinho.length && !estado.pendencia))) {
    if (await tratarComprovanteForaDoFluxo(sock, numero, arquivo, nomeCliente)) return;
  }

  if (!estado) {
    if (!arquivo && await responderDepoisDoPedido(sock, numero, texto, nomeCliente)) return;
    await iniciarConversa(sock, numero, texto, nomeCliente);
    return;
  }

  if (ETAPAS_COM_CARRINHO_ABERTO.includes(estado.etapa)) {
    const resolvido = await tratarCarrinhoAberto(sock, numero, texto, estado, nomeCliente);
    if (resolvido) return;
  }

  switch (estado.etapa) {
    case 'aguardando_produto':
      await tratarEscolhaProduto(sock, numero, texto, estado);
      break;

    case 'aguardando_endereco':
      await tratarEndereco(sock, numero, texto, estado);
      break;

    case 'aguardando_confirmacao':
      await sock.sendMessage(numero, { text: `Não entendi 🤔 ${OPCOES_CONFIRMACAO}` });
      break;

    case 'aguardando_comprovante':
      await tratarComprovante(sock, numero, arquivo, texto, nomeCliente);
      break;

    default:
      resetarEstado(numero);
      await iniciarConversa(sock, numero, texto, nomeCliente);
  }
}

async function tratarLocalizacao(sock, numero, local, estado, nomeCliente) {
  if (!estado) {
    criarEstado(numero);
    await sock.sendMessage(numero, { text: mensagemBoasVindas(nomeCliente, consultarEstoque) });
    estado = getEstado(numero);
  }

  if (estado.etapa === 'aguardando_produto') {
    atualizarEstado(numero, {
      latitude: local.latitude, longitude: local.longitude, endereco: enderecoDaLocalizacao(local), pendencia: null,
    });
    const depois = estado.carrinho.length
      ? `${resumoCarrinho(estado.carrinho)}\n\nQuando terminar de escolher, digite *fim*.`
      : `Agora é só escolher os sabores 🙂 ${COMO_PEDIR}`;
    await sock.sendMessage(numero, { text: `📍 Recebi sua localização! Vou usar ela pra entrega.\n\n${depois}` });
    return;
  }

  if (estado.etapa === 'aguardando_endereco' || estado.etapa === 'aguardando_confirmacao') {
    if (local.aoVivo && estado.etapa === 'aguardando_confirmacao' && estado.latitude != null) return;
    await confirmarComEndereco(sock, numero, estado, { local });
  }
}

async function tratarCarrinhoAberto(sock, numero, texto, estado, nomeCliente) {
  if (estado.pendencia) {
    if (await responderPendencia(sock, numero, texto, estado)) return true;
    atualizarEstado(numero, { pendencia: null });
    estado = { ...estado, pendencia: null };
  }

  if (estado.etapa === 'aguardando_confirmacao') {
    const resposta = lerConfirmacao(texto);
    if (resposta === 'confirmar') {
      await confirmarPedido(sock, numero, estado, nomeCliente);
      return true;
    }
    if (resposta === 'cancelar') {
      await cancelarPedido(sock, numero);
      return true;
    }
    if (querTrocarEndereco(texto)) {
      atualizarEstado(numero, { etapa: 'aguardando_endereco', tentativas_endereco: 0 });
      await sock.sendMessage(numero, { text: '📍 Beleza! Me manda o endereço certo (rua, número e bairro).' });
      return true;
    }
    if (resposta === 'duvida') {
      await sock.sendMessage(numero, {
        text:
          'Sem problema! O que você quer fazer?\n\n' +
          '*A* confirma o pedido\n*B* cancela o pedido\n*remover* tira o último item\n*endereço* troca o endereço\n\n' +
          'Ou manda mais sabores que eu coloco no carrinho.',
      });
      return true;
    }
  } else if (lerCancelamento(texto)) {
    await cancelarPedido(sock, numero);
    return true;
  }

  const acoes = lerAcoes(texto);
  if (acoes) {
    await executarAcoes(sock, numero, estado, acoes);
    return true;
  }

  if (ehPedidoDeCarrinho(texto)) {
    await mostrarCarrinho(sock, numero, estado);
    return true;
  }

  const pergunta = lerPerguntaSobreProdutos(texto);
  if (pergunta) {
    await responderPergunta(sock, numero, estado, pergunta);
    return true;
  }

  const frequente = lerPerguntaFrequente(texto);
  if (frequente && frequente !== 'pergunta' && !temIntencaoDePedir(texto)) {
    await responderPerguntaFrequente(sock, numero, estado, frequente);
    return true;
  }

  if (estado.etapa === 'aguardando_produto') return false;

  const pedido = interpretarItens(texto);
  if (pedido.itens.length && pedido.temNome && !pedido.desconhecidos.length && !pedido.invalidas.length) {
    await executarAcoes(sock, numero, estado, [{ tipo: 'adicionar', ...pedido }]);
    return true;
  }

  if (estado.etapa === 'aguardando_endereco' && (ehFim(texto) || ehSoConversa(texto))) {
    await sock.sendMessage(numero, { text: PEDIR_ENDERECO_DE_NOVO });
    return true;
  }

  if (estado.etapa === 'aguardando_endereco' && frequente === 'pergunta') {
    await sock.sendMessage(numero, { text: `🤔 Essa eu não sei responder por aqui, desculpa!\n\n${PEDIR_ENDERECO_DE_NOVO}` });
    return true;
  }

  return false;
}

async function iniciarConversa(sock, numero, texto, nomeCliente) {
  criarEstado(numero);
  await sock.sendMessage(numero, { text: mensagemBoasVindas(nomeCliente, consultarEstoque) });

  const pedido = interpretarItens(texto);
  if (pedido.itens.length && !pedido.desconhecidos.length && !lerPerguntaSobreProdutos(texto)) {
    await executarAcoes(sock, numero, getEstado(numero), [{ tipo: 'adicionar', ...pedido }]);
  }
}

function conversaExpirada(estado) {
  if (!estado.atualizado_em) return false;
  const ultimaAtividade = new Date(estado.atualizado_em.replace(' ', 'T') + 'Z');
  const horasParado = (Date.now() - ultimaAtividade.getTime()) / (1000 * 60 * 60);
  return horasParado > HORAS_PARA_EXPIRAR_CONVERSA;
}

async function tratarEscolhaProduto(sock, numero, texto, estado) {
  if (!String(texto ?? '').trim()) {
    await sock.sendMessage(numero, { text: `🙂 Por aqui eu só consigo ler mensagens de texto. ${COMO_PEDIR}` });
    return;
  }

  if (ehFim(texto)) {
    if (estado.carrinho.length === 0) {
      await sock.sendMessage(numero, { text: `Você ainda não escolheu nenhum produto. ${COMO_PEDIR}` });
      return;
    }
    if (estado.latitude != null) {
      await confirmarComEndereco(sock, numero, estado, {
        local: { latitude: estado.latitude, longitude: estado.longitude },
        enderecoPronto: estado.endereco,
      });
      return;
    }
    atualizarEstado(numero, { etapa: 'aguardando_endereco' });
    await sock.sendMessage(numero, {
      text:
        `${resumoDetalhado(estado.carrinho)}\n\n` +
        'Tá certo? Então me manda seu *endereço completo* pra entrega 📍 (ou sua *localização* pelo 📎 do WhatsApp)\n' +
        'Se quiser mudar alguma coisa, é só mandar mais sabores ou *remover*.',
    });
    return;
  }

  if (estado.carrinho.length && ehMaisUmDoUltimo(texto)) {
    const ultimo = estado.carrinho[estado.carrinho.length - 1];
    await executarAcoes(sock, numero, estado, [{ tipo: 'adicionar', itens: [{ produto: ultimo, qtd: 1, explicita: true }] }]);
    return;
  }

  const pedido = interpretarItens(texto);
  if (pedido.itens.length) {
    await executarAcoes(sock, numero, estado, [{ tipo: 'adicionar', ...pedido }]);
    return;
  }

  if (ehPedidoDeCatalogo(texto)) {
    await sock.sendMessage(numero, { text: formatarCatalogo(consultarEstoque) });
    return;
  }

  if (pedido.invalidas.length) {
    await sock.sendMessage(numero, { text: `${avisoOpcoesInvalidas(pedido.invalidas)}\n\n${COMO_PEDIR}` });
    return;
  }

  if (ehSoConversa(texto)) {
    const carrinho = estado.carrinho.length
      ? `\n\n${resumoCarrinho(estado.carrinho)}\n\n${PROXIMO_PASSO}`
      : '';
    await sock.sendMessage(numero, { text: `😊 ${COMO_PEDIR}${carrinho}` });
    return;
  }

  if (lerPerguntaFrequente(texto) === 'pergunta') {
    await sock.sendMessage(numero, { text: `🤔 Essa eu não sei responder por aqui, desculpa!\n\n${proximoPassoDaEtapa(estado.etapa, estado.carrinho)}` });
    return;
  }

  await sock.sendMessage(numero, {
    text:
      `🤔 Não encontrei esse sabor. ${COMO_PEDIR}\n\n` +
      '📋 Pra ver a lista de novo, mande *catálogo*.',
  });
}

function juntar(lista) {
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} e ${lista[lista.length - 1]}`;
}

const quantosItens = (n) => `${n} ${n === 1 ? 'item' : 'itens'}`;
const comQuantidade = (produto, qtd) => `*${qtd > 1 ? `${qtd}x ` : ''}${nomeParaCliente(produto)}*`;
const contar = (carrinho, produtoId) => carrinho.filter(p => p.id === produtoId).length;

function avisoOpcoesInvalidas(invalidas) {
  const unicas = [...new Set(invalidas)].map(n => `*${n}*`);
  const inicio = unicas.length === 1 ? `Não temos a opção ${unicas[0]}` : `Não temos as opções ${juntar(unicas)}`;
  return `🤔 ${inicio} (as opções vão de *1* a *${CATALOGO.length}*).`;
}

function agrupar(carrinho) {
  const grupos = new Map();
  for (const p of carrinho) {
    if (!grupos.has(p.id)) grupos.set(p.id, { produto: p, qtd: 0 });
    grupos.get(p.id).qtd++;
  }
  return [...grupos.values()];
}

function listarCarrinho(carrinho) {
  return agrupar(carrinho).map(({ produto, qtd }) => `${qtd > 1 ? `${qtd}x ` : ''}${nomeParaCliente(produto)}`).join(', ');
}

function resumoCarrinho(carrinho) {
  if (!carrinho.length) return '🛒 Seu carrinho está vazio agora.';
  const total = carrinho.reduce((soma, p) => soma + p.preco, 0);
  return `🛒 Seu carrinho: ${listarCarrinho(carrinho)}\n${quantosItens(carrinho.length)} · ${formatarPreco(total)}`;
}

function linhasDoPedido(carrinho) {
  return agrupar(carrinho)
    .map(({ produto, qtd }) => `- ${qtd > 1 ? `${qtd}x ` : ''}${nomeParaCliente(produto)} · ${formatarPreco(produto.preco * qtd)}`)
    .join('\n');
}

function resumoDetalhado(carrinho) {
  const total = carrinho.reduce((soma, p) => soma + p.preco, 0);
  return `🧾 *Seu pedido:*\n${linhasDoPedido(carrinho)}\n*Total: ${formatarPreco(total)}* (${quantosItens(carrinho.length)})`;
}

function proximoPassoDaEtapa(etapa, carrinho) {
  if (!carrinho.length) return COMO_PEDIR;
  if (etapa === 'aguardando_endereco') return PEDIR_ENDERECO_DE_NOVO;
  if (etapa === 'aguardando_confirmacao') return OPCOES_CONFIRMACAO;
  return PROXIMO_PASSO;
}

function textoDoPreco() {
  const precos = [...new Set(CATALOGO.map(p => p.preco))];
  return precos.length === 1 ? `Todos os sabores estão ${formatarPreco(precos[0])}.` : 'Os preços estão no catálogo (digite *catálogo*).';
}

function textoDoRanking() {
  const { pedidosPagos, ranking } = maisVendidos({ limite: 5 });
  const lista = ranking
    .map(({ id }) => CATALOGO.find(p => p.id === id))
    .filter(Boolean)
    .slice(0, 3);
  if (pedidosPagos < MINIMO_PEDIDOS_PARA_RANKING || !lista.length) {
    return 'Ainda estamos montando o ranking dos mais pedidos 🙂 Por enquanto todos os sabores estão saindo bem! Dá uma olhada no catálogo e escolhe o seu.';
  }
  const medalhas = ['🥇', '🥈', '🥉'];
  const linhas = lista.map((p, i) => {
    const esgotado = consultarEstoque(p.id) <= 0 ? ' _(esgotado agora)_' : '';
    return `${medalhas[i]} *${p.opcao}.* ${p.sabor}${esgotado}`;
  });
  return `🏆 *Os mais pedidos pela galera:*\n${linhas.join('\n')}`;
}

async function responderPerguntaFrequente(sock, numero, estado, assunto) {
  const respostas = {
    desconto: PROMOCAO_ATUAL
      ? `🎉 ${PROMOCAO_ATUAL}`
      : `No momento a gente não tem nenhuma promoção ou desconto 🙂 ${textoDoPreco()}`,
    ranking: textoDoRanking(),
    pagamento: '💳 Por aqui o pagamento é só por *Pix*. Quando você fecha o pedido, eu te mando o QR code e o copia e cola, e você me manda o print do comprovante 📸',
    horario: '⏰ Os pedidos por aqui funcionam das *6h30 às 18h*.',
    loja: '🛵 A gente trabalha só com *entrega*: não temos loja aberta ao público. Você pede por aqui e a gente leva até você! No fim do pedido é só mandar seu endereço ou sua *localização* 📍',
    entrega: '🚚 A gente entrega sim! O frete é calculado quando você fecha o pedido, pelo seu endereço ou localização, e pra quem está perto é *grátis*.',
  };
  const resposta = respostas[assunto];
  if (!resposta) return;
  await sock.sendMessage(numero, { text: `${resposta}\n\n${proximoPassoDaEtapa(estado.etapa, estado.carrinho)}` });
}

async function mostrarCarrinho(sock, numero, estado) {
  if (!estado.carrinho.length) {
    await sock.sendMessage(numero, { text: `🛒 Seu carrinho está vazio. ${COMO_PEDIR}` });
    return;
  }
  await sock.sendMessage(numero, {
    text: `${resumoDetalhado(estado.carrinho)}\n\n${proximoPassoDaEtapa(estado.etapa, estado.carrinho)}`,
  });
}

async function responderPergunta(sock, numero, estado, pergunta) {
  if (pergunta.tipo === 'precos') {
    await sock.sendMessage(numero, { text: formatarCatalogo(consultarEstoque) });
    return;
  }
  const vistos = new Map();
  for (const item of pergunta.itens) {
    const atual = vistos.get(item.produto.id);
    vistos.set(item.produto.id, { produto: item.produto, qtd: (atual?.qtd || 0) + (item.explicita ? item.qtd : 1), explicita: item.explicita || atual?.explicita });
  }
  const linhas = [];
  for (const { produto, qtd, explicita } of vistos.values()) {
    const nome = nomeParaCliente(produto);
    const estoque = consultarEstoque(produto.id);
    if (estoque <= 0) linhas.push(`😕 *${nome}* está esgotado no momento.`);
    else if (pergunta.tipo === 'preco' && explicita && qtd > 1) linhas.push(`💰 *${qtd}x ${nome}*: ${formatarPreco(produto.preco * qtd)}`);
    else if (pergunta.tipo === 'preco') linhas.push(`💰 *${nome}*: ${formatarPreco(produto.preco)}`);
    else linhas.push(`✅ Tem *${nome}* sim! ${formatarPreco(produto.preco)}`);
  }
  const disponiveis = [...vistos.values()].filter(({ produto }) => consultarEstoque(produto.id) > 0);
  const dica = disponiveis.length
    ? `Pra colocar no carrinho, é só mandar ${juntar(disponiveis.map(({ produto }) => `*${produto.opcao}*`))}.`
    : COMO_PEDIR;
  await sock.sendMessage(numero, { text: `${linhas.join('\n')}\n\n${dica}` });
}

async function executarAcoes(sock, numero, estado, acoes) {
  const carrinho = [...estado.carrinho];
  const vazioAntes = carrinho.length === 0;
  const adicionados = new Map();
  const removidos = new Map();
  const naoEstavam = [];
  const invalidas = [];
  const desconhecidos = [];
  const pedidosPorProduto = new Map();
  let esvaziou = false;
  let pergunta = null;
  let tentouRemover = false;

  const somar = (mapa, produto, qtd) => {
    const info = mapa.get(produto.id) || { produto, qtd: 0 };
    info.qtd += qtd;
    mapa.set(produto.id, info);
  };
  const tirar = (produto, qtd) => {
    let tirou = 0;
    for (let k = 0; k < qtd; k++) {
      const indice = carrinho.map(p => p.id).lastIndexOf(produto.id);
      if (indice === -1) break;
      carrinho.splice(indice, 1);
      tirou++;
    }
    if (tirou) somar(removidos, produto, tirou);
  };

  const mantidos = new Map();
  const colocar = (produto, qtd) => {
    if (!pedidosPorProduto.has(produto.id)) {
      pedidosPorProduto.set(produto.id, { produto, pedido: 0, colocado: 0, estoque: consultarEstoque(produto.id) });
    }
    const info = pedidosPorProduto.get(produto.id);
    info.pedido += qtd;
    const cabe = Math.max(0, Math.min(qtd, info.estoque - contar(carrinho, produto.id)));
    for (let k = 0; k < cabe; k++) carrinho.push(produto);
    info.colocado += cabe;
    if (cabe) somar(adicionados, produto, cabe);
  };
  const naoEstava = (produto) => {
    if (!naoEstavam.some(p => p.id === produto.id)) naoEstavam.push(produto);
  };

  for (const acao of acoes) {
    invalidas.push(...(acao.invalidas || []));
    desconhecidos.push(...(acao.desconhecidos || []));

    if (acao.tipo === 'remover') {
      tentouRemover = true;
      if (!carrinho.length) continue;
      if (acao.tudo) {
        const manter = new Map((acao.exceto || []).map(item => [item.produto.id, item.explicita ? item.qtd : Infinity]));
        if (!manter.size) {
          carrinho.length = 0;
          esvaziou = true;
          continue;
        }
        for (const grupo of agrupar(carrinho)) {
          const limite = manter.has(grupo.produto.id) ? manter.get(grupo.produto.id) : 0;
          if (grupo.qtd > limite) tirar(grupo.produto, grupo.qtd - limite);
        }
        for (const item of acao.exceto) {
          if (contar(carrinho, item.produto.id)) mantidos.set(item.produto.id, item.produto);
          else naoEstava(item.produto);
        }
        continue;
      }
      if (acao.ultimo) {
        tirar(carrinho[carrinho.length - 1], 1);
        continue;
      }
      for (const item of acao.itens) {
        const tem = contar(carrinho, item.produto.id);
        if (!tem) {
          naoEstava(item.produto);
        } else if (item.explicita) {
          tirar(item.produto, Math.min(item.qtd, tem));
        } else if (item.plural || tem === 1) {
          tirar(item.produto, tem);
        } else if (!pergunta) {
          pergunta = { tipo: 'quantos_remover', produtoId: item.produto.id, maximo: tem };
        }
      }
      continue;
    }

    if (acao.tipo === 'definir') {
      for (const item of acao.itens) {
        const tem = contar(carrinho, item.produto.id);
        const alvo = item.explicita ? item.qtd : Math.max(tem, 1);
        if (tem > alvo) tirar(item.produto, tem - alvo);
        else if (tem < alvo) colocar(item.produto, alvo - tem);
        mantidos.set(item.produto.id, item.produto);
      }
      if (acao.somente) {
        const ficam = new Set(acao.itens.map(item => item.produto.id));
        for (const grupo of agrupar(carrinho)) {
          if (!ficam.has(grupo.produto.id)) tirar(grupo.produto, grupo.qtd);
        }
      }
      continue;
    }

    for (const { produto, qtd } of acao.itens) colocar(produto, qtd);
  }

  if (tentouRemover && vazioAntes && !adicionados.size) {
    if (estado.etapa !== 'aguardando_produto') atualizarEstado(numero, { etapa: 'aguardando_produto' });
    await sock.sendMessage(numero, { text: `Seu carrinho já está vazio 🙂 ${COMO_PEDIR}` });
    return;
  }

  const linhas = [];
  if (esvaziou) linhas.push('🗑️ Pronto, esvaziei seu carrinho.');
  if (removidos.size) linhas.push(`🗑️ Tirei ${juntar([...removidos.values()].map(i => comQuantidade(i.produto, i.qtd)))} do carrinho.`);
  if (adicionados.size) {
    const lista = [...adicionados.values()];
    linhas.push(lista.length === 1 && lista[0].qtd === 1
      ? `✅ *${nomeParaCliente(lista[0].produto)}* adicionado!`
      : `✅ Adicionei ${juntar(lista.map(i => comQuantidade(i.produto, i.qtd)))}!`);
  }
  for (const info of pedidosPorProduto.values()) {
    if (info.colocado >= info.pedido) continue;
    const nome = nomeParaCliente(info.produto);
    if (info.estoque <= 0) linhas.push(`😕 *${nome}* está esgotado no momento.`);
    else if (info.colocado === 0) linhas.push(`😕 Não tem mais *${nome}*: os ${info.estoque} que temos já estão no seu carrinho.`);
    else linhas.push(`😕 Só tinha mais *${info.colocado}* de *${nome}*, coloquei ${info.colocado === 1 ? 'esse' : 'esses'}.`);
  }
  if (naoEstavam.length) {
    linhas.push(`${juntar(naoEstavam.map(p => `*${nomeParaCliente(p)}*`))} ${naoEstavam.length === 1 ? 'não está' : 'não estão'} no seu carrinho 🤔`);
  }
  const ficaram = [...mantidos.values()]
    .map(produto => ({ produto, qtd: contar(carrinho, produto.id) }))
    .filter(i => i.qtd > 0 && !adicionados.has(i.produto.id));
  if (ficaram.length) {
    linhas.push(`👍 ${ficaram.length === 1 && ficaram[0].qtd === 1 ? 'Ficou' : 'Ficaram'} ${juntar(ficaram.map(i => comQuantidade(i.produto, i.qtd)))} no carrinho.`);
  }
  if (invalidas.length) linhas.push(avisoOpcoesInvalidas(invalidas));
  if (desconhecidos.length) linhas.push(`🤔 Não achei ${juntar([...new Set(desconhecidos)].map(w => `*${w}*`))} no catálogo.`);

  let rodape;
  if (pergunta) {
    const produto = carrinho.find(p => p.id === pergunta.produtoId);
    const nome = nomeParaCliente(produto);
    linhas.push(pergunta.maximo === 2
      ? `❓ Você tem *2x ${nome}* no carrinho. Quer tirar *1* ou os *2*?`
      : `❓ Você tem *${pergunta.maximo}x ${nome}* no carrinho. Quantos quer tirar? (de *1* a *${pergunta.maximo}*)`);
    rodape = 'Responde com o número (ex: *1*). Se não quiser tirar nenhum, digite *nenhum*.';
  }

  const mudou = esvaziou || removidos.size > 0 || adicionados.size > 0;
  const soConfirmouQuantidade = !mudou && mantidos.size > 0;
  if (mudou || pergunta) {
    atualizarEstado(numero, { etapa: 'aguardando_produto', carrinho, tentativas_endereco: 0, pendencia: pergunta });
  }

  if (!rodape) {
    if (soConfirmouQuantidade) rodape = PROXIMO_PASSO;
    else if (!mudou && tentouRemover) rodape = 'Digite *remover* pra tirar o último item.';
    else if (!mudou) rodape = proximoPassoDaEtapa(estado.etapa, carrinho);
    else if (!carrinho.length) rodape = COMO_PEDIR;
    else if (!adicionados.size) rodape = SO_REMOVEU;
    else rodape = PROXIMO_PASSO;
  }

  const resumo = esvaziou && !carrinho.length ? '' : `\n${resumoCarrinho(carrinho)}`;
  await sock.sendMessage(numero, { text: `${linhas.join('\n')}${resumo}\n\n${rodape}` });
}

async function responderPendencia(sock, numero, texto, estado) {
  const pendencia = estado.pendencia;
  if (pendencia?.tipo !== 'quantos_remover') return false;
  const produto = estado.carrinho.find(p => p.id === pendencia.produtoId);
  if (!produto) return false;
  const maximo = contar(estado.carrinho, produto.id);
  const quantos = lerQuantidadeResposta(texto, produto.id, maximo);
  if (quantos === null) return false;

  const carrinho = [...estado.carrinho];
  for (let k = 0; k < quantos; k++) carrinho.splice(carrinho.map(p => p.id).lastIndexOf(produto.id), 1);
  atualizarEstado(numero, { etapa: 'aguardando_produto', carrinho, pendencia: null });

  const nome = nomeParaCliente(produto);
  const titulo = quantos === 0
    ? `👍 Beleza, deixei ${maximo === 1 ? `o *${nome}*` : `os *${maximo}x ${nome}*`} no carrinho.`
    : `🗑️ Tirei ${comQuantidade(produto, quantos)} do carrinho.`;
  const rodape = !carrinho.length ? COMO_PEDIR : quantos === 0 ? PROXIMO_PASSO : SO_REMOVEU;
  await sock.sendMessage(numero, { text: `${titulo}\n${resumoCarrinho(carrinho)}\n\n${rodape}` });
  return true;
}

async function cancelarPedido(sock, numero) {
  resetarEstado(numero);
  await sock.sendMessage(numero, { text: 'Pedido cancelado. Se quiser começar de novo, é só mandar uma mensagem 🙂' });
}

async function tratarEndereco(sock, numero, textoOriginal, estado) {
  if (!textoOriginal || !textoOriginal.trim()) {
    await sock.sendMessage(numero, {
      text: '📍 Me manda seu endereço por escrito (rua, número e bairro) ou sua *localização* pelo 📎 do WhatsApp 🙂',
    });
    return;
  }
  await confirmarComEndereco(sock, numero, estado, { texto: textoOriginal.trim() });
}

function enderecoDaLocalizacao(local) {
  const link = `https://waze.com/ul?ll=${local.latitude.toFixed(6)},${local.longitude.toFixed(6)}&navigate=yes`;
  const descricao = [local.nome, local.endereco].filter(Boolean).join(' - ').slice(0, 150);
  return `Localização do WhatsApp${descricao ? ` (${descricao})` : ''}: ${link}`;
}

function enderecoParaCliente(estado) {
  return estado.latitude != null ? 'a localização que você mandou pelo WhatsApp 📌' : estado.endereco;
}

async function confirmarComEndereco(sock, numero, estado, { texto = null, local = null, enderecoPronto = null }) {
  await sock.sendMessage(numero, {
    text: local ? '📍 Calculando o frete pra sua localização, só um momento...' : '📍 Calculando o frete pro seu endereço, só um momento...',
  });

  let resultadoFrete;
  try {
    resultadoFrete = local
      ? await calcularFretePorCoordenadas(local.latitude, local.longitude)
      : await calcularFrete(texto);
  } catch (erro) {
    console.error('Erro inesperado ao calcular frete:', erro);
    resultadoFrete = { sucesso: false, motivo: 'erro_inesperado' };
  }

  const endereco = enderecoPronto || (local ? enderecoDaLocalizacao(local) : texto);
  const coordenadas = local ? { latitude: local.latitude, longitude: local.longitude } : { latitude: null, longitude: null };

  if (!resultadoFrete.sucesso && !local) {
    const tentativas = (estado.tentativas_endereco || 0) + 1;
    if (tentativas < MAX_TENTATIVAS_ENDERECO) {
      atualizarEstado(numero, { etapa: 'aguardando_endereco', tentativas_endereco: tentativas });
      await sock.sendMessage(numero, {
        text:
          '😕 Não consegui localizar esse endereço no mapa. Pode mandar de novo com mais detalhes ' +
          '(rua, número, bairro), tipo: "Rua Exemplo, 123, Jardim Tal"? Ou manda sua *localização* pelo 📎 do WhatsApp.',
      });
      return;
    }
  }

  const total = estado.carrinho.reduce((soma, p) => soma + p.preco, 0);
  const freteOk = resultadoFrete.sucesso;

  atualizarEstado(numero, {
    etapa: 'aguardando_confirmacao',
    endereco,
    ...coordenadas,
    frete: freteOk ? resultadoFrete.valorFrete : 0,
    frete_confirmado: freteOk ? 1 : 0,
    tentativas_endereco: 0,
    pendencia: null,
  });

  const paraCliente = enderecoParaCliente({ ...coordenadas, endereco });
  const resumo = linhasDoPedido(estado.carrinho);

  if (!freteOk) {
    await sock.sendMessage(numero, {
      text:
        `📋 *Confirme seu pedido:*\n\n${resumo}\n\n` +
        `🚚 Frete: *a confirmar* (nossa equipe vai calcular e te avisar o valor antes do pagamento)\n\n` +
        `*Subtotal (sem frete): ${formatarPreco(total)}*\n📍 Entrega: ${paraCliente}\n\n` +
        OPCOES_CONFIRMACAO,
    });
    return;
  }

  const linhaFrete = resultadoFrete.gratis
    ? '🚚 Frete: *Grátis*'
    : `🚚 Frete: ${formatarPreco(resultadoFrete.valorFrete)}`;

  await sock.sendMessage(numero, {
    text:
      `📋 *Confirme seu pedido:*\n\n${resumo}\n\n` +
      `${linhaFrete}\n\n` +
      `*Total: ${formatarPreco(total + resultadoFrete.valorFrete)}*\n📍 Entrega: ${paraCliente}\n\n` +
      OPCOES_CONFIRMACAO,
  });
}

function contarPorProduto(itens) {
  const contagem = {};
  for (const item of itens) contagem[item.id] = (contagem[item.id] || 0) + 1;
  return contagem;
}

const fecharPedidoAtomico = transacao((numero, nomeCliente, estado) => {
  const necessarioPorProduto = contarPorProduto(estado.carrinho);

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

  for (const [produtoId, quantidade] of Object.entries(necessarioPorProduto)) {
    baixarEstoque(Number(produtoId), quantidade, { motivo: 'venda_bot', pedidoId, usuario: USUARIO_BOT });
  }

  atualizarEstado(numero, { etapa: 'aguardando_comprovante' });

  return { ok: true, pedidoId };
});

async function confirmarPedido(sock, numero, estado, nomeCliente) {
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

  await enviarPixComSeguranca(sock, numero, pedidoId, estado.carrinho, estado.frete, nomeCliente);
}

async function enviarComTentativas(enviar, tentativas = 3) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await enviar();
    } catch (erro) {
      ultimoErro = erro;
      if (i < tentativas - 1) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw ultimoErro;
}

async function enviarInstrucoesPagamento(sock, numero, pedidoId, carrinho, frete, nomeCliente = '') {
  const totalItens = carrinho.reduce((soma, p) => soma + p.preco, 0);
  const total = totalItens + (frete || 0);
  const primeiro = primeiroNome(nomeCliente);

  const payloadPix = gerarPayloadPix({
    chave: PIX_CHAVE,
    nome: PIX_NOME_BENEFICIARIO,
    cidade: PIX_CIDADE,
    valor: total,
    txid: `PEDIDO${pedidoId}`,
  });

  await enviarComTentativas(() => sock.sendMessage(numero, {
    text:
      `💳 *${primeiro ? `${primeiro}, seu pedido está reservado!` : 'Seu pedido está reservado!'}*\n` +
      `Total: *${formatarPreco(total)}*\n\n` +
      '1️⃣ Copie o código Pix aqui embaixo 👇\n' +
      '2️⃣ Pague no app do seu banco (Pix *copia e cola*)\n' +
      '3️⃣ Mande aqui o *print do comprovante* 📸',
  }));
  await enviarComTentativas(() => sock.sendMessage(numero, { text: payloadPix }));

  marcarPedido(pedidoId, 'pix_enviado');
  pixEnviadoEm.set(pedidoId, Date.now());
}

async function enviarPixComSeguranca(sock, numero, pedidoId, carrinho, frete, nomeCliente = '') {
  try {
    await enviarInstrucoesPagamento(sock, numero, pedidoId, carrinho, frete, nomeCliente);
    return true;
  } catch (erro) {
    console.error('Não consegui mandar o Pix pro cliente:', erro.message);
    marcarPedido(pedidoId, 'pix_enviado', 0);
    try {
      await sock.sendMessage(numero, { text: '😕 Tive um probleminha pra mandar o seu Pix. Mande *pix* daqui a pouquinho que eu te mando de novo 🙏' });
    } catch {}
    return false;
  }
}

const AVISO_DA_LOJA = '🏪 *Só pra loja* (o cliente não vê esta mensagem)';

function primeiroNome(nome) {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0] || '';
  if (!/^[A-Za-zÀ-ÿ]{2,20}$/.test(primeiro)) return '';
  const tudoIgual = primeiro === primeiro.toLowerCase() || primeiro === primeiro.toUpperCase();
  return tudoIgual ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : primeiro;
}

function telefoneDe(numero) {
  const texto = String(numero ?? '');
  return texto.endsWith('@s.whatsapp.net') ? texto.split('@')[0] : '';
}

function nomeCurto(pedido) {
  return primeiroNome(pedido.nome_cliente) || 'cliente sem nome';
}

function itensParaDono(itens) {
  return agrupar(itens).map(({ produto, qtd }) => `${qtd > 1 ? `${qtd}x ` : ''}${nomeParaCliente(produto)}`).join(', ');
}

function clienteParaDono(nome, numero) {
  const telefone = telefoneDe(numero);
  const nomeLegivel = /[a-zA-ZÀ-ÿ]/.test(nome || '') ? nome.trim() : '';
  if (nomeLegivel && telefone) return `${nomeLegivel} (${telefone})`;
  return nomeLegivel || telefone || 'sem nome';
}

function coordenadasDoEndereco(endereco) {
  const m = String(endereco ?? '').match(/[?&](?:q|ll)=(-?\d{1,2}\.\d+),\s?(-?\d{1,3}\.\d+)/);
  return m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : null;
}

function linkWaze(endereco) {
  const coordenadas = coordenadasDoEndereco(endereco);
  if (coordenadas) {
    return `https://waze.com/ul?ll=${coordenadas.latitude.toFixed(6)},${coordenadas.longitude.toFixed(6)}&navigate=yes`;
  }
  const texto = String(endereco ?? '').trim();
  return texto ? `https://waze.com/ul?q=${encodeURIComponent(texto)}&navigate=yes` : null;
}

function enderecoSemLink(endereco) {
  return String(endereco ?? '').replace(/:?\s*https?:\/\/\S+/g, '').trim();
}

function linhasDeEntrega(endereco) {
  const waze = linkWaze(endereco);
  return `📍 ${enderecoSemLink(endereco) || 'Localização do WhatsApp'}` + (waze ? `\n🧭 Waze: ${waze}` : '');
}

function linhaDoFrete(pedido) {
  if (pedido.status === 'aguardando_frete_manual') return '🚚 Frete: a calcular';
  return `🚚 Frete: ${pedido.frete > 0 ? formatarPreco(pedido.frete) : 'Grátis'}`;
}

async function enviarParaDonos(sock, conteudo, { pedidoId = null, tipo = null } = {}) {
  let enviados = 0;
  for (const dono of NUMEROS_DONOS) {
    try {
      const enviada = await sock.sendMessage(dono, conteudo);
      enviados++;
      if (pedidoId && tipo) registrarAvisoDono(enviada?.key?.id, pedidoId, tipo);
    } catch (erro) {
      console.error('Não consegui mandar o aviso pra um dos donos:', erro.message);
    }
  }
  return enviados;
}

function avisarDonos(sock, texto, opcoes) {
  return enviarParaDonos(sock, { text: `${AVISO_DA_LOJA}\n\n${texto}` }, opcoes);
}

function textoDoAvisoDeFrete(pedido, titulo) {
  return (
    `${titulo}\n\n` +
    `👤 Cliente: ${clienteParaDono(pedido.nome_cliente, pedido.numero_cliente)}\n` +
    `🛒 ${itensParaDono(pedido.itens)}\n` +
    `💵 Produtos: ${formatarPreco(pedido.itens.reduce((s, i) => s + i.preco, 0))}\n` +
    `${linhasDeEntrega(pedido.endereco)}\n\n` +
    '👉 Calcule o frete e *responda esta mensagem só com o valor* (ex: *5* ou *7,50*, ou *grátis*).\n' +
    `_pedido ${pedido.id}_`
  );
}

async function enviarAvisoFreteManual(sock, numero, pedidoId, carrinho, endereco, nomeCliente) {
  const primeiro = primeiroNome(nomeCliente);
  await sock.sendMessage(numero, {
    text:
      `📦 *${primeiro ? `${primeiro}, seu pedido foi registrado!` : 'Seu pedido foi registrado!'}*\n\n` +
      'O frete pro seu endereço vai ser calculado pela nossa equipe. Assim que tiver o valor, ' +
      'te mando o total e o Pix aqui mesmo. Aguarde só um pouquinho! 🙏\n\n' +
      'Se mudar de ideia, é só digitar *cancelar*.',
  });

  const pedido = { id: pedidoId, numero_cliente: numero, nome_cliente: nomeCliente, itens: carrinho, endereco };
  const enviados = await avisarDonos(sock, textoDoAvisoDeFrete(pedido, `🚚 *Frete pra calcular: ${nomeCurto(pedido)}*`), { pedidoId, tipo: 'frete' });
  if (enviados) marcarPedido(pedidoId, 'dono_notificado');
}

function formatarData(data, hora) {
  if (!data) return null;
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}${hora ? ` às ${hora}` : ''}`;
}

function comBanco(nome, banco) {
  return [nome, banco].filter(Boolean).join(' · ');
}

function linhasDoComprovante(pedido, comprovante, soma) {
  const total = totalDoPedido(pedido);
  if (!comprovante) return ['❔ O cliente não mandou comprovante. Confira no extrato do banco.'];
  if (!comprovante.leu_o_comprovante) return ['⚠️ *Não consegui ler esse comprovante.* Confira a imagem com atenção.'];

  const linhas = [];
  if (comprovante.valor == null) linhas.push('❔ Valor: não consegui ler');
  else if (comprovante.valor_confere) linhas.push(`✅ Valor: ${formatarPreco(comprovante.valor)}`);
  else {
    const diferenca = Math.round(Math.abs(total - comprovante.valor) * 100) / 100;
    const sentido = comprovante.valor < total ? `faltam ${formatarPreco(diferenca)}` : `${formatarPreco(diferenca)} a mais`;
    linhas.push(`⚠️ Valor: ${formatarPreco(comprovante.valor)} — o pedido é ${formatarPreco(total)} (${sentido})`);
  }
  if (soma && soma.quantos > 1 && !soma.semValor) {
    const fecha = Math.abs(soma.soma - total) < 0.01;
    linhas.push(`${fecha ? '✅' : '⚠️'} Somando os ${soma.quantos} comprovantes: ${formatarPreco(soma.soma)}`);
  }

  linhas.push(`👤 Quem pagou: ${comBanco(comprovante.pagador, comprovante.banco_pagador) || 'não consegui ler'}`);

  const recebedor = comBanco(comprovante.recebedor, comprovante.banco_recebedor);
  if (comprovante.recebedor_confere === 1) linhas.push(`✅ Pra quem: ${recebedor || 'conta da loja (pela chave Pix)'}`);
  else if (comprovante.recebedor_confere === 0) linhas.push(`⚠️ Pra quem: ${recebedor} — *NÃO é a conta da loja*`);
  else linhas.push('❔ Pra quem: não consegui ler');

  const data = formatarData(comprovante.data_pagamento, comprovante.hora_pagamento);
  if (!data) linhas.push('❔ Data: não consegui ler');
  else if (comprovante.data_confere === 1) linhas.push(`✅ Data: ${data}`);
  else linhas.push(`⚠️ Data: ${data} — *não é de hoje*`);

  if (comprovante.id_transacao) linhas.push(`🔑 ID: ${comprovante.id_transacao}`);
  return linhas;
}

function tudoConfere(comprovante, soma, total) {
  if (!comprovante?.leu_o_comprovante) return false;
  const valorOk = comprovante.valor_confere === 1 || (soma && soma.quantos > 1 && !soma.semValor && Math.abs(soma.soma - total) < 0.01);
  return valorOk && comprovante.recebedor_confere === 1 && comprovante.data_confere === 1;
}

const TITULOS_DO_AVISO = {
  novo: (n) => `💰 *Pagamento pra aprovar: ${n}*`,
  extra: (n) => `📎 *Mais um comprovante de ${n}*`,
  contestacao: (n) => `🔁 *${n} mandou comprovante de um pedido que tinha sido recusado*`,
  ja_pago: (n) => `📎 *${n} mandou outro comprovante* (o pedido já está aprovado)`,
};

function montarAvisoPagamento(pedido, comprovante, contexto = 'novo') {
  const nome = nomeCurto(pedido);
  const total = totalDoPedido(pedido);
  const soma = somaDosComprovantes(pedido.id);
  const pedeDecisao = contexto !== 'ja_pago';

  const partes = [
    AVISO_DA_LOJA,
    '',
    TITULOS_DO_AVISO[contexto](nome),
    '',
    `👤 Cliente: ${clienteParaDono(pedido.nome_cliente, pedido.numero_cliente)}`,
    `🛒 ${itensParaDono(pedido.itens)}`,
    linhaDoFrete(pedido),
    `💵 Total do pedido: *${formatarPreco(total)}*`,
    '',
    '🧾 *O que eu li no comprovante:*',
    ...linhasDoComprovante(pedido, comprovante, soma),
  ];

  const pagador = comprovante?.pagador;
  const nomeDoWhatsapp = /[a-zA-ZÀ-ÿ]/.test(pedido.nome_cliente || '') ? pedido.nome_cliente : '';
  if (pagador && nomeDoWhatsapp && !nomesParecidos(pagador, nomeDoWhatsapp)) {
    partes.push('', `ℹ️ Quem pagou (${primeiroNome(pagador) || pagador}) não tem o mesmo nome do WhatsApp (${nomeDoWhatsapp.trim()}). Pode ser outra pessoa pagando: o pedido continua sendo de ${nome}.`);
  }

  if (pedeDecisao) {
    partes.push('', tudoConfere(comprovante, soma, total) ? '✅ *Tudo confere com o pedido.* Veja se o Pix caiu na conta:' : '⚠️ *Confira com atenção antes de aprovar.*');
    partes.push('👍 Caiu? Responda *esta mensagem* com *sim* (ou reaja com 👍)', '👎 Não caiu? Responda com *não* (ou reaja com 👎)');
  }
  partes.push(`_pedido ${pedido.id}_`);
  return partes.join('\n');
}

function conteudoComArquivo(comprovante, texto) {
  const caminho = comprovante?.arquivo ? caminhoDoArquivo(comprovante.arquivo) : null;
  if (!caminho) return { text: texto };
  try {
    const buffer = fs.readFileSync(caminho);
    if (comprovante.tipo_arquivo === 'application/pdf') {
      return { document: buffer, mimetype: 'application/pdf', fileName: `comprovante-${comprovante.pedido_id}.pdf`, caption: texto };
    }
    return { image: buffer, caption: texto };
  } catch {
    return { text: texto };
  }
}

async function enviarAvisoPagamentoDono(sock, pedido, comprovante = undefined, contexto = 'novo') {
  const registro = comprovante === undefined ? ultimoComprovanteDoPedido(pedido.id) : comprovante;
  const texto = montarAvisoPagamento(pedido, registro, contexto);
  const tipo = contexto === 'ja_pago' ? null : 'pagamento';
  const enviados = await enviarParaDonos(sock, conteudoComArquivo(registro, texto), { pedidoId: pedido.id, tipo });
  if (enviados && contexto !== 'ja_pago') marcarPedido(pedido.id, 'pagamento_notificado');
  return enviados;
}

function totalDoPedido(pedido) {
  return pedido.itens.reduce((soma, p) => soma + p.preco, 0) + (pedido.frete || 0);
}

function resumoDoPedidoFechado(pedido) {
  const frete = pedido.status === 'aguardando_frete_manual'
    ? '🚚 Frete: *a calcular*'
    : `🚚 Frete: ${pedido.frete > 0 ? formatarPreco(pedido.frete) : '*Grátis*'}`;
  const total = pedido.status === 'aguardando_frete_manual'
    ? `*Subtotal: ${formatarPreco(totalDoPedido(pedido))}*`
    : `*Total: ${formatarPreco(totalDoPedido(pedido))}*`;
  return `🧾 *Seu pedido:*\n${linhasDoPedido(pedido.itens)}\n${frete}\n${total}`;
}

const cancelarPedidoFechadoAtomico = transacao((pedidoId, numero) => {
  const pedido = buscarPedidoPorId(pedidoId);
  if (!pedido || !['aguardando_frete_manual', 'aguardando_pagamento'].includes(pedido.status)) return { ok: false, pedido };
  atualizarStatusPedido(pedidoId, 'cancelado');
  for (const [produtoId, quantidade] of Object.entries(contarPorProduto(pedido.itens))) {
    reporEstoque(Number(produtoId), quantidade, { motivo: 'cancelado_cliente', pedidoId, usuario: USUARIO_BOT });
  }
  resetarEstado(numero);
  return { ok: true, pedido };
});

async function cancelarPedidoFechado(sock, numero, pedido, nomeCliente) {
  const resultado = cancelarPedidoFechadoAtomico(pedido.id, numero);
  if (!resultado.ok) {
    resetarEstado(numero);
    await sock.sendMessage(numero, {
      text: 'Seu pedido já está sendo processado e não dá mais pra cancelar por aqui 🙏 Se precisar, fala com a gente que a equipe resolve.',
    });
    return;
  }
  await sock.sendMessage(numero, {
    text: '❌ Pronto, seu pedido foi cancelado. Se quiser fazer outro, é só mandar uma mensagem 🙂',
  });
  const atualizado = { ...pedido, nome_cliente: nomeCliente || pedido.nome_cliente };
  await avisarDonos(sock,
    `❌ *${nomeCurto(atualizado)} cancelou o pedido*\n\n` +
    `👤 Cliente: ${clienteParaDono(atualizado.nome_cliente, numero)}\n` +
    `🛒 ${itensParaDono(pedido.itens)}\n\n` +
    `O estoque desses itens já voltou.\n_pedido ${pedido.id}_`);
}

async function lembrarDonoDoFrete(sock, pedido) {
  const agora = Date.now();
  const anterior = ultimoLembreteDeFrete.get(pedido.id);
  if (anterior !== undefined && agora - anterior < MINUTOS_ENTRE_LEMBRETES_DE_FRETE * 60 * 1000) return;
  ultimoLembreteDeFrete.set(pedido.id, agora);
  await avisarDonos(sock, textoDoAvisoDeFrete(pedido, `⏰ *${nomeCurto(pedido)} está esperando o valor do frete*`), { pedidoId: pedido.id, tipo: 'frete' });
}

const PEDIU_PIX_DE_NOVO = /\b(de novo|novamente|reenvia|reenviar|reenvie|manda o pix|mande o pix|cade o pix|cade|nao (chegou|recebi|veio|apareceu)|copia e cola|qr ?code|qrcode|codigo do pix|chave)\b/;
const HORAS_PARA_ACEITAR_COMPROVANTE = { aguardando_pagamento: 72, aguardando_confirmacao_dono: 72, pagamento_recusado: 48, pago: 24 };

function horasDesde(dataSql) {
  if (!dataSql) return Infinity;
  return (Date.now() - new Date(`${String(dataSql).replace(' ', 'T')}Z`).getTime()) / (60 * 60 * 1000);
}

function aceitaComprovante(pedido) {
  const limite = HORAS_PARA_ACEITAR_COMPROVANTE[pedido?.status];
  return limite !== undefined && horasDesde(pedido.criado_em) <= limite;
}

function pedidoEsperandoComprovante(numero) {
  const pedido = ultimoPedidoDoCliente(numero);
  return pedido && ['aguardando_pagamento', 'aguardando_confirmacao_dono', 'pagamento_recusado'].includes(pedido.status) && aceitaComprovante(pedido)
    ? pedido
    : null;
}

async function tratarComprovante(sock, numero, arquivo, textoOriginal, nomeCliente = '') {
  const pedido = ultimoPedidoDoCliente(numero);

  if (!pedido) {
    resetarEstado(numero);
    await sock.sendMessage(numero, { text: 'Não encontrei seu pedido. Pode mandar uma mensagem pra começar de novo 🙂' });
    return;
  }

  const emAberto = ['aguardando_frete_manual', 'aguardando_pagamento'].includes(pedido.status);

  if (!arquivo && emAberto && lerCancelamento(textoOriginal)) {
    await cancelarPedidoFechado(sock, numero, pedido, nomeCliente);
    return;
  }

  if (!arquivo && emAberto && ehPedidoDeCarrinho(textoOriginal)) {
    const depois = pedido.status === 'aguardando_frete_manual'
      ? 'Assim que a equipe calcular o frete, te mando o Pix aqui.'
      : 'Depois de pagar o Pix, mande aqui o *print do comprovante* 📸';
    await sock.sendMessage(numero, {
      text: `${resumoDoPedidoFechado(pedido)}\n\n${depois}\nSe quiser cancelar esse pedido, digite *cancelar*.`,
    });
    return;
  }

  if (pedido.status === 'aguardando_frete_manual') {
    await sock.sendMessage(numero, {
      text:
        (arquivo ? '🙏 Ainda não dá pra pagar: a equipe está calculando o frete. ' : '🕐 Seu pedido está esperando a gente calcular o frete. ') +
        'Assim que tiver o valor, te mando o total e o Pix aqui mesmo.\n\nSe quiser cancelar esse pedido, digite *cancelar*.',
    });
    await lembrarDonoDoFrete(sock, pedido);
    return;
  }

  if (arquivo && HORAS_PARA_ACEITAR_COMPROVANTE[pedido.status] !== undefined) {
    await processarComprovante(sock, numero, pedido, arquivo, nomeCliente);
    return;
  }

  if (pedido.status !== 'aguardando_pagamento') {
    resetarEstado(numero);
    await sock.sendMessage(numero, {
      text: 'Seu pedido já está sendo processado 🙂 Se quiser fazer um novo pedido, é só mandar uma mensagem.',
    });
    return;
  }

  if (lerPagamentoFeito(textoOriginal)) {
    await sock.sendMessage(numero, {
      text: '📸 Boa! Agora mande aqui o *print do comprovante* do Pix (ou o PDF). É com ele que a gente confirma o seu pedido ✅',
    });
    return;
  }

  const frase = String(textoOriginal ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!pedido.pix_enviado || PEDIU_PIX_DE_NOVO.test(frase) || /\b(pix|codigo|copia)\b/.test(frase)) {
    await enviarPixComSeguranca(sock, numero, pedido.id, pedido.itens, pedido.frete, nomeCliente || pedido.nome_cliente);
    return;
  }

  const enviadoHaPouco = Date.now() - (pixEnviadoEm.get(pedido.id) || 0) < MINUTOS_PARA_IGNORAR_CONFIRMACAO_REPETIDA * 60 * 1000;
  const soConfirmou = /^(a|s|ss|sim|ok|okay|confirmar|confirmo|confirma|confirmado|confirmada|pode|isso|beleza|blz|fechado|certo|show)[\s!.]*$/.test(frase.trim());
  if (enviadoHaPouco && soConfirmou) return;

  await sock.sendMessage(numero, {
    text:
      `📸 Só falta o *print do comprovante* do Pix de *${formatarPreco(totalDoPedido(pedido))}*.\n` +
      'Precisa do código de novo? Mande *pix*. Pra cancelar, mande *cancelar*.',
  });
}

async function tratarComprovanteForaDoFluxo(sock, numero, arquivo, nomeCliente) {
  const pedido = ultimoPedidoDoCliente(numero);
  if (!pedido) return false;
  if (pedido.status === 'aguardando_frete_manual' && horasDesde(pedido.criado_em) <= 72) {
    await tratarComprovante(sock, numero, arquivo, '', nomeCliente);
    return true;
  }
  if (!aceitaComprovante(pedido)) return false;
  return processarComprovante(sock, numero, pedido, arquivo, nomeCliente, { soSeForComprovante: pedido.status === 'pago' });
}

const AGRADECIMENTO = /\b(obrigad\w*|obg|brigad\w*|valeu|vlw|agradec\w*|tmj|show|top|perfeito|beleza|blz|ok|okay|certo|massa|otimo|fechou|fechado|maravilha|amei|boa|joia)\b/;
const PERGUNTA_DE_ENTREGA = /\b(quando|chega|chegar|chegando|demora|demorar|demorando|entrega|entregar|saiu|sai|vindo|motoboy|motoqueiro|cade|previsao|tempo|falta|onde)\b/;

async function responderDepoisDoPedido(sock, numero, texto, nomeCliente) {
  const pedido = ultimoPedidoDoCliente(numero);
  if (!pedido) return false;
  if (interpretarItens(texto).itens.length || ehPedidoDeCatalogo(texto) || temIntencaoDePedir(texto)) return false;
  const frase = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const soEmoji = !!frase.trim() && !/[a-z0-9]/.test(frase);
  const primeiro = primeiroNome(nomeCliente || pedido.nome_cliente);
  const horas = horasDesde(pedido.criado_em);
  const pedirMais = 'Se quiser pedir mais, é só mandar o número do sabor.';

  if (pedido.status === 'aguardando_confirmacao_dono' && horas <= 12) {
    await sock.sendMessage(numero, {
      text:
        `🕐 ${primeiro ? `${primeiro}, seu` : 'Seu'} pedido está com a equipe pra confirmar o pagamento. Assim que confirmarem, te aviso aqui!\n\n` +
        'Se quiser fazer outro pedido, é só mandar o número do sabor.',
    });
    return true;
  }

  if (pedido.status === 'pago' && horas <= 12) {
    if (PERGUNTA_DE_ENTREGA.test(frase)) {
      await sock.sendMessage(numero, {
        text: `🛵 ${primeiro ? `${primeiro}, seu` : 'Seu'} pedido já está confirmado e sai pra entrega em breve! Se precisar, a equipe te chama aqui.\n\n${pedirMais}`,
      });
      return true;
    }
    if (AGRADECIMENTO.test(frase) || soEmoji) {
      await sock.sendMessage(numero, {
        text: `😊 Nós que agradecemos${primeiro ? `, ${primeiro}` : ''}! Seu pedido já está confirmado e sai pra entrega em breve 🛵\n\n${pedirMais}`,
      });
      return true;
    }
    return false;
  }

  if (pedido.status === 'pagamento_recusado' && horas <= 48) {
    await sock.sendMessage(numero, {
      text:
        `🙏 ${primeiro ? `${primeiro}, se` : 'Se'} você já pagou, mande aqui o *print do comprovante* que a equipe confere de novo.\n\n` +
        'Se quiser fazer um pedido novo, é só mandar o número do sabor.',
    });
    return true;
  }

  return false;
}

function conferenciaParaBanco(conferencia) {
  const paraNumero = (v) => (v === null || v === undefined ? null : (v ? 1 : 0));
  return {
    valor_confere: paraNumero(conferencia.valorConfere),
    recebedor_confere: paraNumero(conferencia.recebedorConfere),
    data_confere: paraNumero(conferencia.dataConfere),
  };
}

async function processarComprovante(sock, numero, pedido, arquivo, nomeCliente, { soSeForComprovante = false } = {}) {
  const total = totalDoPedido(pedido);
  const nome = nomeCliente || pedido.nome_cliente;
  const primeiro = primeiroNome(nome);
  const leitura = await lerComprovante(arquivo, { chavePix: PIX_CHAVE, nomeRecebedor: PIX_NOME_BENEFICIARIO, total });
  const { dados, conferencia, texto } = leitura;
  const legivel = dados.pareceComprovante && dados.leu;

  if (!legivel && soSeForComprovante) return false;

  if (!legivel && pedido.status === 'aguardando_pagamento') {
    const tentativas = (tentativasIlegiveis.get(pedido.id) || 0) + 1;
    tentativasIlegiveis.set(pedido.id, tentativas);
    if (tentativas < 2) {
      await sock.sendMessage(numero, {
        text:
          '🤔 Não consegui ler um comprovante nessa imagem.\n\n' +
          'Mande o *print da tela do comprovante* do Pix (onde aparece o valor e pra quem foi) ou o *PDF* do comprovante, que eu confiro aqui 🙂',
      });
      return true;
    }
  }

  const repetido = legivel
    ? comprovanteRepetido({ idTransacao: dados.idTransacao, pagador: dados.pagador, valor: dados.valor, data: dados.data, hora: dados.hora })
    : null;

  if (repetido && repetido.pedido_id === pedido.id && pedido.status !== 'pagamento_recusado') {
    await sock.sendMessage(numero, {
      text: pedido.status === 'pago'
        ? '✅ Esse comprovante eu já tinha recebido, e seu pedido já está confirmado!'
        : '✅ Esse comprovante eu já recebi! A equipe está conferindo e eu te aviso aqui assim que confirmar 🙏',
    });
    return true;
  }

  const mesmoComprovanteDoPedido = !!repetido && repetido.pedido_id === pedido.id;
  const guardado = mesmoComprovanteDoPedido ? { tipo: arquivo.tipo } : await prepararArquivoParaGuardar(arquivo.buffer, arquivo.tipo);
  let nomeDoArquivo = null;
  if (!mesmoComprovanteDoPedido) {
    try {
      nomeDoArquivo = salvarArquivoComprovante(pedido.id, guardado.buffer, guardado.tipo);
    } catch (erro) {
      console.error('Não consegui salvar o arquivo do comprovante:', erro.message);
    }
  }

  const registro = {
    pedido_id: pedido.id,
    numero_cliente: numero,
    nome_cliente: nome || null,
    arquivo: nomeDoArquivo,
    tipo_arquivo: guardado.tipo,
    valor: dados.valor,
    pagador: dados.pagador,
    banco_pagador: dados.bancoPagador,
    recebedor: dados.recebedor,
    banco_recebedor: dados.bancoRecebedor,
    data_pagamento: dados.data,
    hora_pagamento: dados.hora,
    id_transacao: dados.idTransacao,
    ...conferenciaParaBanco(conferencia),
    duplicado_do_pedido: repetido && repetido.pedido_id !== pedido.id ? repetido.pedido_id : null,
    leu_o_comprovante: legivel ? 1 : 0,
    texto_lido: String(texto || '').slice(0, 4000),
  };

  if (repetido && repetido.pedido_id !== pedido.id) {
    const id = registrarComprovante(registro);
    await sock.sendMessage(numero, {
      text:
        '⚠️ Esse comprovante já foi usado num pedido anterior, então não dá pra usar ele de novo.\n\n' +
        'Se você fez um Pix novo pra este pedido, mande aqui o comprovante *desse* Pix 🙏',
    });
    const anterior = buscarPedidoPorId(repetido.pedido_id);
    await enviarParaDonos(sock, conteudoComArquivo(buscarComprovante(id),
      `${AVISO_DA_LOJA}\n\n⚠️ *${nomeCurto(pedido)} mandou um comprovante repetido*\n\n` +
      `👤 Cliente: ${clienteParaDono(pedido.nome_cliente, pedido.numero_cliente)}\n` +
      `Esse mesmo Pix já tinha sido usado no pedido de ${anterior ? nomeCurto(anterior) : 'outro cliente'} (_pedido ${repetido.pedido_id}_).\n\n` +
      `Não mudei nada: pedi pra mandar o comprovante certo.\n_pedido ${pedido.id}_`));
    return true;
  }

  const statusAntes = pedido.status;
  const comprovanteId = mesmoComprovanteDoPedido ? repetido.id : registrarComprovante(registro);
  tentativasIlegiveis.delete(pedido.id);

  if (statusAntes === 'aguardando_pagamento') {
    transacao(() => {
      atualizarStatusPedido(pedido.id, 'aguardando_confirmacao_dono');
      marcarPedido(pedido.id, 'pagamento_notificado', 0);
      const atual = getEstado(numero);
      if (atual && (atual.etapa === 'aguardando_comprovante' || (atual.etapa === 'aguardando_produto' && !atual.carrinho.length))) resetarEstado(numero);
    })();
  }

  const soma = somaDosComprovantes(pedido.id);
  const faltando = Math.round((total - soma.soma) * 100) / 100;
  let resposta;
  if (statusAntes === 'pago') {
    resposta = '✅ Recebido! Seu pedido já está confirmado 🙂';
  } else if (statusAntes === 'pagamento_recusado') {
    resposta = '📄 Recebi seu comprovante! Vou passar pra equipe conferir de novo e te aviso aqui 🙏';
  } else if (legivel && conferencia.recebedorConfere === false) {
    resposta =
      '⚠️ Pelo que li, esse Pix foi pra *outra conta*, não pra loja.\n\n' +
      'Confere se você usou o Pix que eu te mandei aqui em cima? A equipe também vai conferir e te aviso aqui 🙏';
  } else if (legivel && dados.valor != null && !soma.semValor && faltando > 0.009) {
    resposta =
      `📄 Comprovante recebido! Só um detalhe: pelo que li, ${soma.quantos > 1 ? 'os Pix somam' : 'o Pix foi de'} *${formatarPreco(soma.soma)}* ` +
      `e o pedido deu *${formatarPreco(total)}* (faltam *${formatarPreco(faltando)}*).\n\n` +
      'Se faltou alguma parte, é só mandar o Pix da diferença e o comprovante aqui. A equipe já foi avisada e vai conferir 🙏';
  } else if (statusAntes === 'aguardando_confirmacao_dono') {
    resposta = '📄 Recebi mais esse comprovante! A equipe está conferindo e eu te aviso aqui assim que confirmar 🙏';
  } else {
    resposta = `📄 Comprovante recebido${primeiro ? `, ${primeiro}` : ''}! A equipe vai conferir o pagamento e eu te aviso aqui assim que o seu pedido for confirmado 🙏`;
  }
  await sock.sendMessage(numero, { text: resposta });

  const contexto = statusAntes === 'pago' ? 'ja_pago'
    : statusAntes === 'pagamento_recusado' ? 'contestacao'
      : statusAntes === 'aguardando_confirmacao_dono' ? 'extra' : 'novo';
  const atualizado = buscarPedidoPorId(pedido.id) || pedido;
  await enviarAvisoPagamentoDono(sock, { ...atualizado, nome_cliente: atualizado.nome_cliente || nome }, buscarComprovante(comprovanteId), contexto);
  return true;
}

async function enviarResultadoAoCliente(sock, pedido) {
  const primeiro = primeiroNome(pedido.nome_cliente);
  if (pedido.status === 'pago') {
    await sock.sendMessage(pedido.numero_cliente, {
      text:
        `✅ *${primeiro ? `${primeiro}, pagamento confirmado!` : 'Pagamento confirmado!'}*\n\n` +
        'Seu pedido já vai ser preparado e sai pra entrega em breve 🛵 Obrigado pela compra 🎉',
    });
  } else if (pedido.status === 'pagamento_recusado') {
    await sock.sendMessage(pedido.numero_cliente, {
      text:
        `⚠️ ${primeiro ? `${primeiro}, não` : 'Não'} localizamos o pagamento do seu pedido, por isso ele foi cancelado.\n\n` +
        'Se você já pagou, fique tranquilo: mande o comprovante aqui que a equipe confere de novo. ' +
        'Pra fazer um novo pedido, é só mandar uma mensagem 🙂',
    });
  }
  marcarPedido(pedido.id, 'resultado_notificado');
}

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
      enviarInstrucoesPagamento(sock, p.numero_cliente, p.id, p.itens, p.frete, p.nome_cliente));
  }

  for (const p of buscarPedidosPorStatus('aguardando_frete_manual').filter(p => !p.dono_notificado)) {
    await tentar(`Pedido nº ${p.id}: reenviando aviso de frete manual`, async () => {
      const enviados = await avisarDonos(sock, textoDoAvisoDeFrete(p, `🚚 *Frete pra calcular: ${nomeCurto(p)}*`), { pedidoId: p.id, tipo: 'frete' });
      if (enviados) marcarPedido(p.id, 'dono_notificado');
    });
  }

  for (const p of buscarPedidosPorStatus('aguardando_confirmacao_dono').filter(p => !p.pagamento_notificado)) {
    await tentar(`Pedido nº ${p.id}: reenviando aviso de pagamento pros donos`, () =>
      enviarAvisoPagamentoDono(sock, p));
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

let filaDosDonos = Promise.resolve();

function naFilaDosDonos(tarefa) {
  const atual = filaDosDonos.catch(() => {}).then(tarefa);
  filaDosDonos = atual.catch(() => {});
  return atual;
}

function nomeDoDono(nome) {
  return primeiroNome(nome) || 'Um dos donos';
}

function estaComprandoComoCliente(numero) {
  const estado = getEstado(numero);
  if (!estado) return false;
  return estado.etapa !== 'aguardando_produto' || estado.carrinho.length > 0 || !!estado.pendencia;
}

const PAGAMENTO_PRA_APROVAR = 'aguardando_confirmacao_dono';

function linhaDoPedidoPraLista(pedido) {
  return `• ${nomeCurto(pedido)} — ${formatarPreco(totalDoPedido(pedido))} (_pedido ${pedido.id}_)`;
}

function tokensDoNome(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(p => p.length >= 3);
}

function escolherPeloNome(pedidos, nome) {
  if (!nome) return { lista: pedidos, nomeNaoAchado: null };
  const procurados = tokensDoNome(nome);
  if (!procurados.length) return { lista: pedidos, nomeNaoAchado: null };
  const achados = pedidos.filter(p => {
    const doCliente = tokensDoNome(p.nome_cliente);
    return procurados.some(x => doCliente.some(y => y === x || (x.length >= 5 && y.startsWith(x.slice(0, 5)))));
  });
  return achados.length ? { lista: achados, nomeNaoAchado: null } : { lista: pedidos, nomeNaoAchado: nome };
}

const aprovarPagamentoAtomico = transacao((id, quem) => {
  const pedido = buscarPedidoPorId(id);
  if (!pedido) return { erro: 'nao_existe' };
  if (pedido.status === 'pago') return { erro: 'ja_pago', pedido };
  if (!['aguardando_confirmacao_dono', 'aguardando_pagamento', 'pagamento_recusado'].includes(pedido.status)) return { erro: 'status', pedido };

  if (pedido.status === 'pagamento_recusado') {
    const necessario = contarPorProduto(pedido.itens);
    for (const [pid, qtd] of Object.entries(necessario)) {
      if (consultarEstoque(Number(pid)) < qtd) return { erro: 'sem_estoque', pedido };
    }
    for (const [pid, qtd] of Object.entries(necessario)) {
      baixarEstoque(Number(pid), qtd, { motivo: 'recusa_desfeita', pedidoId: id, usuario: USUARIO_DONO_WHATSAPP });
    }
  }

  atualizarStatusPedido(id, 'pago');
  marcarPedido(id, 'resultado_notificado', 0);
  registrarResolucao(id, quem);
  const estadoCliente = getEstado(pedido.numero_cliente);
  if (estadoCliente?.etapa === 'aguardando_comprovante' && ultimoPedidoDoCliente(pedido.numero_cliente)?.id === id) {
    resetarEstado(pedido.numero_cliente);
  }
  return { ok: true, pedido };
});

const recusarPagamentoAtomico = transacao((id, quem) => {
  const pedido = buscarPedidoPorId(id);
  if (!pedido) return { erro: 'nao_existe' };
  if (pedido.status === 'pagamento_recusado') return { erro: 'ja_recusado', pedido };
  if (!['aguardando_confirmacao_dono', 'aguardando_pagamento'].includes(pedido.status)) return { erro: 'status', pedido };

  atualizarStatusPedido(id, 'pagamento_recusado');
  marcarPedido(id, 'resultado_notificado', 0);
  registrarResolucao(id, quem);
  for (const [pid, qtd] of Object.entries(contarPorProduto(pedido.itens))) {
    reporEstoque(Number(pid), qtd, { motivo: 'pagamento_recusado', pedidoId: id, usuario: USUARIO_DONO_WHATSAPP });
  }
  const estadoCliente = getEstado(pedido.numero_cliente);
  if (estadoCliente?.etapa === 'aguardando_comprovante' && ultimoPedidoDoCliente(pedido.numero_cliente)?.id === id) {
    resetarEstado(pedido.numero_cliente);
  }
  return { ok: true, pedido };
});

function explicarStatus(pedido) {
  const nome = nomeCurto(pedido);
  const por = pedido.resolvido_por ? ` por ${pedido.resolvido_por}` : '';
  switch (pedido.status) {
    case 'pago': return `O pagamento de ${nome} já foi aprovado${por} ✅`;
    case 'pagamento_recusado': return `O pagamento de ${nome} já foi recusado${por}. Se foi engano, mande *confirmar ${pedido.id}*.`;
    case 'cancelado': return `${nome} cancelou esse pedido, então não dá pra aprovar nem recusar.`;
    case 'aguardando_frete_manual': return `O pedido de ${nome} ainda está esperando o frete. Responda o aviso de frete com o valor.`;
    default: return `O pedido de ${nome} não está esperando aprovação agora.`;
  }
}

async function aprovarPagamento(sock, ctx, id) {
  const resultado = aprovarPagamentoAtomico(id, ctx.quem);
  if (resultado.erro === 'nao_existe') return ctx.responder(`Não encontrei o pedido ${id}.`);
  if (resultado.erro === 'sem_estoque') {
    return ctx.responder(`⚠️ Não dá pra aprovar o pedido de ${nomeCurto(resultado.pedido)}: não tem mais estoque suficiente dos itens dele. Use *repor* antes, se for o caso.`);
  }
  if (resultado.erro) return ctx.responder(explicarStatus(resultado.pedido));

  const pedido = resultado.pedido;
  await enviarResultadoAoCliente(sock, { ...pedido, status: 'pago' });
  const telefone = telefoneDe(pedido.numero_cliente);
  await avisarDonos(sock,
    `✅ *${ctx.quem} aprovou o pagamento de ${nomeCurto(pedido)}*\n\n` +
    '🛵 *Pra entregar:*\n' +
    `👤 ${clienteParaDono(pedido.nome_cliente, pedido.numero_cliente)}\n` +
    (telefone ? `💬 https://wa.me/${telefone}\n` : '') +
    `🛒 ${itensParaDono(pedido.itens)}\n` +
    `💵 ${formatarPreco(totalDoPedido(pedido))} · pago ✅\n` +
    `${linhasDeEntrega(pedido.endereco)}\n` +
    `_pedido ${pedido.id}_`,
    { pedidoId: pedido.id, tipo: 'entrega' });
}

async function recusarPagamento(sock, ctx, id) {
  const resultado = recusarPagamentoAtomico(id, ctx.quem);
  if (resultado.erro === 'nao_existe') return ctx.responder(`Não encontrei o pedido ${id}.`);
  if (resultado.erro) return ctx.responder(explicarStatus(resultado.pedido));

  const pedido = resultado.pedido;
  await enviarResultadoAoCliente(sock, { ...pedido, status: 'pagamento_recusado' });
  await avisarDonos(sock,
    `❌ *${ctx.quem} recusou o pagamento de ${nomeCurto(pedido)}*\n\n` +
    `O pedido foi cancelado, o estoque voltou e o cliente foi avisado.\n` +
    `Se foi engano, mande *confirmar ${pedido.id}*.\n_pedido ${pedido.id}_`);
}

async function definirFrete(sock, ctx, id, valor) {
  const pedido = buscarPedidoPorId(id);
  if (!pedido) return ctx.responder(`Não encontrei o pedido ${id}.`);
  if (!Number.isFinite(valor) || valor < 0 || valor > 500) return ctx.responder('Esse valor de frete não parece certo. Mande só o número, ex: *5* ou *7,50*.');
  if (pedido.status !== 'aguardando_frete_manual') {
    return ctx.responder(pedido.frete_confirmado && pedido.status !== 'cancelado'
      ? `O frete de ${nomeCurto(pedido)} já foi definido (${pedido.frete > 0 ? formatarPreco(pedido.frete) : 'grátis'}).`
      : explicarStatus(pedido));
  }

  const valorFinal = Math.round(valor * 100) / 100;
  transacao(() => {
    definirFretePedido(id, valorFinal);
    atualizarStatusPedido(id, 'aguardando_pagamento');
    marcarPedido(id, 'pix_enviado', 0);
  })();

  const enviou = await enviarPixComSeguranca(sock, pedido.numero_cliente, id, pedido.itens, valorFinal, pedido.nome_cliente);
  await avisarDonos(sock,
    `🚚 *${ctx.quem} definiu o frete de ${nomeCurto(pedido)}: ${valorFinal > 0 ? formatarPreco(valorFinal) : 'grátis'}*\n\n` +
    `Total: ${formatarPreco(totalDoPedido({ ...pedido, frete: valorFinal }))}. ` +
    (enviou ? 'Já mandei o Pix pro cliente.' : 'O WhatsApp falhou ao mandar o Pix agora; o cliente recebe assim que mandar qualquer mensagem.') +
    `\n_pedido ${id}_`);
}

async function decidirPagamento(sock, ctx, comando) {
  const acao = comando.tipo === 'aprovar' ? aprovarPagamento : recusarPagamento;
  if (comando.ids?.length) {
    for (const id of comando.ids) await acao(sock, ctx, id);
    return;
  }

  const pendentes = buscarPedidosPorStatus(PAGAMENTO_PRA_APROVAR);
  const { lista, nomeNaoAchado } = escolherPeloNome(pendentes, comando.nome);

  if (!lista.length) {
    await ctx.responder('Nenhum pagamento esperando aprovação agora ✅\n\nPra ver tudo que está em aberto, mande *pedidos*.');
    return;
  }
  if (nomeNaoAchado) {
    await ctx.responder(
      `Não achei pagamento de "${nomeNaoAchado}" esperando aprovação. Esperando agora:\n${lista.map(linhaDoPedidoPraLista).join('\n')}\n\n` +
      `Responda a mensagem do comprovante com *${comando.tipo === 'aprovar' ? 'sim' : 'não'}*, ou mande *${comando.tipo === 'aprovar' ? 'sim' : 'recusar'} ${lista[0].id}*.`);
    return;
  }
  if (lista.length > 1) {
    await ctx.responder(
      `Tem ${lista.length} pagamentos esperando aprovação:\n${lista.map(linhaDoPedidoPraLista).join('\n')}\n\n` +
      `Qual? Responda a mensagem do comprovante com *${comando.tipo === 'aprovar' ? 'sim' : 'não'}*, ou mande *${comando.tipo === 'aprovar' ? 'sim' : 'recusar'} ${lista[0].id}*.`);
    return;
  }

  const [pedido] = lista;
  if (comando.tipo === 'recusar' && !comando.forte) {
    await ctx.responder(`Pra recusar o pagamento de ${nomeCurto(pedido)} (${formatarPreco(totalDoPedido(pedido))}), mande *recusar*. O cliente é avisado e o estoque volta.`);
    return;
  }
  await acao(sock, ctx, pedido.id);
}

async function tratarComandoDeFrete(sock, ctx, comando) {
  if (comando.id) {
    if (comando.valor === undefined) return ctx.responder(`Mande o valor junto, ex: *frete ${comando.id} 5*.`);
    return definirFrete(sock, ctx, comando.id, comando.valor);
  }
  const esperando = buscarPedidosPorStatus('aguardando_frete_manual');
  if (!esperando.length) return ctx.responder('Nenhum pedido esperando frete agora ✅');
  if (comando.valor === undefined) {
    return ctx.responder(`Me diga o valor do frete, ex: *frete 5*. Esperando frete:\n${esperando.map(p => `• ${nomeCurto(p)} (_pedido ${p.id}_)`).join('\n')}`);
  }
  if (esperando.length > 1) {
    return ctx.responder(
      `Tem ${esperando.length} pedidos esperando frete:\n${esperando.map(p => `• ${nomeCurto(p)} (_pedido ${p.id}_)`).join('\n')}\n\n` +
      `Responda o aviso de frete do cliente com o valor, ou mande *frete ${esperando[0].id} ${String(comando.valor).replace('.', ',')}*.`);
  }
  return definirFrete(sock, ctx, esperando[0].id, comando.valor);
}

function textoDosPedidosEmAberto() {
  const grupos = [
    ['💰 *Pagamento pra aprovar:*', buscarPedidosPorStatus('aguardando_confirmacao_dono'), linhaDoPedidoPraLista],
    ['🚚 *Esperando frete:*', buscarPedidosPorStatus('aguardando_frete_manual'), p => `• ${nomeCurto(p)} — ${itensParaDono(p.itens)} (_pedido ${p.id}_)`],
    ['💳 *Esperando o cliente pagar:*', buscarPedidosPorStatus('aguardando_pagamento'), linhaDoPedidoPraLista],
  ].filter(([, lista]) => lista.length);
  if (!grupos.length) return 'Nenhum pedido em aberto agora ✅';
  return `📋 *Pedidos em aberto*\n\n${grupos.map(([titulo, lista, linha]) => `${titulo}\n${lista.map(linha).join('\n')}`).join('\n\n')}`;
}

const AJUDA_DO_DONO =
  '🏪 *Comandos da loja*\n\n' +
  '👍 *Aprovar pagamento:* responda o comprovante com *sim* (ou reaja com 👍). Se só tiver um esperando, pode mandar só *sim* ou *aprova*.\n' +
  '👎 *Recusar:* responda o comprovante com *não* (ou reaja com 👎).\n' +
  '🚚 *Frete:* responda o aviso de frete só com o valor (ex: *5*, *7,50* ou *grátis*).\n' +
  '📋 *pedidos* — o que está em aberto\n' +
  '📦 *estoque* — quanto tem de cada sabor\n' +
  '➕ *repor [ticket] [quantidade]* — ex: repor 61 10\n' +
  '📊 *resumo* — vendas do dia\n' +
  '📈 *previsao* — previsão do estoque\n\n' +
  'Pra testar como cliente, mande *oi*.';

async function responderAoAviso(sock, ctx, aviso, pedido, texto, comando) {
  if (aviso.tipo === 'pagamento') {
    if (comando?.tipo === 'aprovar') { await aprovarPagamento(sock, ctx, pedido.id); return true; }
    if (comando?.tipo === 'recusar') { await recusarPagamento(sock, ctx, pedido.id); return true; }
    await ctx.responder(`Pagamento de ${nomeCurto(pedido)}: responda com *sim* pra aprovar ou *não* pra recusar.`);
    return true;
  }
  if (aviso.tipo === 'frete') {
    const valor = lerValor(texto) ?? (comando?.tipo === 'frete' && comando.valor !== undefined ? comando.valor : null);
    if (valor !== null) { await definirFrete(sock, ctx, pedido.id, valor); return true; }
    await ctx.responder(`Frete de ${nomeCurto(pedido)}: responda com o valor, ex: *5* ou *7,50* (ou *grátis*).`);
    return true;
  }
  return false;
}

async function processarMensagemDono(sock, { dono, numero, texto, citado, nome }) {
  const ctx = {
    quem: nomeDoDono(nome),
    responder: (t) => sock.sendMessage(numero || dono, { text: `🏪 ${t}` }),
  };
  const comando = lerComandoDono(texto);

  const aviso = citado ? avisoDono(citado) : null;
  if (aviso) {
    const pedido = buscarPedidoPorId(aviso.pedido_id);
    if (pedido && await responderAoAviso(sock, ctx, aviso, pedido, texto, comando)) return true;
  }

  if (!comando) return false;
  if (!comando.forte && estaComprandoComoCliente(numero || dono)) return false;

  switch (comando.tipo) {
    case 'aprovar':
    case 'recusar':
      await decidirPagamento(sock, ctx, comando);
      return true;
    case 'frete':
      await tratarComandoDeFrete(sock, ctx, comando);
      return true;
    case 'pedidos':
      await ctx.responder(textoDosPedidosEmAberto());
      return true;
    case 'ajuda':
      await sock.sendMessage(numero || dono, { text: AJUDA_DO_DONO });
      return true;
    case 'estoque':
      await sock.sendMessage(numero || dono, { text: formatarEstoque() });
      return true;
    case 'previsao':
      await sock.sendMessage(numero || dono, { text: formatarPrevisao() });
      return true;
    case 'resumo':
      await sock.sendMessage(numero || dono, { text: formatarResumoDoDia() });
      return true;
    case 'repor': {
      if (comando.invalido) {
        await ctx.responder('Uso: *repor [ticket] [quantidade]*, ex: repor 61 10');
        return true;
      }
      const produto = buscarProdutoPorTicket(comando.ticket);
      if (!produto) {
        await ctx.responder(`Não existe produto com ticket ${comando.ticket} no catálogo.`);
        return true;
      }
      if (!Number.isInteger(comando.quantidade) || comando.quantidade <= 0 || comando.quantidade > 100000) {
        await ctx.responder('Uso: *repor [ticket] [quantidade]*, ex: repor 61 10');
        return true;
      }
      reporEstoque(comando.ticket, comando.quantidade, { motivo: 'reposicao', usuario: USUARIO_DONO_WHATSAPP });
      await ctx.responder(`✅ Estoque atualizado! ${produto.nome} agora tem ${consultarEstoque(comando.ticket)} unidade(s).`);
      return true;
    }
    default:
      return false;
  }
}

async function processarReacaoDono(sock, { dono, numero, mensagemId, emoji, nome }) {
  const sentido = sentidoDoEmoji(emoji);
  if (!sentido) return true;
  const aviso = avisoDono(mensagemId);
  if (!aviso) return true;
  const pedido = buscarPedidoPorId(aviso.pedido_id);
  if (!pedido) return true;
  const ctx = {
    quem: nomeDoDono(nome),
    responder: (t) => sock.sendMessage(numero || dono, { text: `🏪 ${t}` }),
  };
  if (aviso.tipo === 'pagamento') {
    if (sentido === 'aprovar') await aprovarPagamento(sock, ctx, pedido.id);
    else if (sentido === 'recusar') await recusarPagamento(sock, ctx, pedido.id);
    else await ctx.responder(`Pagamento de ${nomeCurto(pedido)}: reaja com 👍 pra aprovar ou 👎 pra recusar.`);
  } else if (aviso.tipo === 'frete') {
    await ctx.responder(`Frete de ${nomeCurto(pedido)}: responda o aviso com o valor, ex: *5* ou *7,50* (ou *grátis*).`);
  }
  return true;
}

export function tratarMensagemDono(sock, { dono, numero = dono, texto = '', citado = null, nome = '' }) {
  return naFilaDosDonos(() => processarMensagemDono(sock, { dono, numero, texto, citado, nome }));
}

export function tratarReacaoDono(sock, { dono, numero = dono, mensagemId, emoji, nome = '' }) {
  return naFilaDosDonos(() => processarReacaoDono(sock, { dono, numero, mensagemId, emoji, nome }));
}

export function tratarComandoDono(sock, texto) {
  const dono = NUMEROS_DONOS[0] ?? process.env.NUMERO_DONO;
  return tratarMensagemDono(sock, { dono, numero: dono, texto });
}
