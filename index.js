const express = require('express');
const config = require('./src/config');
const sessao = require('./src/sessao');
const { parseTabela } = require('./src/parser');

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Autenticacao da propria API. Sem isso, qualquer pessoa que descobrir a URL
// do Render consulta o SACI usando o SEU login.
// ---------------------------------------------------------------------------
function exigirChave(req, res, next) {
  if (!config.apiKey) return next(); // sem API_KEY configurada, fica aberta
  const chave = req.get('x-api-key') || req.query.key;
  if (chave !== config.apiKey) {
    return res.status(401).json({ status: 'erro', erro: 'Chave de API invalida.' });
  }
  next();
}

app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    mensagem: 'API SACI/ANAC com login automatico',
    endpoints: ['/consultar?anac=100417', '/status', '/health'],
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/status', exigirChave, (_req, res) => {
  res.json({ status: 'ok', sessao: sessao.status() });
});

app.get('/consultar', exigirChave, async (req, res) => {
  const codigoAnac = String(req.query.anac || '').trim();

  if (!codigoAnac) {
    return res.status(400).json({
      status: 'erro',
      erro: 'Informe o codigo ANAC na URL. Exemplo: /consultar?anac=100417',
    });
  }

  try {
    const html = await sessao.consultar(codigoAnac);

    // ?formato=html devolve a pagina crua — util pra depurar quando o SACI
    // mudar o layout e o parser parar de achar a tabela.
    if (req.query.formato === 'html') {
      return res.type('text/plain; charset=utf-8').send(html);
    }

    const { colunas, resultados, total_no_site, secoes } = parseTabela(html);

    // Se o site diz "Total itens: 40" e so vieram 20, tem mais paginas e a
    // planilha ficaria com dados faltando sem ninguem perceber.
    const faltando =
      typeof total_no_site === 'number' && total_no_site > resultados.length;

    res.json({
      status: 'sucesso',
      codigo_anac: codigoAnac,
      colunas,
      total_registros: resultados.length,
      total_no_site,
      aviso: faltando
        ? `O site informa ${total_no_site} itens, mas esta pagina trouxe ${resultados.length}. Ha mais paginas de resultado.`
        : null,
      secoes,
      resultados,
      consultado_em: new Date().toISOString(),
    });
  } catch (erro) {
    console.error('[consultar] falhou:', erro);
    res.status(502).json({
      status: 'erro',
      codigo_anac: codigoAnac,
      erro: erro.message,
    });
  }
});

const servidor = app.listen(config.porta, () => {
  console.log(`Servidor rodando na porta ${config.porta}`);

  // Avisa no log do deploy em vez de deixar o erro aparecer so na 1a consulta.
  try {
    config.validarCredenciais();
  } catch (erro) {
    console.error(`ATENCAO: ${erro.message}`);
  }
  if (!config.apiKey) {
    console.warn('ATENCAO: API_KEY nao definida — a rota /consultar esta aberta na internet.');
  }
});

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, async () => {
    console.log(`${sinal} recebido, encerrando...`);
    servidor.close();
    await sessao.encerrar();
    process.exit(0);
  });
}
