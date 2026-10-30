import { Router } from 'express';
import db from '../../database/db.js';
import { CATALOGO, buscarProdutoPorTicket } from '../../database/catalogo.js';
import {
  consultarEstoque, listarMovimentacoes, conferirHistorico,
  darBaixaManual, registrarEntrada, ajustarEstoque,
  USUARIO_BOT, USUARIO_DONO_WHATSAPP, USUARIO_SISTEMA,
} from '../../database/estoque.js';
import { listarUsuarios } from '../../database/usuarios.js';
import { vendasDoPeriodo, pedidosEmAberto } from '../../database/vendas.js';
import { exigirCodigoCsrf } from '../seguranca.js';
import { buscarComprovante, caminhoDoArquivo } from '../../database/comprovantes.js';

const rotas = Router();

const LIMITE_ACABANDO = 3;

const hojeLocal = () => db.prepare(`SELECT date('now', 'localtime') AS d`).get().d;

function dataValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(`${texto}T12:00:00Z`);
  return !isNaN(d) && d.toISOString().slice(0, 10) === texto;
}

function inteiro(valor) {
  const n = typeof valor === 'number' ? valor : (typeof valor === 'string' && /^\d+$/.test(valor.trim()) ? Number(valor) : NaN);
  return Number.isSafeInteger(n) ? n : null;
}

const NOMES_ESPECIAIS = {
  [USUARIO_BOT]: 'Bot',
  [USUARIO_DONO_WHATSAPP]: 'Dono, pelo WhatsApp',
  [USUARIO_SISTEMA]: 'Sistema',
};

function nomesDeQuemFez() {
  const nomes = { ...NOMES_ESPECIAIS };
  for (const u of listarUsuarios()) nomes[u.login] = u.nome;
  return nomes;
}

function situacaoEstoque(quantidade) {
  if (quantidade <= 0) return 'esgotado';
  if (quantidade <= LIMITE_ACABANDO) return 'acabando';
  return 'ok';
}

function produtoParaTela(produto) {
  const quantidade = consultarEstoque(produto.id);
  return {
    ticket: produto.id,
    sabor: produto.sabor,
    opcao: produto.opcao,
    preco: produto.preco,
    quantidade,
    situacao: situacaoEstoque(quantidade),
  };
}

function movimentoParaTela(m, nomes) {
  return {
    id: m.id,
    quando: m.criado_em_local,
    ticket: m.produto_id,
    sabor: buscarProdutoPorTicket(m.produto_id)?.sabor ?? m.produto,
    tipo: m.tipo,
    quantidade: m.quantidade,
    motivo: m.motivo,
    motivoTexto: m.motivoTexto,
    pedido: m.pedido_id,
    quem: nomes[m.usuario] ?? m.usuario,
    observacao: m.observacao,
    saldo: m.saldo_apos,
  };
}

rotas.get('/resumo', (req, res) => {
  const hoje = hojeLocal();
  const inicioDoMes = `${hoje.slice(0, 8)}01`;
  const nomes = nomesDeQuemFez();
  const estoque = CATALOGO.map(produtoParaTela);

  res.json({
    hoje,
    vendasHoje: vendasDoPeriodo({ de: hoje, ate: hoje }).totais,
    vendasMes: vendasDoPeriodo({ de: inicioDoMes, ate: hoje }).totais,
    pedidosEmAberto: pedidosEmAberto(),
    esgotados: estoque.filter(p => p.situacao === 'esgotado'),
    acabando: estoque.filter(p => p.situacao === 'acabando'),
    unidadesEmEstoque: estoque.reduce((s, p) => s + Math.max(p.quantidade, 0), 0),
    ultimosMovimentos: listarMovimentacoes({ limite: 8 }).map(m => movimentoParaTela(m, nomes)),
    historicoConfere: conferirHistorico().length === 0,
  });
});

rotas.get('/estoque', (req, res) => {
  res.json({ produtos: CATALOGO.map(produtoParaTela), limiteAcabando: LIMITE_ACABANDO });
});

rotas.get('/movimentos', (req, res) => {
  const { produto, tipo, de, ate } = req.query;
  const limitePedido = inteiro(req.query.limite);
  const filtros = { limite: limitePedido ? Math.min(Math.max(limitePedido, 1), 1000) : 1000 };

  if (produto) {
    const ticket = inteiro(produto);
    if (ticket === null) return res.status(400).json({ mensagem: 'Produto inválido.' });
    filtros.produtoId = ticket;
  }
  if (tipo) {
    if (!['entrada', 'saida'].includes(tipo)) return res.status(400).json({ mensagem: 'Tipo inválido.' });
    filtros.tipo = tipo;
  }
  if (de) { if (!dataValida(de)) return res.status(400).json({ mensagem: 'Data inicial inválida.' }); filtros.de = de; }
  if (ate) { if (!dataValida(ate)) return res.status(400).json({ mensagem: 'Data final inválida.' }); filtros.ate = ate; }

  const nomes = nomesDeQuemFez();
  const movimentos = listarMovimentacoes(filtros).map(m => movimentoParaTela(m, nomes));
  res.json({
    movimentos,
    truncado: movimentos.length === filtros.limite,
    entradas: movimentos.filter(m => m.tipo === 'entrada').reduce((s, m) => s + m.quantidade, 0),
    saidas: movimentos.filter(m => m.tipo === 'saida').reduce((s, m) => s + m.quantidade, 0),
  });
});

