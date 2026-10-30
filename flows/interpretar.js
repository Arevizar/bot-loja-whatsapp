import { CATALOGO, normalizar } from '../database/catalogo.js';

const NUMEROS_ESCRITOS = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
};

const SEPARADORES = new Set(['e', 'mais', 'com', 'tambem', 'tb', 'tbm', 'and']);
const LIGACAO_DE = new Set(['de', 'do', 'da', 'dos', 'das']);

const PALAVRAS_DE_APOIO = new Set([
  'quero', 'queria', 'quer', 'querer', 'quiser', 'gostaria', 'vou', 'vai', 'vamos', 'me', 'eu', 'mim', 'pra', 'para',
  'manda', 'mande', 'mandar', 'mando', 'envia', 'envie', 'enviar', 'coloca', 'coloque', 'colocar', 'coloco',
  'poe', 'ponha', 'por', 'bota', 'bote', 'botar', 'adiciona', 'adicione', 'adicionar', 'add', 'inclui', 'inclua',
  'separa', 'separe', 'pega', 'pegar', 'pego', 'leva', 'levar', 'levo', 'compra', 'comprar', 'compro',
  'pode', 'podia', 'poderia', 'ser', 'favor', 'pf', 'pfv', 'pfvr', 'porfa', 'porfavor', 'please', 'pls',
  'obg', 'obrigado', 'obrigada', 'vlw', 'valeu', 'agradeco',
  'o', 'a', 'os', 'as', 'opcao', 'opcoes', 'numero', 'numeros', 'num', 'n', 'no', 'na', 'nos', 'nas',
  'item', 'itens', 'sabor', 'sabores', 'unidade', 'unidades', 'un', 'und', 'unid', 'uni', 'produto', 'produtos',
  'oi', 'ola', 'opa', 'eae', 'eai', 'iae', 'salve', 'hey', 'hello', 'bom', 'boa', 'dia', 'tarde', 'noite',
  'tudo', 'bem', 'beleza', 'blz', 'ai', 'ae', 'aqui', 'la', 'ta', 'to', 'tou', 'estou', 'hoje', 'agora', 'entao',
  'ok', 'okay', 'certo', 'sim', 'isso', 'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'aquele', 'aquela',
  'so', 'apenas', 'somente', 'tipo', 'ne', 'kk', 'kkk', 'kkkk', 'rs', 'haha', 'hahaha', 'q', 'que', 'qual', 'quais',
  'pedido', 'pedir', 'peco', 'fazer', 'faz', 'faca', 'vez', 'vezes', 'cada', 'meu', 'minha', 'mo', 'cara', 'mano',
  'moco', 'moca', 'amigo', 'amiga', 'irmao', 'brother', 'bro', 'fera', 'chefe', 'patrao', 'tio', 'tia',
  'bacana', 'cerveja', 'mandou', 'moco', 'mocinha', 'pod', 'pods', 'verdade', 'real', 'acho', 'melhor', 'alias', 'ops',
  'opss', 'errei', 'engano', 'sabe', 'tipo', 'assim', 'aquilo', 'coisa', 'negocio', 'aqueles', 'aquelas',
]);

const VERBOS_REMOVER = new Set([
  'remover', 'remova', 'remove', 'removo', 'remov', 'rmv', 'retirar', 'retira', 'retire',
  'tirar', 'tira', 'tire', 'tiro', 'excluir', 'exclui', 'exclua', 'apagar', 'apaga', 'apague', 'desfazer', 'desfaz',
  'deletar', 'deleta', 'delete', 'descartar', 'descarta', 'descarte', 'eliminar', 'elimina', 'elimine',
  'esquece', 'esquecer', 'esqueca', 'desconsidera', 'desconsiderar', 'desconsidere', 'retirei',
]);
const PALAVRAS_DE_RETIRADA_NA_LOJA = new Set(['loja', 'local', 'pessoalmente', 'balcao', 'buscar', 'busco', 'retirada']);
const PALAVRAS_DE_TUDO = new Set(['tudo', 'todos', 'todas', 'carrinho', 'geral']);
const PALAVRAS_DE_LIMPAR = new Set(['limpar', 'limpa', 'limpe', 'esvaziar', 'esvazia', 'esvazie', 'zerar', 'zera', 'zere']);
const PALAVRAS_DE_CANCELAR = new Set(['cancelar', 'cancela', 'cancelo', 'cancele', 'desistir', 'desisto', 'desisti']);

