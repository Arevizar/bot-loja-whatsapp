import 'dotenv/config';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, downloadMediaMessage, normalizeMessageContent,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import {
  tratarMensagem, tratarMensagemDono, tratarReacaoDono, recuperarPedidosPendentes,
} from './flows/messageHandler.js';
import { iniciarCronResumo } from './jobs/resumoDiario.js';
import { inicializarEstoque } from './database/estoque.js';
import { NUMEROS_DONOS, qualDono, confirmarNumerosDosDonos } from './database/donos.js';

inicializarEstoque();

if (!NUMEROS_DONOS.length) {
  console.warn(
    '⚠️  Aviso: nenhum dono configurado no .env (NUMERO_DONO e NUMERO_DONO_2). ' +
    'Os avisos de pedido, o modo adm e o resumo diário não vão funcionar até isso ser corrigido.'
  );
} else {
  console.log(`👑 Donos configurados: ${NUMEROS_DONOS.length}`);
  if (NUMEROS_DONOS.length < 2) console.warn('⚠️  Só 1 dono no .env. Pra o Capiva também ser adm, coloque NUMERO_DONO_2 no .env.');
}

process.on('unhandledRejection', (erro) => {
  console.error('⚠️ Erro não tratado (o bot continua rodando):', erro);
});
process.on('uncaughtException', (erro) => {
  console.error('⚠️ Exceção não tratada (o bot continua rodando):', erro);
});

let sockAtual = null;
let cronAgendado = false;
const sockParaCron = {
  sendMessage: async (_destino, conteudo) => {
    if (!sockAtual) throw new Error('Bot não está conectado no momento');
    for (const dono of NUMEROS_DONOS) {
      try {
        await sockAtual.sendMessage(dono, conteudo);
      } catch (erro) {
        console.error('Não consegui mandar o resumo pra um dos donos:', erro.message);
      }
    }
  },
};

function donoDaMensagem(msg) {
  return qualDono(msg.key.remoteJid, msg.key.remoteJidAlt, msg.key.participant, msg.key.participantAlt);
}

function numeroDoChat(key) {
  const principal = key.remoteJid;
  if (principal?.endsWith('@lid') && key.remoteJidAlt?.endsWith('@s.whatsapp.net')) return key.remoteJidAlt;
  return principal;
}

async function iniciarBot() {
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
        setTimeout(() => iniciarBot().catch(e => console.error('Erro ao reconectar:', e)), 3000);
      } else {
        console.log(
          '❌ O WhatsApp da loja foi desconectado (deslogado pelo celular). ' +
          'Apague a pasta "auth_info" e rode "node index.js" de novo pra escanear um QR novo.'
        );
      }
    } else if (connection === 'open') {
      console.log('✅ Bot conectado ao WhatsApp!');
      if (NUMEROS_DONOS.length && !cronAgendado) {
        iniciarCronResumo(sockParaCron, NUMEROS_DONOS[0]);
        cronAgendado = true;
      }
      confirmarNumerosDosDonos(sock)
        .catch(erro => console.error('Erro ao conferir os números dos donos:', erro))
        .finally(() => recuperarPedidosPendentes(sock).catch(erro =>
          console.error('Erro ao recuperar pedidos pendentes:', erro)
        ));
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await processarUmaMensagem(sock, msg);
      } catch (erro) {
        console.error('Erro ao processar mensagem:', erro);
      }
    }
  });
}

function lerLocalizacao(conteudo) {
  const fixa = conteudo?.locationMessage;
  const aoVivo = conteudo?.liveLocationMessage;
  const local = fixa || aoVivo;
  if (!local || local.degreesLatitude == null || local.degreesLongitude == null) return null;
  const latitude = Number(local.degreesLatitude);
  const longitude = Number(local.degreesLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    aoVivo: !!aoVivo || !!fixa?.isLive,
    nome: fixa?.name || '',
    endereco: fixa?.address || '',
  };
}

const TAMANHO_MAXIMO_DO_ARQUIVO = 15 * 1024 * 1024;

function idCitado(conteudo) {
  for (const valor of Object.values(conteudo || {})) {
    const id = valor?.contextInfo?.stanzaId;
    if (id) return id;
  }
  return null;
}

function arquivoDaMensagem(conteudo) {
  if (conteudo.imageMessage) return { tipo: conteudo.imageMessage.mimetype || 'image/jpeg', tamanho: Number(conteudo.imageMessage.fileLength || 0) };
  const documento = conteudo.documentMessage;
  if (documento) {
    const tipo = String(documento.mimetype || '').toLowerCase();
    const nome = String(documento.fileName || '').toLowerCase();
    const tipoFinal = tipo.startsWith('image/') || tipo === 'application/pdf' ? tipo
      : nome.endsWith('.pdf') ? 'application/pdf'
        : /\.(jpe?g|png|webp)$/.test(nome) ? `image/${nome.split('.').pop().replace('jpg', 'jpeg')}` : null;
    if (tipoFinal) return { tipo: tipoFinal, tamanho: Number(documento.fileLength || 0) };
  }
  return null;
}

async function processarUmaMensagem(sock, msg) {
  if (!msg.message || msg.key.fromMe) return;

  const chat = msg.key.remoteJid;
  if (!chat) return;
  if (chat.endsWith('@g.us')) return;
  if (chat.endsWith('@broadcast')) return;
  if (chat.endsWith('@newsletter')) return;

  const numero = numeroDoChat(msg.key);
  const conteudo = normalizeMessageContent(msg.message) || msg.message;
  const dono = donoDaMensagem(msg);
  const nome = msg.pushName || '';

  if (conteudo.reactionMessage) {
    if (dono) {
      await tratarReacaoDono(sock, {
        dono, numero, nome, mensagemId: conteudo.reactionMessage.key?.id, emoji: conteudo.reactionMessage.text,
      });
    }
    return;
  }

  const texto =
    conteudo.conversation ||
    conteudo.extendedTextMessage?.text ||
    conteudo.imageMessage?.caption ||
    conteudo.documentMessage?.caption ||
    '';
  const localizacao = lerLocalizacao(conteudo);

  let arquivo = null;
  const infoArquivo = arquivoDaMensagem(conteudo);
  if (infoArquivo && infoArquivo.tamanho <= TAMANHO_MAXIMO_DO_ARQUIVO) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      if (buffer?.length) arquivo = { buffer, tipo: infoArquivo.tipo };
    } catch (erroDownload) {
      console.error('Erro ao baixar arquivo recebido:', erroDownload);
    }
  }

  if (!texto && !arquivo && !localizacao) return;

  if (dono && texto) {
    const eraDoDono = await tratarMensagemDono(sock, { dono, numero, texto, citado: idCitado(conteudo), nome });
    if (eraDoDono) return;
  }

  await tratarMensagem(sock, numero, texto, nome, arquivo, localizacao);
}

iniciarBot().catch(erro => console.error('Erro ao iniciar o bot:', erro));
