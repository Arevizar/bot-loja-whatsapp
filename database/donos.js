import 'dotenv/config';

function paraJid(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  if (texto.includes('@')) return texto;
  const digitos = texto.replace(/\D/g, '');
  return digitos ? `${digitos}@s.whatsapp.net` : null;
}

function variantes(jid) {
  if (!jid) return [];
  const [usuario, dominio] = jid.split('@');
  if (dominio !== 's.whatsapp.net') return [jid];
  const lista = [jid];
  if (/^55\d{11}$/.test(usuario) && usuario[4] === '9') lista.push(`${usuario.slice(0, 4)}${usuario.slice(5)}@${dominio}`);
  if (/^55\d{10}$/.test(usuario)) lista.push(`${usuario.slice(0, 4)}9${usuario.slice(4)}@${dominio}`);
  return lista;
}

const configurados = [
  process.env.NUMERO_DONO,
  process.env.NUMERO_DONO_2,
  ...String(process.env.NUMEROS_DONOS ?? '').split(','),
].map(paraJid).filter(Boolean);

export const NUMEROS_DONOS = [...new Set(configurados)];

export function qualDono(...ids) {
  for (const id of ids) {
    if (!id) continue;
    const opcoes = variantes(id);
    const achado = NUMEROS_DONOS.find(dono => variantes(dono).some(v => opcoes.includes(v)));
    if (achado) return achado;
  }
  return null;
}

export function ehDono(...ids) {
  return qualDono(...ids) !== null;
}

export async function confirmarNumerosDosDonos(sock) {
  for (let i = 0; i < NUMEROS_DONOS.length; i++) {
    const jid = NUMEROS_DONOS[i];
    try {
      const [resultado] = await sock.onWhatsApp(jid.split('@')[0]);
      if (resultado?.exists && resultado.jid && resultado.jid !== jid) NUMEROS_DONOS[i] = resultado.jid;
      if (!resultado?.exists) console.warn(`⚠️  O número de dono ${jid.split('@')[0]} não foi encontrado no WhatsApp. Confira no .env.`);
    } catch (erro) {
      console.warn('Não deu pra conferir o número de um dono no WhatsApp:', erro.message);
    }
  }
}
