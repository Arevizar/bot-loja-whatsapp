import QRCode from 'qrcode';

// Gera o "código Pix" (payload BR Code) seguindo o padrão do Banco Central.
// É o mesmo tipo de texto que aparece no "Pix Copia e Cola".
function crc16(payload) {
  let crc = 0xffff;
  const polinomio = 0x1021;

  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ polinomio) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function campo(id, valor) {
  const tamanho = String(valor.length).padStart(2, '0');
  return `${id}${tamanho}${valor}`;
}

function semAcentos(texto) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function gerarPayloadPix({ chave, nome, cidade, valor, txid = '***' }) {
  const nomeLimpo = semAcentos(nome).substring(0, 25);
  const cidadeLimpa = semAcentos(cidade).substring(0, 15);
  const txidLimpo = txid.replace(/[^a-zA-Z0-9]/g, '').substring(0, 25) || '***';

  const contaComerciante = campo('00', 'br.gov.bcb.pix') + campo('01', chave);

  let payload =
    campo('00', '01') +
    campo('26', contaComerciante) +
    campo('52', '0000') +
    campo('53', '986');

  if (valor) {
    payload += campo('54', Number(valor).toFixed(2));
  }

  payload +=
    campo('58', 'BR') +
    campo('59', nomeLimpo) +
    campo('60', cidadeLimpa) +
    campo('62', campo('05', txidLimpo));

  payload += '6304';
  return payload + crc16(payload);
}

export async function gerarImagemQRCodePix(payloadPix) {
  return QRCode.toBuffer(payloadPix, {
    type: 'png',
    width: 400,
    margin: 2,
  });
}