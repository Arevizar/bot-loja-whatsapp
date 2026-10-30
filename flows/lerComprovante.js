import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MINUTOS_PARA_DESLIGAR_LEITOR = 10;

let leitor = null;
let desligarLeitor = null;

async function obterLeitor() {
  clearTimeout(desligarLeitor);
  if (!leitor) {
    leitor = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/por/package.json')), '4.0.0_best_int');
      return createWorker('por', 1, { langPath, cacheMethod: 'none', gzip: true });
    })().catch((erro) => {
      leitor = null;
      throw erro;
    });
  }
  const pronto = await leitor;
  desligarLeitor = setTimeout(() => {
    const atual = leitor;
    leitor = null;
    atual?.then(w => w.terminate()).catch(() => {});
  }, MINUTOS_PARA_DESLIGAR_LEITOR * 60 * 1000);
  desligarLeitor.unref?.();
  return pronto;
}

async function prepararImagem(buffer, inverter) {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(buffer).metadata();
  let imagem = sharp(buffer).rotate().grayscale();
  if (inverter) imagem = imagem.negate({ alpha: false });
  if ((meta.width || 0) < 1000) imagem = imagem.resize({ width: 1400 });
  return imagem.normalize().png().toBuffer();
}

async function imagemEhEscura(buffer) {
  const { default: sharp } = await import('sharp');
  const { channels } = await sharp(buffer).grayscale().stats();
  return channels[0].mean < 110;
}

async function lerImagem(buffer) {
  const leitorPronto = await obterLeitor();
  const escura = await imagemEhEscura(buffer);
  const primeira = await leitorPronto.recognize(await prepararImagem(buffer, escura));
  let texto = primeira.data.text || '';
  if (!pareceComprovante(texto) || !acharValor(linhasDe(texto))) {
    const segunda = await leitorPronto.recognize(await prepararImagem(buffer, !escura));
    texto = `${texto}\n${segunda.data.text || ''}`;
  }
  return texto;
}

async function lerPdf(buffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join('\n') : String(text || '');
}

export async function extrairTextoDoComprovante(buffer, tipo = 'image/jpeg') {
  if (!buffer?.length) return '';
  try {
    if (tipo === 'application/pdf') return await lerPdf(buffer);
    return await lerImagem(buffer);
  } catch (erro) {
    console.error('Não consegui ler o comprovante:', erro.message);
    return '';
  }
}

const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normal = (t) => semAcento(t).toLowerCase().replace(/\s+/g, ' ').trim();

