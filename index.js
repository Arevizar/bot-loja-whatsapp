import 'dotenv/config';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import { tratarMensagem, tratarComandoDono, recuperarPedidosPendentes } from './flows/messageHandler.js';
import { iniciarCronResumo } from './jobs/resumoDiario.js';
import { inicializarEstoque } from './database/estoque.js';

// Garante que todo produto do catálogo tem uma linha de estoque no banco
inicializarEstoque();

// Número do dono da loja (formato: 55DDDNUMERO@s.whatsapp.net)
const NUMERO_DONO = process.env.NUMERO_DONO;

if (!NUMERO_DONO || !NUMERO_DONO.endsWith('@s.whatsapp.net')) {
  console.warn(
    '⚠️  Aviso: NUMERO_DONO não está configurado corretamente no .env (deve terminar com @s.whatsapp.net). ' +
    'Os avisos de pedido, comandos administrativos e resumo diário não vão funcionar até isso ser corrigido.'
  );
}

// Um erro inesperado em qualquer parte do código não derruba o bot inteiro
process.on('unhandledRejection', (erro) => {
  console.error('⚠️ Erro não tratado (o bot continua rodando):', erro);
});
process.on('uncaughtException', (erro) => {
  console.error('⚠️ Exceção não tratada (o bot continua rodando):', erro);
});

// Sempre aponta pra conexão ATUAL com o WhatsApp. Quando o bot reconecta, uma
// conexão nova é criada; o resumo diário usa esta referência, então continua
// funcionando sem precisar ser agendado de novo (e sem duplicar).
let sockAtual = null;
let cronAgendado = false;

const sockParaCron = {
  sendMessage: (...args) => {
    if (!sockAtual) throw new Error('Bot não está conectado no momento');
    return sockAtual.sendMessage(...args);
  },
};

// Verifica se a mensagem veio do dono. O WhatsApp às vezes identifica o
// remetente por um código interno (@lid) em vez do número de telefone;
// nesse caso o número real vem no campo "remoteJidAlt".
function ehMensagemDoDono(msg) {
  if (!NUMERO_DONO) return false;
  return msg.key.remoteJid === NUMERO_DONO || msg.key.remoteJidAlt === NUMERO_DONO;
}

async function iniciarBot() {
  // Guarda a sessão autenticada numa pasta local, pra não precisar escanear QR toda vez
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  });
  sockAtual = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Escaneie este QR code com o WhatsApp do número da loja:\n');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const codigo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const deveReconectar = codigo !== DisconnectReason.loggedOut;

      if (deveReconectar) {
        console.log('Conexão fechada. Reconectando em 3 segundos...');
        // Pequena pausa evita ficar tentando reconectar sem parar se a internet cair
        setTimeout(() => iniciarBot().catch(e => console.error('Erro ao reconectar:', e)), 3000);
      } else {
        console.log(
          '❌ O WhatsApp da loja foi desconectado (deslogado pelo celular). ' +
          'Apague a pasta "auth_info" e rode "node index.js" de novo pra escanear um QR novo.'
        );
      }
    } else if (connection === 'open') {
      console.log('✅ Bot conectado ao WhatsApp!');

      if (NUMERO_DONO && !cronAgendado) {
        iniciarCronResumo(sockParaCron, NUMERO_DONO);
        cronAgendado = true;
      }

      // Toda vez que conecta: retoma qualquer mensagem que ficou pela metade
      // (ex: bot caiu entre salvar o pedido e mandar o Pix)
      recuperarPedidosPendentes(sock).catch(erro =>
        console.error('Erro ao recuperar pedidos pendentes:', erro)
      );
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Só mensagens realmente novas. Ao conectar/reconectar, o WhatsApp reenvia
    // histórico antigo (type "append") — sem este filtro, o bot responderia de
    // novo a conversas antigas, criando pedidos duplicados.
    if (type !== 'notify') return;

    // Processa TODAS as mensagens do lote, em ordem (não só a primeira)
    for (const msg of messages) {
      try {
        await processarUmaMensagem(sock, msg);
      } catch (erro) {
        console.error('Erro ao processar mensagem:', erro);
      }
    }
  });
}

async function processarUmaMensagem(sock, msg) {
  if (!msg.message || msg.key.fromMe) return;

  const numero = msg.key.remoteJid;
  if (!numero) return;
  if (numero.endsWith('@g.us')) return;          // grupos
  if (numero.endsWith('@broadcast')) return;     // status/stories e listas de transmissão
  if (numero.endsWith('@newsletter')) return;    // canais

  const texto =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    '';
  const nomeCliente = msg.pushName || '';

  // Cliente mandou imagem (provável comprovante de pagamento)
  let imagemBuffer = null;
  if (msg.message.imageMessage) {
    try {
      imagemBuffer = await downloadMediaMessage(msg, 'buffer', {});
    } catch (erroDownload) {
      console.error('Erro ao baixar imagem recebida:', erroDownload);
    }
  }

  // Figurinha, áudio, etc. (sem texto e sem imagem): ignora
  if (!texto && !imagemBuffer) return;

  // Mensagem do dono: tenta como comando administrativo primeiro
  if (ehMensagemDoDono(msg)) {
    const eraComando = await tratarComandoDono(sock, texto);
    if (eraComando) return;
  }

  await tratarMensagem(sock, numero, texto, nomeCliente, imagemBuffer);
}

iniciarBot().catch(erro => console.error('Erro ao iniciar o bot:', erro));