const FRASES_DE_FIM = new Set([
  'fim', 'finalizar', 'finaliza', 'finalizo', 'finalize', 'fechar', 'fecha', 'fechou', 'fecho', 'feche',
  'terminei', 'terminar', 'termina', 'terminou', 'termine', 'pronto', 'prontinho', 'acabei', 'acabou',
  'encerrar', 'encerra', 'concluir', 'conclui', 'so isso', 'e so isso', 'e so', 'eh so', 'eh so isso', 'e isso', 'eh isso',
  'so isso mesmo', 'e so isso mesmo', 'so esse', 'so esses', 'so essa', 'so essas', 'mais nada', 'nada mais',
  'nao quero mais nada', 'nao quero nada mais', 'ja escolhi', 'ja era', 'fim fim', 'end', 'finish', 'done',
  'pagar', 'paga', 'pagamento', 'pix', 'fazer pix', 'fazer o pix', 'gerar pix', 'gerar o pix', 'quero pagar', 'vou pagar',
  'como pago', 'como pagar', 'como faco pra pagar', 'como faco para pagar', 'posso pagar', 'pagar agora', 'fechar a conta',
  'fechar conta', 'fecha a conta', 'fecha conta', 'finalizar compra', 'finalizar a compra', 'fechar compra', 'fechar a compra',
  'concluir pedido', 'confirmar', 'confirmar pedido', 'checkout', 'fechar pedido', 'finalizar pedido',
  'chega', 'ja chega', 'chega disso', 'chega por hoje', 'so isso por hoje', 'por hoje e so', 'ta bom assim', 'ta otimo assim',
]);
const PALAVRAS_SOLTAS_NO_FIM = new Set([
  'ok', 'okay', 'entao', 'beleza', 'blz', 'obrigado', 'obrigada', 'obg', 'pfv', 'pf', 'pfvr', 'favor', 'por',
  'valeu', 'vlw', 'ai', 'ae', 'pode', 'o', 'a', 'meu', 'minha', 'pedido', 'compra', 'agora', 'ja', 'pra', 'mim',
  'tudo', 'certo', 'isso', 'show', 'top', 'perfeito', 'eh', 'e', 'mesmo', 'enquanto', 'ta', 'esta', 'quero', 'queria',
  'vou', 'vamos', 'gostaria', 'de', 'gente', 'galera', 'moco', 'moca', 'amigo', 'amiga', 'mano', 'cara',
  'como', 'faco', 'fazer', 'posso', 'eu', 'para', 'gerar', 'gera', 'manda', 'mande',
]);

const PALAVRAS_DE_CATALOGO = /\b(catalogo|catalago|catalgo|cardapio|cardapo|menu|lista|sabores|opcoes)\b/;

const CONFIRMAR = new Set([
  'a', 'letra a', 'opcao a', 'sim', 's', 'ss', 'confirmo', 'confirmar', 'confirma', 'confirmado', 'ok', 'okay',
  'pode', 'isso', 'fechado', 'fechou', 'beleza', 'blz', 'bora', 'certo', 'correto', 'perfeito', 'show', 'claro',
  'yes', 'top', 'pode ser', 'pode confirmar', 'pode mandar', 'sim pode', 'isso mesmo', 'ta certo', 'esta certo',
  'tudo certo', 'sim confirmo', 'sim confirma', 'confirmo sim', 'pode fechar', 'fecha', 'fechar', 'manda', 'manda ai',
  'pagar', 'quero pagar', 'vou pagar', 'pix', 'manda o pix', 'manda pix', 'gera o pix', 'gerar pix', 'gerar o pix',
  'pode gerar o pix', 'finalizar', 'fim', 'fechar pedido', 'confirmar pedido', 'pode finalizar', 'quero confirmar',
  'finalizar pedido', 'fechar o pedido', 'finalizar o pedido',
]);
const COMECO_DE_CONFIRMAR = new Set(['sim', 'confirmo', 'confirmar', 'confirma', 'pode', 'ok', 'fechado', 'fechou', 'beleza', 'bora', 'certo', 'perfeito', 'show', 'claro']);
const NEGAR = new Set(['nao', 'n', 'nn', 'nop', 'nope', 'no', 'errado', 'ta errado', 'esta errado']);
const TRAVA_CONFIRMAR = new Set(['nao', 'mas', 'porem', 'errado', 'trocar', 'troca', 'mudar', 'muda', 'outro', 'outra', 'espera', 'perai', 'pera', 'calma']);

function limparTexto(texto) {
  return normalizar(String(texto ?? '').replace(/\n+/g, ' , '))
    .replace(/(\d)x(?=[a-z])/g, '$1x ')
    .replace(/[^a-z0-9,;/+&| ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function palavrasDe(texto) {
  return limparTexto(texto).replace(/[,;/+&|]/g, ' ').split(' ').filter(Boolean);
}

function distancia(a, b, limite) {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  let antesDoAnterior = null;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + custo);
      if (antesDoAnterior && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        atual[j] = Math.min(atual[j], antesDoAnterior[j - 2] + 1);
      }
      menor = Math.min(menor, atual[j]);
    }
    if (menor > limite) return limite + 1;
    antesDoAnterior = anterior;
    anterior = atual;
  }
  return anterior[b.length];
}

function toleranciaPara(palavra) {
  if (palavra.length >= 8) return 2;
  if (palavra.length >= 4) return 1;
  return 0;
}