const ERROS_MOVIMENTO = {
  produto_inexistente: 'Esse produto não existe no catálogo.',
  quantidade_invalida: 'Quantidade inválida.',
  estoque_insuficiente: 'Não tem estoque suficiente pra essa baixa.',
  usuario_obrigatorio: 'Sessão inválida. Entre de novo.',
};

rotas.post('/movimentos', exigirCodigoCsrf, (req, res) => {
  const { acao } = req.body ?? {};
  const produtoId = inteiro(req.body?.produto);
  const quantidade = inteiro(req.body?.quantidade);
  const observacao = typeof req.body?.observacao === 'string' ? req.body.observacao.trim() : '';
  const usuario = req.sessao.usuario.login;

  if (!['baixa', 'entrada', 'ajuste'].includes(acao)) return res.status(400).json({ mensagem: 'Escolha o que fazer: dar baixa, registrar entrada ou corrigir contagem.' });
  if (produtoId === null || !buscarProdutoPorTicket(produtoId)) return res.status(400).json({ mensagem: ERROS_MOVIMENTO.produto_inexistente });
  if (quantidade === null || quantidade > 100000 || (acao !== 'ajuste' && quantidade < 1)) {
    return res.status(400).json({ mensagem: acao === 'ajuste' ? 'Digite quantas unidades vocês contaram (0 ou mais).' : 'Digite uma quantidade de 1 ou mais.' });
  }
  if (observacao.length > 200) return res.status(400).json({ mensagem: 'O motivo pode ter no máximo 200 caracteres.' });
  if (acao !== 'entrada' && observacao.length < 3) {
    return res.status(400).json({ mensagem: acao === 'baixa' ? 'Escreva o motivo da baixa (ex: venda no balcão, produto avariado).' : 'Escreva o motivo da correção (ex: contagem do fim do mês).' });
  }

  const dados = { produtoId, usuario, observacao: observacao || null };
  const resultado =
    acao === 'baixa' ? darBaixaManual({ ...dados, quantidade }) :
    acao === 'entrada' ? registrarEntrada({ ...dados, quantidade }) :
    ajustarEstoque({ ...dados, novaQuantidade: quantidade });

  if (!resultado.ok) {
    const mensagem = resultado.erro === 'estoque_insuficiente'
      ? `Só tem ${resultado.disponivel} em estoque. Não dá pra dar baixa de ${quantidade}.`
      : ERROS_MOVIMENTO[resultado.erro] ?? 'Não foi possível registrar.';
    return res.status(409).json({ erro: resultado.erro, mensagem });
  }

  console.log(`[painel] ${usuario}: ${acao} #${produtoId} ${quantidade} → saldo ${resultado.saldo}`);
  res.json({ ok: true, saldo: resultado.saldo, semMudanca: !!resultado.semMudanca, produto: produtoParaTela(buscarProdutoPorTicket(produtoId)) });
});

rotas.get('/vendas', (req, res) => {
  const hoje = hojeLocal();
  const de = req.query.de || `${hoje.slice(0, 8)}01`;
  const ate = req.query.ate || hoje;
  if (!dataValida(de) || !dataValida(ate)) return res.status(400).json({ mensagem: 'Data inválida.' });
  if (de > ate) return res.status(400).json({ mensagem: 'A data inicial é depois da final.' });
  res.json(vendasDoPeriodo({ de, ate }));
});

rotas.get('/comprovantes/:id/arquivo', (req, res) => {
  const id = inteiro(req.params.id);
  const comprovante = id === null ? null : buscarComprovante(id);
  const caminho = comprovante?.arquivo ? caminhoDoArquivo(comprovante.arquivo) : null;
  if (!caminho) return res.status(404).json({ mensagem: 'Comprovante não encontrado.' });
  const pdf = comprovante.tipo_arquivo === 'application/pdf';
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.set('Content-Disposition', `${pdf ? 'attachment' : 'inline'}; filename="comprovante-pedido-${comprovante.pedido_id}.${pdf ? 'pdf' : 'jpg'}"`);
  res.type(pdf ? 'application/pdf' : (comprovante.tipo_arquivo || 'image/jpeg'));
  res.sendFile(caminho);
});

export default rotas;
