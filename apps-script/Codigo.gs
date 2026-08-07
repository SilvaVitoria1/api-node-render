/**
 * Planilha -> API no Render -> SACI/ANAC.
 * Nao tem cookie nenhum aqui: quem loga e renova a sessao e a API.
 *
 * Antes de usar, rode uma vez a funcao configurarCredenciais() com os seus
 * valores, ou preencha em Extensoes > Apps Script > Configuracoes do projeto >
 * Propriedades do script:
 *   API_URL = https://api-node-render-foul.onrender.com
 *   API_KEY = a mesma chave que voce cadastrou no Render
 */

function configurarCredenciais() {
  PropertiesService.getScriptProperties().setProperties({
    API_URL: 'https://api-node-render-foul.onrender.com',
    API_KEY: 'troque-por-uma-chave-longa-e-aleatoria'
  });
  Browser.msgBox('Credenciais salvas nas propriedades do script.');
}

function propriedade_(nome) {
  var valor = PropertiesService.getScriptProperties().getProperty(nome);
  if (!valor) {
    throw new Error('Propriedade ' + nome + ' nao configurada. Rode configurarCredenciais().');
  }
  return valor;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('✈️ Sistema ANAC')
    .addItem('🔍 Pesquisar ANAC (Criar Nova Aba)', 'pesquisarECriarAba')
    .addItem('🗑️ Deletar Aba Atual', 'deletarAbaAtual')
    .addSeparator()
    .addItem('🎨 Montar Painel Bonito', 'configurarMenuBonito')
    .addToUi();
}

function configurarMenuBonito() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets()[0];

  sheet.setName('Início');
  sheet.clear();

  sheet.getRange('B2:F2').merge()
    .setValue('✈️ PAINEL DE CONSULTAS - ANAC / SACI')
    .setFontSize(14)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1c3d5a')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(2, 45);

  sheet.getRange('B4')
    .setValue('DIGITE O CÓDIGO ANAC:')
    .setFontWeight('bold')
    .setFontColor('#1c3d5a');

  sheet.getRange('B5')
    .setValue('100417')
    .setFontSize(13)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBackground('#f0f4f8')
    .setBorder(true, true, true, true, false, false, '#1c3d5a', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.setRowHeight(5, 35);

  sheet.getRange('B8').setValue('📌 COMO USAR:').setFontWeight('bold');
  sheet.getRange('B9').setValue('1. Digite o código ANAC na caixa azul acima (célula B5).');
  sheet.getRange('B10').setValue("2. Menu do topo '✈️ Sistema ANAC' > '🔍 Pesquisar ANAC'.");
  sheet.getRange('B11').setValue("3. Para apagar uma aba, acesse-a e use '🗑️ Deletar Aba Atual'.");

  sheet.setColumnWidth(1, 20);
  sheet.setColumnWidth(2, 300);
  sheet.setColumnWidth(3, 160);

  Browser.msgBox("Painel 'Início' configurado com sucesso!");
}

/** Chama a API. Se o Render estiver dormindo (free tier), tenta de novo. */
function chamarApi_(codigoAnac) {
  var url = propriedade_('API_URL').replace(/\/$/, '') +
            '/consultar?anac=' + encodeURIComponent(codigoAnac);

  var options = {
    method: 'get',
    headers: { 'x-api-key': propriedade_('API_KEY') },
    muteHttpExceptions: true
  };

  var ultimoErro = '';
  for (var tentativa = 1; tentativa <= 3; tentativa++) {
    var resposta = UrlFetchApp.fetch(url, options);
    var codigo = resposta.getResponseCode();
    var corpo = resposta.getContentText();

    if (codigo === 200) return JSON.parse(corpo);

    ultimoErro = 'HTTP ' + codigo + ': ' + corpo;
    // 502/503 costuma ser o servico acordando do sleep no Render.
    if (codigo !== 502 && codigo !== 503) break;
    Utilities.sleep(5000 * tentativa);
  }
  throw new Error('A API nao respondeu. ' + ultimoErro);
}

function pesquisarECriarAba() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var abaInicio = ss.getSheetByName('Início') || ss.getSheets()[0];
  var codigoAnac = abaInicio.getRange('B5').getValue();

  if (!codigoAnac) {
    Browser.msgBox('Por favor, digite o Código ANAC na célula B5.');
    return;
  }

  var dados;
  try {
    dados = chamarApi_(String(codigoAnac).trim());
  } catch (erro) {
    Browser.msgBox('Erro na consulta: ' + erro.message);
    return;
  }

  if (!dados.resultados || dados.resultados.length === 0) {
    Browser.msgBox('Nenhum registro encontrado para o código ' + codigoAnac + '.');
    return;
  }

  var nomeAba = 'ANAC_' + codigoAnac;
  var novaAba = ss.getSheetByName(nomeAba);
  if (!novaAba) {
    novaAba = ss.insertSheet(nomeAba);
  } else {
    novaAba.clear();
  }

  var cabecalhos = dados.colunas;
  var totalColunas = cabecalhos.length;

  novaAba.getRange(1, 1, 1, totalColunas)
    .setValues([cabecalhos])
    .setFontWeight('bold')
    .setBackground('#1c3d5a')
    .setFontColor('#ffffff')
    .setVerticalAlignment('middle');
  novaAba.setRowHeight(1, 35);

  // Monta a matriz inteira e escreve de uma vez so (o loop celula a celula
  // do script antigo fazia uma chamada de API por celula e era lentissimo).
  var linhas = dados.resultados.map(function (registro) {
    var celulas = registro.celulas.slice(0, totalColunas);
    while (celulas.length < totalColunas) celulas.push('');
    return celulas;
  });

  novaAba.getRange(2, 1, linhas.length, totalColunas).setValues(linhas);

  var intervalo = novaAba.getRange(1, 1, linhas.length + 1, totalColunas);
  intervalo.setVerticalAlignment('middle');

  novaAba.autoResizeColumns(1, totalColunas);
  for (var col = 1; col <= totalColunas; col++) {
    novaAba.setColumnWidth(col, novaAba.getColumnWidth(col) + 25);
  }

  ss.setActiveSheet(novaAba);

  var mensagem = "Aba '" + nomeAba + "' criada com " + linhas.length + ' registro(s)!';
  // O SACI pagina os resultados. Se ficou faltando, é melhor avisar do que
  // deixar a pessoa achar que a planilha tem tudo.
  if (dados.aviso) {
    mensagem += '\n\nATENÇÃO: ' + dados.aviso;
  }
  Browser.msgBox(mensagem);
}

function deletarAbaAtual() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var abaAtual = ss.getActiveSheet();
  var nomeAba = abaAtual.getName();

  if (nomeAba === 'Início' || ss.getSheets().length === 1) {
    Browser.msgBox("Você não pode deletar a aba principal 'Início'!");
    return;
  }

  var confirmacao = Browser.msgBox(
    "Deseja realmente deletar a aba '" + nomeAba + "'?",
    Browser.Buttons.YES_NO
  );
  if (confirmacao === 'yes') {
    ss.deleteSheet(abaAtual);
    Browser.msgBox('Aba deletada com sucesso!');
  }
}