let indiceDeNomes = null;
function nomesDosProdutos() {
  if (indiceDeNomes) return indiceDeNomes;
  const frases = [];
  const contagemPalavras = new Map();
  for (const produto of CATALOGO) {
    const nomes = [produto.sabor, ...(produto.apelidos || [])].map(n => normalizar(n).replace(/[^a-z0-9 ]/g, ' ').trim()).filter(Boolean);
    for (const nome of new Set(nomes)) {
      const palavras = nome.split(/\s+/);
      frases.push({ palavras, produto });
      if (palavras.length > 1) {
        for (const p of new Set(palavras)) {
          if (!contagemPalavras.has(p)) contagemPalavras.set(p, new Set());
          contagemPalavras.get(p).add(produto);
        }
      }
    }
  }
  for (const [palavra, produtos] of contagemPalavras) {
    if (palavra.length >= 4 && produtos.size === 1 && !PALAVRAS_DE_APOIO.has(palavra)) {
      frases.push({ palavras: [palavra], produto: [...produtos][0] });
    }
  }
  frases.sort((a, b) => b.palavras.length - a.palavras.length);
  indiceDeNomes = frases;
  return frases;
}

function acharProdutoNaPosicao(tokens, i, aproximado) {
  const frases = nomesDosProdutos();
  let melhor = null;
  for (const frase of frases) {
    const n = frase.palavras.length;
    if (melhor && n < melhor.tamanho) break;
    let custo = 0;
    let serve = true;
    for (let k = 0; k < n; k++) {
      const t = tokens[i + k];
      if (!t || t.tipo !== 'pal') { serve = false; break; }
      const alvo = frase.palavras[k];
      if (t.valor === alvo) continue;
      if (!aproximado) { serve = false; break; }
      const limite = toleranciaPara(alvo);
      const d = limite ? distancia(t.valor, alvo, limite) : 1;
      if (d > limite) { serve = false; break; }
      custo += d;
    }
    if (!serve) continue;
    if (!melhor || custo < melhor.custo) {
      melhor = { produto: frase.produto, palavras: frase.palavras, tamanho: n, custo, empate: false };
    } else if (custo === melhor.custo && n === melhor.tamanho && frase.produto !== melhor.produto) {
      melhor.empate = true;
    }
  }
  if (!melhor || melhor.empate) return null;
  return melhor;
}

function tokenizar(texto) {
  const limpo = limparTexto(texto);
  const tokens = [];
  const re = /(\d+)|([a-z]+)|([,;/+&|]+)/g;
  let m;
  while ((m = re.exec(limpo))) {
    const ini = m.index;
    const fim = ini + m[0].length;
    if (m[1]) tokens.push({ tipo: 'num', valor: Number(m[1]), texto: m[1], ini, fim });
    else if (m[2]) tokens.push({ tipo: 'pal', valor: m[2], ini, fim });
    else tokens.push({ tipo: 'sep', ini, fim });
  }
  return tokens;
}

const ARTIGOS_PLURAIS = new Set(['os', 'as', 'todos', 'todas', 'ambos', 'ambas']);

function ehPlural(tokens, i, achado) {
  const anterior = tokens[i - 1];
  if (anterior?.tipo === 'pal' && ARTIGOS_PLURAIS.has(anterior.valor)) return true;
  return tokens.slice(i, i + achado.tamanho).some((t, k) => t.valor.endsWith('s') && !achado.palavras[k].endsWith('s'));
}

function montarUnidades(tokens) {
  const unidades = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.tipo === 'sep') { unidades.push({ t: 'SEP' }); continue; }
    if (t.tipo === 'num') { unidades.push({ t: 'N', n: t.valor, digito: true, texto: t.texto }); continue; }

    const w = t.valor;
    if (w === 'x') {
      const antes = tokens[i - 1];
      const depois = tokens[i + 1];
      unidades.push({
        t: 'X',
        colado_antes: !!antes && antes.tipo === 'num' && antes.fim === t.ini,
        colado_depois: !!depois && depois.tipo === 'num' && depois.ini === t.fim,
      });
      continue;
    }

    const exato = acharProdutoNaPosicao(tokens, i, false);
    if (exato) {
      unidades.push({ t: 'P', produto: exato.produto, plural: ehPlural(tokens, i, exato) });
      i += exato.tamanho - 1;
      continue;
    }
    if (SEPARADORES.has(w)) { unidades.push({ t: 'SEP' }); continue; }
    if (LIGACAO_DE.has(w)) { unidades.push({ t: 'DE' }); continue; }
    if (w in NUMEROS_ESCRITOS) { unidades.push({ t: 'N', n: NUMEROS_ESCRITOS[w], digito: false, texto: w }); continue; }
    if (PALAVRAS_DE_APOIO.has(w)) continue;

    const aproximado = acharProdutoNaPosicao(tokens, i, true);
    if (aproximado) {
      unidades.push({ t: 'P', produto: aproximado.produto, plural: ehPlural(tokens, i, aproximado) });
      i += aproximado.tamanho - 1;
      continue;
    }
    unidades.push({ t: 'U', w });
  }
  return unidades;
}

function produtoDaOpcao(n) {
  return CATALOGO.find(p => p.opcao === n) || null;
}

