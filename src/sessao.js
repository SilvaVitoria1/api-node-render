const fs = require('fs/promises');
const puppeteer = require('puppeteer');
const config = require('./config');

// ---------------------------------------------------------------------------
// Estado global da sessao. Fica em memoria enquanto o processo vive; os cookies
// tambem vao pro disco pra sobreviver ao fechamento do Chromium por ociosidade.
// ---------------------------------------------------------------------------
let browser = null;
let logadoEm = 0;
let timerOcioso = null;

// Garante que duas requisicoes simultaneas nao facam dois logins ao mesmo tempo.
let fila = Promise.resolve();

function log(...args) {
  console.log('[saci]', ...args);
}

function emFila(tarefa) {
  const resultado = fila.then(tarefa, tarefa);
  // Nao deixa uma falha travar a fila pras proximas chamadas.
  fila = resultado.then(
    () => undefined,
    () => undefined
  );
  return resultado;
}

// ---------------------------------------------------------------------------
// Cookies em disco
// ---------------------------------------------------------------------------
async function salvarCookies(page) {
  try {
    const cookies = await page.cookies();
    await fs.writeFile(
      config.arquivoCookies,
      JSON.stringify({ logadoEm, cookies }, null, 2)
    );
  } catch (erro) {
    log('nao consegui salvar cookies:', erro.message);
  }
}

async function restaurarCookies(page) {
  try {
    const bruto = await fs.readFile(config.arquivoCookies, 'utf8');
    const dados = JSON.parse(bruto);
    if (!Array.isArray(dados.cookies) || dados.cookies.length === 0) return false;
    await page.setCookie(...dados.cookies);
    logadoEm = dados.logadoEm || 0;
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------
async function obterBrowser() {
  if (browser && browser.connected) return browser;

  log('abrindo Chromium...');
  browser = await puppeteer.launch({
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--window-size=1366,768',
    ],
  });

  browser.on('disconnected', () => {
    browser = null;
  });

  return browser;
}

function agendarFechamentoPorOciosidade() {
  if (timerOcioso) clearTimeout(timerOcioso);
  if (!config.browserIdleMs) return;

  timerOcioso = setTimeout(async () => {
    if (browser) {
      log('sem uso, fechando Chromium pra liberar memoria');
      try {
        await browser.close();
      } catch {
        /* ignora */
      }
      browser = null;
    }
  }, config.browserIdleMs);

  // Nao segura o processo vivo so por causa desse timer.
  if (typeof timerOcioso.unref === 'function') timerOcioso.unref();
}

async function novaPagina() {
  const b = await obterBrowser();
  const page = await b.newPage();
  page.setDefaultNavigationTimeout(config.timeoutNavegacaoMs);
  // Sem viewport decente o layout do login colapsa e os campos ficam 0x0.
  await page.setViewport({ width: 1366, height: 900 });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  return page;
}

// ---------------------------------------------------------------------------
// Deteccao de tela de login
// ---------------------------------------------------------------------------
async function estaNaTelaDeLogin(page) {
  if (page.url().includes('sso.anac.gov.br')) return true;
  return page.evaluate(
    () =>
      !!document.querySelector(
        '#kc-form-login, form#kc-form-login, input#username, input[name="username"]'
      )
  );
}

function pareceHtmlDeLogin(html) {
  const alvo = (html || '').toLowerCase();
  return (
    alvo.includes('kc-form-login') ||
    alvo.includes('sso.anac.gov.br') ||
    alvo.includes('id="username"') ||
    alvo.includes('name="username"')
  );
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
/** Acha um botao/link pelo texto exato e clica nele de verdade (mouse). */
async function clicarPorTexto(page, texto) {
  const candidatos = await page.$$('button, a, [ng-click]');
  for (const elemento of candidatos) {
    const proprio = await elemento.evaluate((el) => {
      // innerText do elemento em si, ignorando filhos aninhados demais.
      return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    });
    if (proprio !== texto) continue;

    const caixa = await elemento.boundingBox();
    if (caixa && caixa.width > 0 && caixa.height > 0) {
      await elemento.click();
    } else {
      // Elemento sem area visivel: dispara o clique pelo proprio DOM.
      await elemento.evaluate((el) => el.click());
    }
    return true;
  }
  return false;
}

/** Espera o campo existir E ter tamanho na tela (nao adianta existir escondido). */
async function esperarCampoVisivel(page, seletor, timeout = 20000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    },
    { timeout },
    seletor
  );
  return page.$(seletor);
}

