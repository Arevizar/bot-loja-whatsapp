const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normal = (t) => semAcento(t).toLowerCase().replace(/\s+/g, ' ').trim();

const APROVAR_FORTE = new Set([
  'aprova', 'aprovar', 'aprovo', 'aprovado', 'aprovada', 'aprove', 'aprovei', 'aprovem', 'aprovamos',
]);
const APROVAR_FRACO = new Set([
  'sim', 's', 'ss', 'sss', 'ok', 'okay', 'okk', 'confirmar', 'confirma', 'confirmo', 'confirmado', 'confirmada', 'confirme',
  'confirmei', 'pode', 'beleza', 'blz', 'certo', 'caiu', 'recebi', 'recebido', 'recebida', 'positivo', 'show', 'fechado',
  'perfeito', 'top', 'bora', 'liberado', 'liberar', 'libera', 'pago', 'paga', 'entrou', 'chegou',
]);
const RECUSAR_FORTE = new Set([
  'recusa', 'recusar', 'recuso', 'recusado', 'recusada', 'recuse', 'recusei', 'recusem', 'rejeita', 'rejeitar', 'rejeitado',
  'rejeitada', 'nega', 'negar', 'negado', 'negada', 'reprova', 'reprovar', 'reprovado', 'reprovada',
]);
const RECUSAR_FRACO = new Set(['nao', 'n', 'nn', 'negativo', 'nope']);
const NEGACAO_DE_PAGAMENTO = /\bnao (caiu|recebi|recebemos|chegou|entrou|veio|apareceu|achei|encontrei|localizei|consta|ta aqui|esta aqui)\b/;
const ENCHIMENTO = new Set([
  'o', 'a', 'os', 'as', 'esse', 'essa', 'este', 'esta', 'isso', 'ai', 'ae', 'ja', 'por', 'favor', 'pfv', 'pf', 'ta', 'tá',
  'foi', 'pedido', 'pedidos', 'pagamento', 'pagamentos', 'pix', 'da', 'do', 'de', 'dela', 'dele', 'pra', 'para', 'pro', 'e',
  'eh', 'mano', 'man', 'cara', 'entao', 'valeu', 'vlw', 'obrigado', 'obg', 'aqui', 'tudo', 'nº', 'no', 'numero', 'num',
  'n°', 'comprovante', 'cliente', 'dinheiro', 'conta', 'na', 'ele', 'ela', 'certinho', 'ok', 'sim', 'pode', 'confere',
  'conferido', 'conferi', 'tbm', 'tambem', 'agora', 'hoje', 'um', 'uma', 'mesmo', 'msm', 'vai', 'manda', 'mandar',
  'rapido', 'logo', 'la', 'porfa', 'porfavor', 'tmj', 'irmao', 'mn', 'bro', 'mlk', 'po', 'opa', 'eae', 'oi', 'ola', 'bom',
  'boa', 'dia', 'tarde', 'noite', 'pago', 'feito', 'certinho', 'ver', 'vi', 'olhei', 'chequei', 'checado', 'nada',
  'ainda', 'nenhum', 'nenhuma',
]);
const EMOJI_APROVAR = new Set(['👍', '✅', '👌', '🆗', '✔', '☑', '💯', '🤝', '👏', '🤙']);
const EMOJI_RECUSAR = new Set(['👎', '❌', '🚫', '✖', '⛔', '🙅']);

export function limparEmoji(emoji) {
  return String(emoji ?? '').replace(/[\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]/gu, '').trim();
}

export function sentidoDoEmoji(emoji) {
  const e = limparEmoji(emoji);
  if (!e) return null;
  if (EMOJI_APROVAR.has(e)) return 'aprovar';
  if (EMOJI_RECUSAR.has(e)) return 'recusar';
  return 'outro';
}

function tokens(texto) {
  return normal(texto).replace(/\bn\s*[º°]/g, ' ').match(/\d+(?:[.,]\d{1,2})?|[a-z]+/g) || [];
}

const RISADA = /^(k{2,}|(?:ha){2,}|(?:he){2,}|rs{1,}|kk)$/;

const ehNumero = (t) => /^\d+(?:[.,]\d{1,2})?$/.test(t);
const paraValor = (t) => Number(String(t).replace(',', '.'));
const GRATIS = new Set(['gratis', 'free', 'zero', 'gratuito', 'gratuita', 'isento']);

export function lerValor(texto) {
  const lista = tokens(texto).filter(t => !['r', 'rs', 'reais', 'real', 'frete', 'o', 'e', 'eh', 'fica', 'vai', 'ser', 'de', 'do', 'valor', 'custa', 'da', 'deu', 'ficou', 'ta'].includes(t));
  if (!lista.length || lista.length > 3) return null;
  if (lista.some(t => GRATIS.has(t))) return 0;
  const numeros = lista.filter(ehNumero);
  if (numeros.length !== 1 || lista.length !== 1) return null;
  const valor = paraValor(numeros[0]);
  return Number.isFinite(valor) && valor >= 0 && valor <= 500 ? Math.round(valor * 100) / 100 : null;
}