function lerTrecho(u, r) {
  const primeiroUtil = u.find(x => x.t === 'P' || x.t === 'N');
  const quantidadeDepois = primeiroUtil?.t === 'P';
  let ultimo = null;

  const adicionar = (produto, qtd, aceitaQuantidade, plural = false) => {
    const item = { produto, qtd, aceitaQuantidade, explicita: !aceitaQuantidade, plural };
    r.itens.push(item);
    return item;
  };
  const definirQuantidade = (item, n) => {
    item.qtd = n;
    item.aceitaQuantidade = false;
    item.explicita = true;
  };
  const opcao = (unidade) => {
    const produto = produtoDaOpcao(unidade.n);
    if (!produto) { r.invalidas.push(unidade.n); return null; }
    return produto;
  };

  for (let i = 0; i < u.length; i++) {
    const a = u[i];

    if (a.t === 'U') { r.desconhecidos.push(a.w); continue; }
    if (a.t === 'DE') continue;

    if (a.t === 'P') {
      r.temNome = true;
      ultimo = adicionar(a.produto, 1, true, a.plural);
      continue;
    }

    if (a.t === 'X') {
      const b = u[i + 1];
      if (b?.t === 'N' && ultimo?.aceitaQuantidade && (a.colado_depois || !a.colado_antes)) {
        definirQuantidade(ultimo, b.n);
        i++;
      }
      continue;
    }

    if (a.t === 'N') {
      const b = u[i + 1];
      const xDeQuantidade = b?.t === 'X' && (b.colado_antes || !b.colado_depois);
      let k = i + 1;
      if (xDeQuantidade) k++;
      const temDe = u[k]?.t === 'DE';
      if (temDe) k++;
      const alvo = u[k];
      const ligado = xDeQuantidade || temDe;

      if (alvo?.t === 'P') {
        const ehQuantidadeDoAnterior = !ligado && quantidadeDepois && ultimo?.aceitaQuantidade;
        if (ehQuantidadeDoAnterior) {
          definirQuantidade(ultimo, a.n);
          continue;
        }
        r.temNome = true;
        ultimo = adicionar(alvo.produto, a.n, false);
        i = k;
        continue;
      }

      if (alvo?.t === 'N' && alvo.digito && (ligado || !a.digito)) {
        const produto = opcao(alvo);
        if (produto) ultimo = adicionar(produto, a.n, false);
        i = k;
        continue;
      }

      if (ultimo?.aceitaQuantidade && (quantidadeDepois || u[i - 1]?.t === 'X')) {
        definirQuantidade(ultimo, a.n);
        continue;
      }

      if (a.digito || a.n >= 2) {
        const produto = opcao(a);
        if (produto) {
          ultimo = adicionar(produto, 1, true);
          ultimo.explicita = false;
        }
      }
    }
  }
}

export function interpretarItens(texto) {
  const r = { itens: [], invalidas: [], desconhecidos: [], temNome: false };
  const unidades = montarUnidades(tokenizar(texto));
  let trecho = [];
  for (const unidade of unidades) {
    if (unidade.t === 'SEP') {
      if (trecho.length) lerTrecho(trecho, r);
      trecho = [];
    } else {
      trecho.push(unidade);
    }
  }
  if (trecho.length) lerTrecho(trecho, r);

  r.itens = r.itens
    .filter(item => item.qtd > 0)
    .map(({ produto, qtd, explicita, plural }) => ({ produto, qtd: Math.min(qtd, 999), explicita: !!explicita, plural: !!plural && !explicita }));
  r.desconhecidos = r.desconhecidos.filter(w => w.length >= 3);
  return r;
}

const SO_EDUCACAO = new Set(['ok', 'okay', 'entao', 'beleza', 'blz', 'obrigado', 'obrigada', 'obg', 'pfv', 'pf', 'pfvr', 'favor', 'por', 'valeu', 'vlw', 'ai', 'ae', 'gente', 'galera', 'show', 'top', 'perfeito']);

export function ehFim(texto) {
  const palavras = palavrasDe(texto);
  if (!palavras.length) return false;
  if (FRASES_DE_FIM.has(palavras.join(' '))) return true;
  const semEducacao = palavras.filter(p => !SO_EDUCACAO.has(p)).join(' ');
  if (semEducacao && FRASES_DE_FIM.has(semEducacao)) return true;
  const semEnfeite = palavras.filter(p => !PALAVRAS_SOLTAS_NO_FIM.has(p)).join(' ');
  return !!semEnfeite && FRASES_DE_FIM.has(semEnfeite);
}

export function ehPedidoDeCatalogo(texto) {
  const frase = palavrasDe(texto).join(' ');
  return PALAVRAS_DE_CATALOGO.test(frase) && interpretarItens(texto).itens.length === 0;
}

export function ehSoConversa(texto) {
  const palavras = palavrasDe(texto);
  return palavras.length > 0 && palavras.every(p => PALAVRAS_DE_APOIO.has(p) || PALAVRAS_SOLTAS_NO_FIM.has(p));
}