async function campoEstaVisivel(page, seletor) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }, seletor);
}

async function preencherFormularioDeLogin(page) {
  const usuario = config.usuario();
  const senha = config.senha();

  // A tela do "Acesso Anac" comeca com tres opcoes (gov.br / externo /
  // Microsoft). Os campos de usuario e senha existem no HTML desde o inicio,
  // mas com tamanho zero — so aparecem depois de escolher a opcao. Sem esse
  // clique, qualquer tentativa de digitar falha com "not clickable".
  if (!(await campoEstaVisivel(page, 'input#username'))) {
    const abriu = await clicarPorTexto(page, config.botaoLogin);
    if (!abriu) {
      throw new Error(
        `Nao achei o botao "${config.botaoLogin}" na tela de login da ANAC. ` +
          'Se a ANAC mudou o texto do botao, ajuste a variavel LOGIN_BOTAO.'
      );
    }
  }

  const campoUsuario = await esperarCampoVisivel(page, 'input#username');
  const campoSenha = await esperarCampoVisivel(page, 'input#password');

  // Campo pode vir preenchido pelo autofill do Chromium; limpa antes.
  await campoUsuario.click({ clickCount: 3 });
  await campoUsuario.type(usuario, { delay: 40 });
  await campoSenha.click({ clickCount: 3 });
  await campoSenha.type(senha, { delay: 40 });

  const enviou =
    (await clicarPorTexto(page, 'Entrar')) ||
    (await page
      .click('button[type="submit"], input[type="submit"]')
      .then(() => true)
      .catch(() => false));

  if (!enviou) {
    throw new Error('Nao achei o botao "Entrar" do formulario de login.');
  }

  // Depois do envio vem uma sequencia de redirects de volta pro SACI.
  // O reCAPTCHA invisivel tambem roda nesse momento, entao damos folga.
  await page
    .waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
    .catch(() => null);
  await page
    .waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 })
    .catch(() => null);
}

async function lerErroDeLogin(page) {
  return page
    .evaluate(() => {
      const seletores = [
        '#input-error',
        '.alert-error',
        '.kc-feedback-text',
        'md-toast',
        '.md-toast-content',
        '[ng-messages] [ng-message]',
        '.error, .erro, .msg-erro',
      ];
      for (const sel of seletores) {
        const el = document.querySelector(sel);
        const txt = el && (el.innerText || el.textContent || '').trim();
        if (txt) return txt.replace(/\s+/g, ' ').slice(0, 200);
      }
      return null;
    })
    .catch(() => null);
}

/**
 * Abre a pagina de consulta. Se cair no SSO, faz o login e volta.
 * Retorna a page ja autenticada e posicionada na pagina de consulta.
 */
