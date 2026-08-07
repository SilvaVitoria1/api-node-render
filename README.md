# API SACI / ANAC com login automático

Mantém a sessão do SACI viva sozinha: quando o cookie expira, a API refaz o
login no SSO da ANAC e repete a consulta. A planilha nunca vê um cookie.

```
Google Sheets  ──HTTPS + x-api-key──>  API no Render  ──Chrome headless──>  SSO ANAC + SACI
```

## Como funciona a renovação

1. A API guarda os cookies da sessão em `/tmp/saci-cookies.json`.
2. Antes de consultar, verifica se a sessão passou de `SESSION_TTL_MS` (20 min
   por padrão) — se passou, reloga preventivamente.
3. Se mesmo assim o SACI devolver a tela de login, ela detecta, reloga e
   **repete a consulta automaticamente**. Você não faz nada.
4. Depois de `BROWSER_IDLE_MS` sem uso, o Chrome fecha pra economizar RAM. Os
   cookies ficam salvos, então a próxima consulta não precisa relogar.

Requisições simultâneas entram numa fila, então nunca acontecem dois logins ao
mesmo tempo.

## Detalhes da tela de login da ANAC (descobertos na marra)

A tela do "Acesso Anac" oferece três caminhos: **gov.br**, **externo** e
**Microsoft**. Os campos `#username` / `#password` existem no HTML desde o
início, **mas com tamanho 0x0** — só ganham tamanho depois que você clica na
opção. Tentar digitar antes disso falha com `Node is either not clickable`.

Por isso o robô clica primeiro no botão definido em `LOGIN_BOTAO`
(padrão `Entrar como externo`) e só então preenche.

Outros dois detalhes que custaram tempo:

- A página tem **reCAPTCHA invisível**. Hoje ele deixa o robô passar, mas é
  score-based: pode endurecer sem aviso.
- A ANAC avisa que o **2FA vai ficar obrigatório**. Quando isso valer para o
  login externo, o login automático para de funcionar — não tem contorno.

## Limitação conhecida: paginação

O SACI mostra os resultados em páginas e informa `Total itens: N` no rodapé.
A API lê **só a primeira página**. Quando `N` é maior que o número de linhas
lidas, a resposta traz um campo `aviso` preenchido e a planilha mostra um
alerta — em vez de fingir que trouxe tudo.

## Variáveis de ambiente

Cadastre em **Render > seu serviço > Environment**:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SACI_USER` | sim | usuário do SSO da ANAC |
| `SACI_PASS` | sim | senha do SSO |
| `API_KEY` | recomendada | chave que a planilha envia no header `x-api-key` |
| `SACI_URL` | não | página de consulta (se a ANAC mudar o `idMdl`) |
| `SACI_EMPRESA` | não | `txtEmpresa`, padrão `993` |
| `LOGIN_BOTAO` | não | botão que revela o formulário, padrão `Entrar como externo` |
| `SESSION_TTL_MS` | não | padrão `1200000` (20 min) |
| `BROWSER_IDLE_MS` | não | padrão `300000` (5 min) |

Sem `API_KEY` a rota fica **aberta na internet** e qualquer um consulta o SACI
com o seu login. Configure.

## Deploy no Render

O serviço precisa rodar como **Docker** (o Chrome vem instalado na imagem).
Em Render > Settings > mude o Runtime para `Docker` — o `Dockerfile` já está no
repositório. O `render.yaml` também cobre isso se você criar via blueprint.

Use o plano **Starter**. No Free (512 MB) o Chrome costuma estourar memória, e
o serviço dorme após 15 min — o primeiro acesso leva ~50s pra acordar (o Apps
Script já tenta de novo automaticamente nesse caso).

## Endpoints

```
GET /consultar?anac=100417   header: x-api-key
GET /status                  header: x-api-key
GET /health
```

Resposta:

```json
{
  "status": "sucesso",
  "codigo_anac": "100417",
  "colunas": ["Cód. ANAC", "Usuário", "..."],
  "total_registros": 2,
  "resultados": [
    { "celulas": ["100417", "..."], "codigo_anac": "100417", "habilitacao": "A320" }
  ]
}
```

## Rodar local

```bash
cp .env.example .env && npm install && npm start
```

Para ver o navegador fazendo o login (útil pra depurar), rode com `HEADLESS=false`.

## Planilha

O código do Apps Script está em `apps-script/Codigo.gs`. Cole na planilha, rode
`configurarCredenciais()` uma vez com sua URL e sua `API_KEY`, e recarregue.