function linhasDe(texto) {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map(l => l.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function pareceComprovante(texto) {
  return /\b(pix|comprovante|transferencia|transferência|pagamento|recibo|enviado|enviada|valor)\b/i.test(semAcento(texto));
}

function paraNumero(texto) {
  const limpo = texto.replace(/\s/g, '');
  const valor = Number(limpo.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(valor) && valor > 0 && valor < 100000 ? Math.round(valor * 100) / 100 : null;
}

const MOEDA = /\bR\s?[$S5]\s?:?\s*(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2})/i;

function acharValor(linhas) {
  for (let i = 0; i < linhas.length; i++) {
    const n = normal(linhas[i]);
    if (/\bvalor\b/.test(n) && !/\b(tarifa|taxa|juros|multa|saldo)\b/.test(n)) {
      const mesmaLinha = linhas[i].match(MOEDA) || linhas[i].match(/(\d{1,3}(?:\.\d{3})*,\d{2})\b/);
      if (mesmaLinha) return paraNumero(mesmaLinha[1]);
      const proxima = linhas[i + 1]?.match(MOEDA) || linhas[i + 1]?.match(/^(\d{1,3}(?:\.\d{3})*,\d{2})$/);
      if (proxima) return paraNumero(proxima[1]);
    }
  }
  for (const linha of linhas) {
    if (/\b(saldo|tarifa|taxa)\b/i.test(semAcento(linha))) continue;
    const m = linha.match(MOEDA);
    if (m) return paraNumero(m[1]);
  }
  return null;
}

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

function anoProvavel(bruto) {
  const digitos = String(bruto).replace(/[oO]/g, '0');
  const atual = new Date().getFullYear();
  if (/^\d{2}$/.test(digitos)) return 2000 + Number(digitos);
  if (/^\d{4}$/.test(digitos)) return Number(digitos);
  if (/^\d{5}$/.test(digitos)) {
    const opcoes = [];
    for (let i = 0; i < 5; i++) opcoes.push(Number(digitos.slice(0, i) + digitos.slice(i + 1)));
    const validas = opcoes.filter(a => a >= 2020 && a <= 2100).sort((a, b) => Math.abs(a - atual) - Math.abs(b - atual));
    return validas[0] ?? null;
  }
  return null;
}

const HORA = /(?:^|[^\d:])([01]?\d|2[0-3])\s?[:h]\s?([0-5]\d)(?::[0-5]\d)?(?![\d])/;

function acharDataHora(linhas) {
  const texto = linhas.map(normal).join(' \n ');
  const hora = (trecho) => {
    const h = String(trecho ?? '').match(HORA);
    return h ? `${h[1].padStart(2, '0')}:${h[2]}` : null;
  };
  const horaSolta = () => {
    for (const linha of linhas) {
      const n = normal(linha);
      if (/\b(e[0-9o]{8}|id|identificador|autenticacao|transacao|controle|agencia|conta|cpf|cnpj|chave)\b/.test(n) && !/\b(hora|horario)\b/.test(n)) continue;
      const h = hora(n);
      if (h) return h;
    }
    return null;
  };
  const montar = (d, m, a, resto) => {
    const ano = anoProvavel(a);
    const dia = Number(d);
    const mes = Number(m);
    if (!(ano && dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 2020 && ano <= 2100)) return null;
    return { data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, hora: hora(resto) || horaSolta() };
  };
  let m = texto.match(/\b(\d{1,2})\s?[\/.-]\s?(\d{1,2})\s?[\/.-]\s?([0-9o]{4,5}|\d{2})(?![\d])([^\n]{0,30})/);
  if (m) {
    const r = montar(m[1], m[2], m[3], m[4]);
    if (r) return r;
  }
  m = texto.match(/\b(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z.]*\s*(?:de\s+)?([0-9o]{4,5})(?![\d])([^\n]{0,30})/);
  if (m) {
    const r = montar(m[1], MESES[m[2]], m[3], m[4]);
    if (r) return r;
  }
  return { data: null, hora: horaSolta() };
}

const PARECE_DIGITO = { O: '0', o: '0', D: '0', Q: '0', S: '5', s: '5', I: '1', l: '1', i: '1', B: '8', Z: '2', z: '2', G: '6', T: '7' };
const consertarDigitos = (t) => t.replace(/[OoDQSsIliBZzGT]/g, c => PARECE_DIGITO[c]);

function acharIdTransacao(linhas) {
  const compacto = linhas.map(l => l.replace(/\s+/g, '')).join('\n');
  const m = compacto.match(/E[0-9OoDQSsIliBZzGT]{20}[0-9A-Za-z]{6,14}/);
  if (m) {
    const bruto = m[0];
    return `E${consertarDigitos(bruto.slice(1, 21))}${bruto.slice(21)}`.slice(0, 32);
  }
  for (let i = 0; i < linhas.length; i++) {
    const n = normal(linhas[i]);
    if (/^(id|id da transacao|identificador|autenticacao|codigo da transacao|id transacao|id da operacao|numero da transacao|n[ºo°] de controle|codigo de autenticacao)\b/.test(n)
      || /\b(id da transacao|identificador|autenticacao|codigo da transacao|id transacao)\b/.test(n)) {
      const candidatos = [linhas[i].split(/[:]/).slice(1).join(':'), linhas[i + 1] || ''];
      for (const c of candidatos) {
        const token = c.replace(/\s+/g, '').match(/[0-9A-Za-z]{12,}/);
        if (token) return token[0].slice(0, 40);
      }
    }
  }
  return null;
}

const BANCOS = [
  ['Nubank', /\bnu ?pagamentos\b|\bnubank\b|\bnu financeira\b|^nu$/],
  ['Inter', /\bbanco inter\b|\binter s\.?\s?a\b|^inter$|\binter\s*(&|e)\s*co\b/],
  ['Itaú', /\bitau\b/],
  ['Bradesco', /\bbradesco\b/],
  ['Santander', /\bsantander\b/],
  ['Caixa', /\bcaixa economica\b|\bcaixa\b/],
  ['Banco do Brasil', /\bbanco do brasil\b/],
  ['C6 Bank', /\bc6\b|\bc6 bank\b/],
  ['PicPay', /\bpicpay\b/],
  ['Mercado Pago', /\bmercado ?pago\b/],
  ['PagBank', /\bpagbank\b|\bpagseguro\b/],
  ['Neon', /\bneon\b/],
  ['Next', /\bnext\b/],
  ['Banco Original', /\bbanco original\b/],
  ['BTG Pactual', /\bbtg\b/],
  ['Sicoob', /\bsicoob\b/],
  ['Sicredi', /\bsicredi\b/],
  ['Banrisul', /\bbanrisul\b/],
  ['Safra', /\bsafra\b/],
  ['Will Bank', /\bwill ?bank\b/],
  ['99Pay', /\b99 ?pay\b/],
  ['RecargaPay', /\brecargapay\b/],
  ['Ame Digital', /\bame digital\b/],
  ['Agibank', /\bagibank\b|\bagiplan\b/],
  ['Banco Pan', /\bbanco pan\b/],
  ['Digio', /\bdigio\b/],
  ['XP', /\bxp investimentos\b|\bbanco xp\b/],
  ['Cora', /\bcora\b/],
  ['Stone', /\bstone\b/],
  ['InfinitePay', /\binfinitepay\b|\bcloudwalk\b/],
  ['Efí', /\bgerencianet\b|\befi s\.?a\b/],
  ['Unicred', /\bunicred\b/],
  ['Mercantil', /\bmercantil\b/],
  ['BS2', /\bbs2\b/],
];

function bancoDaLinha(linha) {
  const n = normal(linha);
  for (const [nome, regex] of BANCOS) if (regex.test(n)) return nome;
  return null;
}

const MARCA_PAGADOR = /^(?:dados (?:do|de quem) (?:pagador|pagou|enviou)|quem pagou|quem enviou|origem|pagador|de|remetente|conta de origem|enviado por|pago por|debitado de|sua conta|dados da origem)\b/;
const MARCA_RECEBEDOR = /^(?:dados (?:do|de quem) (?:recebedor|recebeu|favorecido|destinatario)|quem recebeu|destino|para|recebedor|favorecido|beneficiario|destinatario|conta de destino|enviado para|pago para|pago a|transferido para|transferencia para|creditado em|recebido por|dados do destino|dados da destinacao)\b/;
const NAO_E_NOME = /\b(instituicao|banco|cpf|cnpj|agencia|conta|chave|pix|tipo|valor|data|hora|id|transacao|pagamentos|ltda|s\.?a|ip|financeira|comprovante|transferencia|enviado|recebido|autenticacao|controle|descricao|mensagem|documento|origem|destino|saldo|tarifa|ted|doc|agendamento|realizado|efetuado|codigo|numero)\b/;

function tirarMarca(linha) {
  const n = semAcento(linha).toLowerCase();
  for (const marca of [MARCA_PAGADOR, MARCA_RECEBEDOR]) {
    const m = n.match(marca);
    if (m) return linha.slice(m[0].length);
  }
  return linha;
}

function limparNome(trecho) {
  return tirarMarca(String(trecho ?? '').trim())
    .split(/\b(?:CPF|CNPJ|Cpf|Cnpj)\b/)[0]
    .replace(/^\s*[:\-–]\s*/, '')
    .replace(/^nome( completo)?\s*[:\-–]?\s*/i, '')
    .replace(/[*•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ehNomeDePessoa(trecho) {
  const t = trecho.trim();
  if (t.length < 5 || t.length > 70) return false;
  if (!/^[A-Za-zÀ-ÿ'´`.\s-]+$/.test(t)) return false;
  const palavras = t.split(/\s+/).filter(p => p.replace(/[.'-]/g, '').length > 0);
  if (palavras.length < 2 || palavras.length > 7) return false;
  if (NAO_E_NOME.test(normal(t))) return false;
  return palavras.filter(p => p.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 2).length >= 2;
}

function formatarNome(nome) {
  if (!nome) return null;
  const pequenas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome.toLowerCase().split(/\s+/)
    .map((p, i) => (i > 0 && pequenas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

function nomeAposMarca(linhas, indice) {
  const mesma = limparNome(linhas[indice]);
  if (ehNomeDePessoa(mesma)) return mesma;
  for (let k = indice + 1; k < Math.min(linhas.length, indice + 5); k++) {
    const n = normal(linhas[k]);
    if (MARCA_PAGADOR.test(n) || MARCA_RECEBEDOR.test(n)) break;
    const candidato = limparNome(linhas[k]);
    if (ehNomeDePessoa(candidato)) return candidato;
  }
  return null;
}

function bancoAposMarca(linhas, indice) {
  for (let k = indice; k < Math.min(linhas.length, indice + 7); k++) {
    if (k > indice) {
      const n = normal(linhas[k]);
      if (MARCA_PAGADOR.test(n) || MARCA_RECEBEDOR.test(n)) break;
    }
    const banco = bancoDaLinha(linhas[k]);
    if (banco) return banco;
  }
  return null;
}

function tokensDoNome(nome) {
  return normal(nome).split(' ').filter(p => p.length >= 3 && !['dos', 'das'].includes(p));
}

function distancia(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return m[a.length][b.length];
}

export function nomesParecidos(nomeA, nomeB) {
  const a = tokensDoNome(nomeA);
  const b = tokensDoNome(nomeB);
  if (!a.length || !b.length) return false;
  const bate = (x) => b.some(y => x === y || (Math.min(x.length, y.length) >= 5 && distancia(x, y) <= 1));
  const iguais = a.filter(bate).length;
  return iguais >= Math.min(2, a.length, b.length);
}

const trocaConfusoes = (t) => normal(t).replace(/[^a-z0-9]/g, '').replace(/[il|]/g, '1').replace(/o/g, '0').replace(/s/g, '5').replace(/z/g, '2').replace(/b/g, '8');

function chaveAparece(texto, chave) {
  const alvo = trocaConfusoes(chave);
  if (alvo.length < 8) return false;
  const corpo = trocaConfusoes(texto);
  if (corpo.includes(alvo)) return true;
  if (alvo.length < 20) return false;
  for (let i = 0; i + alvo.length <= corpo.length + 2; i++) {
    const janela = corpo.slice(i, i + alvo.length);
    if (janela.length >= alvo.length - 2 && distancia(janela, alvo) <= 3) return true;
  }
  return false;
}

export function analisarComprovante(texto, { chavePix = '', nomeRecebedor = '' } = {}) {
  const linhas = linhasDe(texto);
  const resultado = {
    leu: false,
    pareceComprovante: pareceComprovante(texto),
    valor: null,
    pagador: null,
    bancoPagador: null,
    recebedor: null,
    bancoRecebedor: null,
    data: null,
    hora: null,
    idTransacao: null,
    chaveConfere: false,
  };
  if (!linhas.length) return resultado;

  resultado.valor = acharValor(linhas);
  Object.assign(resultado, acharDataHora(linhas));
  resultado.idTransacao = acharIdTransacao(linhas);
  resultado.chaveConfere = !!chavePix && chaveAparece(texto, chavePix);

  for (let i = 0; i < linhas.length; i++) {
    const n = normal(linhas[i]);
    if (!resultado.pagador && MARCA_PAGADOR.test(n)) {
      resultado.pagador = nomeAposMarca(linhas, i);
      resultado.bancoPagador = resultado.bancoPagador || bancoAposMarca(linhas, i);
    } else if (!resultado.recebedor && MARCA_RECEBEDOR.test(n)) {
      resultado.recebedor = nomeAposMarca(linhas, i);
      resultado.bancoRecebedor = resultado.bancoRecebedor || bancoAposMarca(linhas, i);
    }
  }

  const todosOsNomes = linhas.map(limparNome).filter(ehNomeDePessoa);
  if (nomeRecebedor) {
    if (resultado.pagador && nomesParecidos(resultado.pagador, nomeRecebedor) && !resultado.recebedor) {
      resultado.recebedor = resultado.pagador;
      resultado.pagador = null;
    }
    if (!resultado.recebedor) resultado.recebedor = todosOsNomes.find(n => nomesParecidos(n, nomeRecebedor)) || null;
    if (!resultado.pagador) resultado.pagador = todosOsNomes.find(n => !nomesParecidos(n, nomeRecebedor)) || null;
  } else if (!resultado.pagador && todosOsNomes.length) {
    resultado.pagador = todosOsNomes[0];
  }

  if (!resultado.bancoPagador) {
    const cabecalho = linhas.slice(0, 4).map(bancoDaLinha).find(Boolean);
    if (cabecalho && cabecalho !== resultado.bancoRecebedor) resultado.bancoPagador = cabecalho;
    else if (cabecalho && !resultado.bancoRecebedor) resultado.bancoPagador = cabecalho;
  }

  resultado.pagador = formatarNome(resultado.pagador);
  resultado.recebedor = formatarNome(resultado.recebedor);
  resultado.leu = !!(resultado.valor || resultado.pagador || resultado.idTransacao);
  return resultado;
}

export function conferirComprovante(dados, { total, nomeRecebedor = '', hoje = new Date() }) {
  const dataDeHoje = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const ontem = new Date(hoje.getTime() - hoje.getTimezoneOffset() * 60000 - 86400000).toISOString().slice(0, 10);
  return {
    valorConfere: dados.valor == null ? null : Math.abs(dados.valor - total) < 0.01,
    recebedorConfere: dados.chaveConfere || (!!dados.recebedor && !!nomeRecebedor && nomesParecidos(dados.recebedor, nomeRecebedor))
      ? true
      : (dados.recebedor ? false : null),
    dataConfere: dados.data == null ? null : (dados.data === dataDeHoje || dados.data === ontem),
  };
}

export async function prepararArquivoParaGuardar(buffer, tipo) {
  if (!buffer?.length || tipo === 'application/pdf') return { buffer, tipo };
  try {
    const { default: sharp } = await import('sharp');
    const convertido = await sharp(buffer).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    return { buffer: convertido, tipo: 'image/jpeg' };
  } catch {
    return { buffer, tipo };
  }
}

export async function lerComprovante({ buffer, tipo }, { chavePix = '', nomeRecebedor = '', total = 0, hoje = new Date() } = {}) {
  const texto = await extrairTextoDoComprovante(buffer, tipo);
  const dados = analisarComprovante(texto, { chavePix, nomeRecebedor });
  const conferencia = conferirComprovante(dados, { total, nomeRecebedor, hoje });
  return { texto, dados, conferencia };
}