async function abrirPaginaAutenticada({ forcarLogin = false } = {}) {
  const page = await novaPagina();

  if (!forcarLogin) {
    await restaurarCookies(page);
  } else {
    logadoEm = 0;
  }

  await page.goto(config.urlConsulta, { waitUntil: 'networkidle2' });

  if (await estaNaTelaDeLogin(page)) {
    log('sessao expirada ou inexistente — fazendo login no SSO');
    await preencherFormularioDeLogin(page);

    if (await estaNaTelaDeLogin(page)) {
      const motivo = await lerErroDeLogin(page);
      await page
        .screenshot({ path: config.printDeErro, fullPage: true })
        .catch(() => {});
      log(`login falhou — print salvo em ${config.printDeErro}`);
      await page.close().catch(() => {});
      throw new Error(
        `Falha no login da ANAC${motivo ? `: ${motivo}` : ' (usuario/senha invalidos, ou reCAPTCHA/2FA barrou o robo)'}`
      );
    }

    // O Keycloak devolve pra pagina inicial do SACI; volta pra consulta.
    if (!page.url().startsWith(config.urlConsulta.split('?')[0])) {
      await page.goto(config.urlConsulta, { waitUntil: 'networkidle2' });
    }

    logadoEm = Date.now();
    await salvarCookies(page);
    log('login concluido');
  } else if (!logadoEm) {
    logadoEm = Date.now();
  }

  return page;
}

function sessaoVelha() {
  return !logadoEm || Date.now() - logadoEm > config.sessaoTtlMs;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------
async function buscarHtml(page, codigoAnac) {
  const payload =
    'acao=&hdnIdHora=&txtEmpresa=' +
    encodeURIComponent(config.empresa) +
    '&txtUsuario=&txtCdAnac=' +
    encodeURIComponent(codigoAnac) +
    '&txtFuncaoBordo=&txtHabilitacao=&x=43&y=12';

  // O POST roda dentro da propria pagina: mesma sessao, mesmos cookies,
  // mesma impressao digital de navegador que o WAF ja aceitou.
  return page.evaluate(
    async (url, corpo) => {
      const resposta = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: corpo,
      });
      const buffer = await resposta.arrayBuffer();

      // Descobre a codificacao em vez de chutar: paginas do SACI aparecem
      // tanto em UTF-8 quanto em ISO-8859-1, e errar isso quebra os acentos.
      const tipo = resposta.headers.get('content-type') || '';
      let charset = (/charset=["']?([\w-]+)/i.exec(tipo) || [])[1];

      if (!charset) {
        const amostra = new TextDecoder('iso-8859-1').decode(buffer.slice(0, 4096));
        charset = (/charset=["']?([\w-]+)/i.exec(amostra) || [])[1] || 'utf-8';
      }

      try {
        return new TextDecoder(charset).decode(buffer);
      } catch {
        return new TextDecoder('utf-8').decode(buffer);
      }
    },
    config.urlConsulta,
    payload
  );
}

/**
 * Consulta um codigo ANAC. Cuida sozinho de login, expiracao e retentativa.
 */
async function consultar(codigoAnac) {
  config.validarCredenciais();

  return emFila(async () => {
    let page;
    try {
      page = await abrirPaginaAutenticada({ forcarLogin: sessaoVelha() });
      let html = await buscarHtml(page, codigoAnac);

      // Cinto e suspensorio: se mesmo assim veio a tela de login, relogamos
      // do zero e tentamos mais uma vez.
      if (pareceHtmlDeLogin(html)) {
        log('resposta veio como tela de login — refazendo login e tentando de novo');
        await page.close().catch(() => {});
        page = await abrirPaginaAutenticada({ forcarLogin: true });
        html = await buscarHtml(page, codigoAnac);

        if (pareceHtmlDeLogin(html)) {
          throw new Error(
            'O SACI continua devolvendo a tela de login apos o relogin. Verifique as credenciais ou se a URL de consulta mudou.'
          );
        }
      }

      await salvarCookies(page);
      return html;
    } finally {
      if (page) await page.close().catch(() => {});
      agendarFechamentoPorOciosidade();
    }
  });
}

function status() {
  return {
    browser_aberto: !!(browser && browser.connected),
    logado: !!logadoEm,
    logado_em: logadoEm ? new Date(logadoEm).toISOString() : null,
    sessao_expira_em: logadoEm
      ? new Date(logadoEm + config.sessaoTtlMs).toISOString()
      : null,
    sessao_velha: sessaoVelha(),
  };
}

async function encerrar() {
  if (timerOcioso) clearTimeout(timerOcioso);
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

module.exports = { consultar, status, encerrar };
