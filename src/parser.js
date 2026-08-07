const cheerio = require('cheerio');

// O SACI monta a pagina com tabelas dentro de tabelas (layout antigo de ASP).
// Procurar "qualquer <tr>" pega menu, rodape e barra do gov.br junto. A regra
// que funciona: so tabelas FOLHA (sem outra tabela dentro) cuja primeira linha
// e um cabecalho de verdade contendo "Cod. ANAC".
const MARCA_CABECALHO = /c[óo]d\.?\s*anac/i;
const SEM_REGISTRO = /nenhum\s+registro/i;

function texto($, el) {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

function semAcento(s) {
  // ̀-ͯ = os acentos que o NFD separa das letras.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "Data Início" -> "data_inicio" ; "Usuário Lança.:" -> "usuario_lanca" */
function chave(titulo) {
  const base = semAcento(titulo)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || null;
}

function ehLinhaDeCabecalho(celulas) {
  return (
    celulas.some((c) => MARCA_CABECALHO.test(c)) &&
    celulas.every((c) => c.length < 40)
  );
}

/** Descobre o titulo da secao ("::. Lancamento de ...") que vem antes da tabela. */
function tituloDaSecao($, todosElementos, tabela) {
  const posicao = todosElementos.indexOf(tabela);
  for (let i = posicao - 1; i >= 0 && i > posicao - 400; i--) {
    const t = texto($, todosElementos[i]);
    if (t.length > 200) continue;
    const achou = /::\.\s*(.+)/.exec(t);
    if (achou) return achou[1].trim();
  }
  return null;
}

/**
 * Le "Total itens: 6" do rodape de paginacao.
 * Tem que rodar sobre o TEXTO ja limpo, nao sobre o HTML cru: no HTML existem
 * tags e &nbsp; no meio ("Total itens:</td><td>6") e a busca nao casa.
 */
function totalInformado(textoDaPagina) {
  const achou = /total\s+itens?\s*:?\s*(\d+)/i.exec(textoDaPagina);
  return achou ? Number(achou[1]) : null;
}

function parseTabela(html) {
  const $ = cheerio.load(html);
  const todos = $('*').toArray();
  const secoes = [];

  $('table').each((_, tabela) => {
    // Tabela folha: se tem outra tabela dentro, e layout, nao resultado.
    if ($(tabela).find('table').length > 0) return;

    // toArray() + map do JS: o .map() do cheerio achata arrays aninhados e
    // devolveria uma lista solta de strings em vez de linhas x colunas.
    const linhas = $(tabela)
      .find('tr')
      .toArray()
      .map((tr) =>
        $(tr)
          .find('td,th')
          .toArray()
          .map((c) => texto($, c))
      );

    if (linhas.length === 0) return;
    if (!ehLinhaDeCabecalho(linhas[0])) return;

    // O SACI fecha a linha com uma coluna vazia (celula de acao). Corta.
    let colunas = linhas[0].slice();
    while (colunas.length && colunas[colunas.length - 1] === '') colunas.pop();

    const dados = [];
    for (const celulas of linhas.slice(1)) {
      const juntas = celulas.join(' ').trim();
      if (!juntas) continue;
      if (SEM_REGISTRO.test(juntas)) continue;

      const recortadas = celulas.slice(0, colunas.length);
      while (recortadas.length < colunas.length) recortadas.push('');

      const campos = {};
      colunas.forEach((titulo, i) => {
        const k = chave(titulo);
        if (k) campos[k] = recortadas[i];
      });

      dados.push({ celulas: recortadas, ...campos });
    }

    secoes.push({
      titulo: tituloDaSecao($, todos, tabela),
      colunas,
      linhas: dados,
      vazia: dados.length === 0,
    });
  });

  const comDados = secoes.filter((s) => !s.vazia);

  return {
    // Colunas e linhas da(s) secao(oes) que realmente trouxeram registros.
    colunas: comDados.length ? comDados[0].colunas : secoes.length ? secoes[0].colunas : [],
    resultados: comDados.flatMap((s) => s.linhas),
    total_no_site: totalInformado($.root().text().replace(/\s+/g, ' ')),
    secoes: secoes.map((s) => ({
      titulo: s.titulo,
      colunas: s.colunas,
      total_linhas: s.linhas.length,
      vazia: s.vazia,
    })),
  };
}

module.exports = { parseTabela };