export function lerCancelamento(texto) {
  const palavras = palavrasDe(texto).filter(p => !['o', 'a', 'meu', 'minha', 'pedido', 'compra', 'tudo', 'quero', 'pode', 'pfv', 'por', 'favor', 'vou', 'eu', 'ai', 'ae', 'entao'].includes(p));
  return palavras.length === 1 && PALAVRAS_DE_CANCELAR.has(palavras[0]);
}

const VERBOS_ADICIONAR = new Set([
  'adicionar', 'adiciona', 'adicione', 'add', 'coloca', 'coloque', 'colocar', 'coloco', 'poe', 'ponha', 'bota', 'bote',
  'botar', 'acrescenta', 'acrescente', 'acrescentar', 'inclui', 'inclua', 'incluir', 'quero', 'queria', 'manda', 'mande',
  'mandar', 'soma', 'somar', 'some', 'junta', 'juntar', 'pega', 'pegar', 'separa', 'separar', 'leva', 'levar',
]);
const VERBOS_TROCAR = new Set(['troca', 'trocar', 'troque', 'substitui', 'substituir', 'substitua', 'muda', 'mudar', 'mude']);
const VERBOS_DEIXAR = new Set(['deixa', 'deixar', 'deixe', 'mantem', 'manter', 'mantenha', 'conserva', 'conservar']);
const PALAVRAS_POR = new Set(['por', 'pelo', 'pela', 'pelos', 'pelas', 'pra', 'para', 'pro', 'pros', 'pras']);
const PALAVRAS_EXCETO = new Set(['menos', 'exceto', 'excepto', 'tirando', 'fora', 'salvo', 'excluindo']);
const PALAVRAS_SOMENTE = new Set(['so', 'apenas', 'somente', 'unicamente']);
const SO_LIGACAO = new Set(['o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'de', 'meu', 'minha', 'ai', 'ae', 'e', 'unidade', 'unidades', 'pod', 'pods', 'item', 'itens', 'produto', 'produtos', 'sabor', 'sabores']);

const soPalavras = (tokens) => tokens.filter(p => /^[a-z0-9]+$/.test(p));
const temTudo = (tokens) => soPalavras(tokens).some(p => PALAVRAS_DE_TUDO.has(p));

function itensDe(tokens, { todos = false } = {}) {
  const r = interpretarItens(tokens.join(' '));
  if (todos) r.itens = r.itens.map(i => (i.explicita ? i : { ...i, plural: true }));
  return r;
}

function acaoDeAdicionar(tokens) {
  const r = itensDe(tokens);
  if (!r.itens.length && !r.invalidas.length) return null;
  return { tipo: 'adicionar', itens: r.itens, invalidas: r.invalidas, desconhecidos: r.desconhecidos };
}

function trechoParaAcoes(tokens, tipo, acoes) {
  if (tipo === 'adicionar') {
    const acao = acaoDeAdicionar(tokens);
    if (acao) acoes.push(acao);
    return true;
  }

  if (tipo === 'limpar') {
    const k = tokens.findIndex(p => PALAVRAS_EXCETO.has(p));
    const antes = k >= 0 ? tokens.slice(0, k) : tokens;
    const resto = soPalavras(antes).filter(p => !['o', 'a', 'meu', 'minha', 'carrinho', 'tudo', 'pedido', 'e', 'isso'].includes(p));
    if (resto.length) return false;
    const exceto = k >= 0 ? itensDe(tokens.slice(k + 1)).itens : [];
    acoes.push({ tipo: 'remover', tudo: true, exceto });
    return true;
  }

  if (tipo === 'definir') {
    const somente = soPalavras(tokens).some(p => PALAVRAS_SOMENTE.has(p));
    const r = itensDe(tokens);
    if (!r.itens.length) return !somente && !soPalavras(tokens).some(p => !SO_LIGACAO.has(p));
    acoes.push({ tipo: 'definir', itens: r.itens, somente, invalidas: r.invalidas });
    return true;
  }

  let paraTirar = tokens;
  let paraPor = null;
  if (tipo === 'trocar') {
    const k = tokens.findIndex(p => PALAVRAS_POR.has(p));
    if (k >= 0) {
      paraTirar = tokens.slice(0, k);
      paraPor = tokens.slice(k + 1);
    }
  }

  const palavras = soPalavras(paraTirar);
  if (palavras.includes('nada')) return false;

  const kExceto = paraTirar.findIndex(p => PALAVRAS_EXCETO.has(p));
  if (kExceto >= 0) {
    const antes = paraTirar.slice(0, kExceto);
    const exceto = itensDe(paraTirar.slice(kExceto + 1)).itens;
    const itensAntes = itensDe(antes).itens;
    if (!itensAntes.length && exceto.length) {
      acoes.push({ tipo: 'remover', tudo: true, exceto });
      return true;
    }
    paraTirar = antes;
  }

  const util = soPalavras(paraTirar).filter(p => !SO_LIGACAO.has(p));
  if (util.length && util.every(p => PALAVRAS_DE_TUDO.has(p) || p === 'isso')) {
    acoes.push({ tipo: 'remover', tudo: true, exceto: [] });
  } else {
    const r = itensDe(paraTirar, { todos: temTudo(paraTirar) });
    if (r.itens.length || r.invalidas.length) acoes.push({ tipo: 'remover', itens: r.itens, invalidas: r.invalidas });
    else if (tipo === 'cancelar_itens') return false;
    else acoes.push({ tipo: 'remover', ultimo: true });
  }

  if (paraPor) {
    const acao = acaoDeAdicionar(paraPor);
    if (acao) acoes.push(acao);
  }
  return true;
}

export function lerAcoes(texto) {
  if (ehFim(texto)) return null;
  const tokens = limparTexto(texto).match(/[a-z0-9]+|[,;/+&|]/g) || [];
  if (!tokens.length) return null;
  if (tokens.some(p => PALAVRAS_DE_RETIRADA_NA_LOJA.has(p))) return null;

  const trechos = [];
  let atual = { tipo: 'adicionar', tokens: [] };
  let mexeu = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const proximo = tokens[i + 1];
    let tipo = null;
    let pular = 0;
    if (i === 0 && PALAVRAS_DE_LIMPAR.has(t)) tipo = 'limpar';
    else if (VERBOS_REMOVER.has(t)) tipo = 'remover';
    else if (t === 'nao' && proximo === 'quero') { tipo = 'remover'; pular = tokens[i + 2] === 'mais' ? 2 : 1; }
    else if (t === 'nao' && proximo === 'vou' && tokens[i + 2] === 'querer') { tipo = 'remover'; pular = tokens[i + 3] === 'mais' ? 3 : 2; }
    else if (t === 'nao' && proximo === 'precisa') { tipo = 'remover'; pular = tokens[i + 2] === 'mais' ? 2 : 1; }
    else if (VERBOS_TROCAR.has(t)) tipo = 'trocar';
    else if (VERBOS_DEIXAR.has(t)) tipo = 'definir';
    else if (['fica', 'ficar', 'fique', 'fico'].includes(t) && proximo === 'com') { tipo = 'definir'; pular = 1; }
    else if (i === 0 && PALAVRAS_DE_CANCELAR.has(t)) tipo = 'cancelar_itens';
    else if (mexeu && VERBOS_ADICIONAR.has(t)) tipo = 'adicionar';

    if (tipo) {
      trechos.push(atual);
      atual = { tipo, tokens: [] };
      if (tipo !== 'adicionar') mexeu = true;
      i += pular;
      continue;
    }
    atual.tokens.push(t);
  }
  trechos.push(atual);
  if (!mexeu) return null;

  const acoes = [];
  for (const trecho of trechos) {
    if (!trechoParaAcoes(trecho.tokens, trecho.tipo, acoes)) return null;
  }
  const soTiraOUltimo = acoes.every(a => a.tipo === 'remover' && a.ultimo);
  if (soTiraOUltimo && lerPerguntaFrequente(texto) === 'loja') return null;
  return acoes.length ? acoes : null;
}

export function lerRemocao(texto) {
  const acoes = lerAcoes(texto);
  if (!acoes || acoes.length !== 1 || acoes[0].tipo !== 'remover') return null;
  return acoes[0];
}

const RESPOSTA_NENHUM = new Set(['nenhum', 'nenhuma', 'nada', 'nao', 'n', 'deixa', 'deixa assim', 'manter', 'mantem', 'mantenha', 'deixar', 'esquece', 'cancela', 'cancelar']);
const RESPOSTA_TODOS = new Set(['todos', 'todas', 'tudo', 'ambos', 'ambas', 'todos eles', 'todas elas', 'geral', 'eles', 'elas']);
const ENFEITE_RESPOSTA = new Set([
  'tira', 'tirar', 'tire', 'remove', 'remover', 'remova', 'retira', 'retire', 'so', 'apenas', 'somente', 'quero', 'pode',
  'sim', 'pfv', 'por', 'favor', 'deles', 'delas', 'de', 'do', 'da', 'mesmo', 'ai', 'ae', 'ok', 'e', 'pf', 'entao',
]);

export function lerQuantidadeResposta(texto, produtoId, maximo) {
  const palavras = palavrasDe(texto).filter(p => !ENFEITE_RESPOSTA.has(p));
  if (!palavras.length) return null;
  const frase = palavras.join(' ');
  if (RESPOSTA_NENHUM.has(frase)) return 0;
  const semArtigo = palavras.filter(p => !['o', 'a', 'os', 'as'].includes(p)).join(' ');
  if (!semArtigo) return null;
  if (RESPOSTA_TODOS.has(semArtigo)) return maximo;

  const numero = /^\d+$/.test(semArtigo) ? Number(semArtigo) : NUMEROS_ESCRITOS[semArtigo];
  if (numero !== undefined) return numero >= 1 && numero <= maximo ? numero : null;

  const r = interpretarItens(frase);
  if (r.itens.length === 1 && r.itens[0].produto.id === produtoId && !r.invalidas.length) {
    const item = r.itens[0];
    if (item.explicita) return Math.min(item.qtd, maximo);
    if (item.plural) return maximo;
    return 1;
  }
  return null;
}

export function ehMaisUmDoUltimo(texto) {
  const frase = palavrasDe(texto).join(' ');
  return /^(?:(?:quero|manda|mande|coloca|coloque|bota|poe|me manda|adiciona|pode)\s+)*(?:mais\s+(?:um|uma)|outro|outra|repete|repetir|repita)(?:\s+(?:desse|dessa|deste|desta|igual|do mesmo|da mesma|ai|ae|pfv|por favor|pf|ultimo|ultima|tambem))*$/.test(frase);
}

const PALAVRAS_DE_PEDIDO = new Set(['ver', 'mostra', 'mostrar', 'mostre', 'meu', 'minha', 'qual', 'como', 'cade', 'olhar', 'conferir', 'confere', 'confirmar']);
const QUANTO_DEU = new Set(['deu', 'ta', 'esta', 'ficou', 'fica', 'vai', 'sai', 'saiu', 'e', 'eh', 'tudo', 'total']);

export function ehPedidoDeCarrinho(texto) {
  const palavras = palavrasDe(texto);
  if (!palavras.length) return false;
  const frase = palavras.join(' ');
  const semItens = interpretarItens(texto).itens.length === 0;
  if (!semItens) return false;
  if (palavras.includes('carrinho') || palavras.includes('resumo') || palavras.includes('total')) return true;
  if (/\b(o que|oq|que|q) (eu )?(pedi|escolhi|coloquei|tenho)\b/.test(frase)) return true;
  if (palavras.includes('quanto') && palavras.some(p => QUANTO_DEU.has(p))) return true;
  if (palavras.some(p => p === 'pedido' || p === 'compra') && palavras.some(p => PALAVRAS_DE_PEDIDO.has(p))) return true;
  return false;
}

const PALAVRAS_DE_PRECO = new Set(['quanto', 'preco', 'precos', 'valor', 'valores', 'custa', 'custam', 'custo']);
const COMECOS_DE_TEM = [['tem'], ['ainda', 'tem'], ['voces', 'tem'], ['vcs', 'tem'], ['vc', 'tem'], ['voce', 'tem'], ['tem', 'ainda'], ['ta', 'tendo'], ['esta', 'tendo']];
const INTENCAO_DE_PEDIR = new Set(['quero', 'queria', 'manda', 'mande', 'coloca', 'coloque', 'adiciona', 'adicione', 'bota', 'poe', 'separa', 'separe', 'pode']);

export function lerPerguntaSobreProdutos(texto) {
  const palavras = palavrasDe(texto);
  if (!palavras.length || palavras.some(p => INTENCAO_DE_PEDIR.has(p))) return null;
  const ehPreco = palavras.some(p => PALAVRAS_DE_PRECO.has(p));
  const ehTem = COMECOS_DE_TEM.some(c => c.every((p, k) => palavras[k] === p)) || palavras.includes('disponivel');
  if (!ehPreco && !ehTem) return null;
  const r = interpretarItens(texto);
  if (r.itens.length) return { tipo: ehPreco ? 'preco' : 'tem', itens: r.itens };
  if (ehPreco && !palavras.some(p => QUANTO_DEU.has(p))) return { tipo: 'precos', itens: [] };
  return null;
}

export function lerConfirmacao(texto) {
  const palavras = palavrasDe(texto);
  if (!palavras.length) return null;
  const frase = palavras.join(' ');
  if (frase === 'b' || lerCancelamento(texto)) return 'cancelar';
  const semEnfeite = palavras.filter(p => !['obrigado', 'obrigada', 'obg', 'vlw', 'valeu', 'pfv', 'por', 'favor', 'entao', 'ai', 'ae'].includes(p)).join(' ');
  if (CONFIRMAR.has(frase) || CONFIRMAR.has(semEnfeite)) return 'confirmar';
  const travado = palavras.some(p => TRAVA_CONFIRMAR.has(p) || PALAVRAS_DE_CANCELAR.has(p) || VERBOS_REMOVER.has(p));
  if (COMECO_DE_CONFIRMAR.has(palavras[0]) && palavras.length <= 5 && !travado) return 'confirmar';
  if (NEGAR.has(frase) || NEGAR.has(palavras[0])) return 'duvida';
  return null;
}

const PALAVRAS_DE_ENDERECO = new Set(['endereco', 'rua', 'avenida', 'av', 'bairro', 'numero', 'cep', 'casa', 'apto', 'apartamento', 'bloco', 'condominio', 'entrega']);
const PALAVRAS_DE_TROCA = new Set([
  'outra', 'outro', 'errado', 'errada', 'trocar', 'troca', 'troque', 'mudar', 'muda', 'mude', 'corrigir', 'corrige', 'corrija',
  'alterar', 'altera', 'altere', 'novo', 'nova', 'diferente',
]);

export function querTrocarEndereco(texto) {
  const palavras = palavrasDe(texto);
  if (palavras.includes('endereco')) return true;
  return palavras.some(p => PALAVRAS_DE_ENDERECO.has(p)) && palavras.some(p => PALAVRAS_DE_TROCA.has(p));
}

const PALAVRAS_DESCONTO = new Set([
  'desconto', 'descontos', 'promocao', 'promocoes', 'promo', 'promos', 'cupom', 'cupons', 'cupon', 'oferta', 'ofertas',
  'liquidacao', 'abatimento', 'precinho', 'combo', 'combos', 'brinde', 'brindes', 'barato', 'baratinho', 'black', 'cashback',
]);
const PALAVRAS_RANKING = new Set([
  'preferido', 'preferidos', 'preferida', 'preferidas', 'prefere', 'preferem', 'favorito', 'favoritos', 'favorita', 'favoritas',
  'recomenda', 'recomendam', 'recomendacao', 'recomendacoes', 'indica', 'indicam', 'indicacao', 'indicacoes', 'ranking',
  'campeao', 'campeoes', 'popular', 'populares',
]);
const PALAVRAS_PAGAMENTO = new Set([
  'cartao', 'credito', 'debito', 'dinheiro', 'especie', 'boleto', 'parcela', 'parcelar', 'parcelado', 'parcelas',
  'picpay', 'maquininha', 'transferencia', 'ted', 'doc',
]);
const PALAVRAS_HORARIO = new Set(['horario', 'horarios', 'funciona', 'funcionamento', 'aberto', 'aberta', 'abre', 'abrem', 'expediente', 'atendimento']);
const PALAVRAS_LOJA = new Set(['loja', 'retirar', 'retirada', 'retiro', 'buscar', 'busco', 'balcao', 'pessoalmente', 'presencial', 'fisica', 'endereco', 'local', 'localizacao']);
const PALAVRAS_ENTREGA = new Set(['entrega', 'entregam', 'entregar', 'entregas', 'delivery', 'frete', 'motoboy', 'prazo', 'demora', 'chega', 'chegar', 'envio', 'enviam']);

export function lerPerguntaFrequente(texto) {
  const palavras = palavrasDe(texto);
  if (!palavras.length) return null;
  const frase = palavras.join(' ');
  const pergunta = /\?\s*$/.test(String(texto ?? '').trim());

  if (palavras.some(p => PALAVRAS_DESCONTO.has(p)) || /\b(mais barato|faz por menos|baixa o preco|leva \d+ paga \d+|desconta)\b/.test(frase)) return 'desconto';
  if (palavras.some(p => PALAVRAS_RANKING.has(p))
    || /\bmais (vendid|pedid|procurad|famos|gostos|sai\b|saem\b|vende|vendem|pedem|compram|querid)/.test(frase)
    || /\b(sai|saem|vende|vendem|pedem|compram) mais\b/.test(frase)
    || /\b(qual|quais) (e |eh |sao )?(o |os |a |as )?(melhor|melhores)\b/.test(frase)
    || /\btop \d+\b/.test(frase)) return 'ranking';
  if (palavras.some(p => PALAVRAS_PAGAMENTO.has(p)) || /\bforma(s)? de pagamento\b/.test(frase) || /\b(aceita|aceitam)\b/.test(frase)) return 'pagamento';
  if (palavras.some(p => PALAVRAS_HORARIO.has(p)) || /\b(que|q) horas?\b/.test(frase) || /\bate (que|q) horas?\b/.test(frase)) return 'horario';
  if (/\bonde (fica|ficam|voces|vcs|e|eh|esta|estao)\b/.test(frase) || /\b(de onde|aonde) (voces|vcs) (sao|ficam)\b/.test(frase)
    || (palavras.some(p => PALAVRAS_LOJA.has(p)) && (pergunta || /\b(posso|da pra|tem como|consigo|onde|qual)\b/.test(frase)))) return 'loja';
  if (palavras.some(p => PALAVRAS_ENTREGA.has(p)) && (pergunta || /\b(voces|vcs|tem|faz|fazem|quanto|quando|qual|como)\b/.test(frase))) return 'entrega';
  if (pergunta) return 'pergunta';
  return null;
}

export function lerPagamentoFeito(texto) {
  const frase = palavrasDe(texto).join(' ');
  if (!frase) return false;
  if (/\b(paguei|ja paguei|fiz o pix|fiz pix|pix feito|pagamento feito|transferi)\b/.test(frase) && !/\bnao (paguei|fiz|transferi)\b/.test(frase)) return true;
  if (/\?\s*$/.test(String(texto ?? '').trim())) return false;
  if (/\b(como|onde|posso|qual|quanto|quero|vou|preciso|devo|cade|nao)\b/.test(frase)) return false;
  return /\b(paguei|pago|ja paguei|pagamento feito|pix feito|fiz o pix|fiz pix|fiz o pagamento|transferi|ta pago|esta pago|pronto paguei|enviei|mandei o pix|mandei o comprovante|segue o comprovante|comprovante)\b/.test(frase);
}

export function temIntencaoDePedir(texto) {
  return palavrasDe(texto).some(p => INTENCAO_DE_PEDIR.has(p)) && interpretarItens(texto).itens.length > 0;
}