const FRASES_PEDIDOS = new Set([
  'pedidos', 'pendentes', 'pendente', 'pedidos abertos', 'pedidos em aberto', 'em aberto', 'pedidos pendentes', 'abertos',
  'pedido pendente', 'pedidos de hoje', 'fila', 'ver pedidos',
]);
const FRASES_AJUDA_FORTE = new Set(['adm', 'admin', 'comandos', 'ajuda adm', 'menu adm', 'ajuda dono', 'modo adm', 'modo admin', 'menu dono', 'comandos adm']);
const FRASES_AJUDA_FRACA = new Set(['ajuda', 'help', 'menu']);

export function lerComandoDono(texto) {
  const bruto = String(texto ?? '').trim();
  if (!bruto) return null;
  const frase = normal(bruto).replace(/[!?.]+$/g, '').trim();
  const lista = tokens(bruto);
  const emojis = (bruto.match(/\p{Extended_Pictographic}/gu) || []).map(limparEmoji);

  if (['estoque', 'ver estoque'].includes(frase)) return { tipo: 'estoque', forte: true };
  if (['previsao', 'ver previsao'].includes(frase)) return { tipo: 'previsao', forte: true };
  if (['resumo', 'ver resumo', 'resumo do dia'].includes(frase)) return { tipo: 'resumo', forte: true };
  if (FRASES_PEDIDOS.has(frase)) return { tipo: 'pedidos', forte: true };
  if (FRASES_AJUDA_FORTE.has(frase)) return { tipo: 'ajuda', forte: true };
  if (FRASES_AJUDA_FRACA.has(frase)) return { tipo: 'ajuda', forte: false };

  if (lista[0] === 'repor') {
    const m = frase.match(/^repor\s+(\d+)\s+(\d+)$/);
    return m ? { tipo: 'repor', ticket: Number(m[1]), quantidade: Number(m[2]), forte: true } : { tipo: 'repor', forte: true, invalido: true };
  }

  if (lista[0] === 'frete') {
    const resto = lista.slice(1).filter(t => !['do', 'da', 'pedido', 'e', 'eh', 'fica', 'r', 'rs', 'reais', 'de', 'pro', 'pra', 'o', 'vai', 'ser', 'no'].includes(t));
    const gratis = resto.some(t => GRATIS.has(t));
    const numeros = resto.filter(ehNumero);
    const outros = resto.filter(t => !ehNumero(t) && !GRATIS.has(t));
    if (outros.length > 2) return null;
    if (numeros.length >= 2) return { tipo: 'frete', id: Number(numeros[0]), valor: paraValor(numeros[1]), forte: true };
    if (numeros.length === 1 && gratis) return { tipo: 'frete', id: Number(numeros[0]), valor: 0, forte: true };
    if (numeros.length === 1) return { tipo: 'frete', valor: paraValor(numeros[0]), forte: true };
    if (gratis) return { tipo: 'frete', valor: 0, forte: true };
    return { tipo: 'frete', forte: true };
  }

  const ids = lista.filter(t => /^\d+$/.test(t)).map(Number);
  const palavras = lista.filter(t => !ehNumero(t));
  const desconhecidas = palavras.filter(p => !APROVAR_FORTE.has(p) && !APROVAR_FRACO.has(p) && !RECUSAR_FORTE.has(p) && !RECUSAR_FRACO.has(p) && !ENCHIMENTO.has(p) && !RISADA.test(p));
  const nome = desconhecidas.join(' ') || null;
  const temEmojiAprovar = emojis.some(e => EMOJI_APROVAR.has(e));
  const temEmojiRecusar = emojis.some(e => EMOJI_RECUSAR.has(e));

  if (NEGACAO_DE_PAGAMENTO.test(frase) || palavras.some(p => RECUSAR_FORTE.has(p))) {
    if (desconhecidas.length > 3) return null;
    return { tipo: 'recusar', ids, forte: true, nome };
  }
  if (palavras.some(p => APROVAR_FORTE.has(p))) {
    if (desconhecidas.length > 3) return null;
    return { tipo: 'aprovar', ids, forte: true, nome };
  }
  if (desconhecidas.length) return null;

  const negou = palavras.some(p => RECUSAR_FRACO.has(p)) || (temEmojiRecusar && !palavras.length);
  const aprovou = palavras.some(p => APROVAR_FRACO.has(p)) || (temEmojiAprovar && !palavras.length);
  if (negou && !aprovou) return { tipo: 'recusar', ids, forte: ids.length > 0, nome: null };
  if (aprovou && !negou) return { tipo: 'aprovar', ids, forte: ids.length > 0, nome: null };
  return null;
}
