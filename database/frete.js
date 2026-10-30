import 'dotenv/config';
import https from 'https';

const ENDERECO_ORIGEM = process.env.ENDERECO_ORIGEM ?? '';

const RAIO_GRATIS_KM = 5;
const VALOR_POR_KM_EXCEDENTE = 5.0;
const DISTANCIA_MAXIMA_KM = 40;

let coordenadasOrigemCache = null;

function requisicaoHttps(url) {
  return new Promise((resolve, reject) => {
    const opcoes = {
      headers: {
        'User-Agent': 'BotLojaWhatsApp/1.0 (uso interno para calculo de frete)',
      },
      timeout: 15000,
    };

    const req = https.get(url, opcoes, (res) => {
      let dados = '';
      res.on('data', (chunk) => (dados += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(dados));
        } catch (erro) {
          reject(new Error('Resposta inválida do serviço de mapas'));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao consultar o serviço de mapas'));
    });

    req.on('error', reject);
  });
}

async function geocodificarEndereco(enderecoTexto) {
  const tentativas = gerarVariantesDeEndereco(enderecoTexto);

  for (const tentativa of tentativas) {
    const resultado = await buscarNoMapa(tentativa);
    if (resultado) return resultado;
  }

  return null;
}

function gerarVariantesDeEndereco(enderecoTexto) {
  const variantes = [enderecoTexto];

  const semNumero = enderecoTexto.replace(/,\s*\d+\s*,/, ',');
  if (semNumero !== enderecoTexto) variantes.push(semNumero);

  const partes = enderecoTexto.split(',').map(p => p.trim()).filter(Boolean);
  if (partes.length > 2) {
    const primeiraParte = partes[0].replace(/\d+/g, '').trim();
    variantes.push(`${primeiraParte}, Campinas, SP, Brasil`);
  }

  return [...new Set(variantes)];
}

async function buscarNoMapa(enderecoTexto) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(enderecoTexto)}`;

  try {
    const dados = await requisicaoHttps(url);
    if (!dados || dados.length === 0) return null;
    return {
      latitude: parseFloat(dados[0].lat),
      longitude: parseFloat(dados[0].lon),
    };
  } catch (erro) {
    console.error('Erro ao consultar geolocalização:', erro.message);
    return null;
  }
}

function distanciaEmKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (graus) => (graus * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function obterCoordenadasOrigem() {
  if (coordenadasOrigemCache) return coordenadasOrigemCache;
  coordenadasOrigemCache = await geocodificarEndereco(ENDERECO_ORIGEM);
  return coordenadasOrigemCache;
}

function freteDaDistancia(distanciaKm) {
  if (distanciaKm > DISTANCIA_MAXIMA_KM) {
    return { sucesso: false, motivo: 'distancia_fora_do_normal', distanciaKm };
  }
  if (distanciaKm <= RAIO_GRATIS_KM) {
    return { sucesso: true, distanciaKm, valorFrete: 0, gratis: true };
  }
  const kmExcedente = distanciaKm - RAIO_GRATIS_KM;
  const valorFrete = Math.round(kmExcedente * VALOR_POR_KM_EXCEDENTE * 100) / 100;
  return { sucesso: true, distanciaKm, valorFrete, gratis: false };
}

export async function calcularFrete(enderecoCliente) {
  const origem = await obterCoordenadasOrigem();
  if (!origem) {
    return { sucesso: false, motivo: 'nao_localizou_origem' };
  }

  const destino = await geocodificarEndereco(`${enderecoCliente}, Campinas, SP, Brasil`);
  if (!destino) {
    return { sucesso: false, motivo: 'nao_localizou_endereco_cliente' };
  }

  return freteDaDistancia(distanciaEmKm(origem.latitude, origem.longitude, destino.latitude, destino.longitude));
}

export async function calcularFretePorCoordenadas(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { sucesso: false, motivo: 'localizacao_invalida' };
  }
  const origem = await obterCoordenadasOrigem();
  if (!origem) {
    return { sucesso: false, motivo: 'nao_localizou_origem' };
  }
  return freteDaDistancia(distanciaEmKm(origem.latitude, origem.longitude, latitude, longitude));
}
