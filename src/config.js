require('dotenv').config();
const os = require('os');
const path = require('path');

function obrigatorio(nome) {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(
      `Variavel de ambiente ${nome} nao definida. Configure em Render > Environment (ou no .env local).`
    );
  }
  return valor;
}

module.exports = {
  porta: process.env.PORT || 3000,

  // Confere as credenciais antes de gastar tempo/memoria subindo o Chrome.
  validarCredenciais() {
    obrigatorio('SACI_USER');
    obrigatorio('SACI_PASS');
  },

  // Credenciais do SSO da ANAC. NUNCA deixe isso no codigo/GitHub.
  usuario: () => obrigatorio('SACI_USER'),
  senha: () => obrigatorio('SACI_PASS'),

  // Chave que o Apps Script manda pra API. Sem isso qualquer um usa seu login.
  apiKey: process.env.API_KEY || '',

  // Pagina de consulta do CIV. Se a ANAC mudar o idMdl, troque aqui sem mexer no codigo.
  urlConsulta:
    process.env.SACI_URL ||
    'https://saci.anac.gov.br/SACI/CIV/inclusao/inclusao.asp?idMdl=447-4963',

  // Codigo da empresa usado no formulario (txtEmpresa).
  empresa: process.env.SACI_EMPRESA || '993',

  // Texto do botao que revela o formulario de usuario/senha na tela do
  // "Acesso Anac". As outras opcoes sao "Entrar com gov.br" e
  // "Entrar com Microsoft" — ambas levam pra fora do site da ANAC.
  botaoLogin: process.env.LOGIN_BOTAO || 'Entrar como externo',

  // Depois de quanto tempo consideramos a sessao velha e refazemos o login
  // preventivamente. O token do Keycloak dura ~30min, entao 20min da folga.
  sessaoTtlMs: Number(process.env.SESSION_TTL_MS || 20 * 60 * 1000),

  // Fecha o Chromium depois de X ms sem uso (economiza RAM no Render).
  // Os cookies ficam salvos em disco, entao a proxima consulta nao precisa relogar.
  browserIdleMs: Number(process.env.BROWSER_IDLE_MS || 5 * 60 * 1000),

  // os.tmpdir() funciona tanto no Windows quanto no Linux do Render.
  arquivoCookies:
    process.env.COOKIE_FILE || path.join(os.tmpdir(), 'saci-cookies.json'),

  // Print da tela quando o login falha — vale ouro pra entender o motivo.
  printDeErro:
    process.env.DEBUG_SHOT || path.join(os.tmpdir(), 'saci-erro-login.png'),

  headless: process.env.HEADLESS !== 'false',

  timeoutNavegacaoMs: Number(process.env.NAV_TIMEOUT_MS || 60 * 1000),
};
