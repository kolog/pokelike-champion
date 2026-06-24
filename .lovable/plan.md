# Plano: Auto-Player para pokelike.xyz via Userscript

Aviso: a automação roda **fora do Lovable**, dentro do seu navegador via Tampermonkey/Violentmonkey. O app Lovable serve só como hub para baixar o script, ver instruções e ajustar configurações que o script lê. Automatizar o site provavelmente viola os termos do pokelike.xyz e pode quebrar a cada update do jogo — você assume esse risco.

## O que vou entregar

1. **Site Lovable (pokelike-autoplay-hub)** — uma landing page única com:
   - Explicação do que é, riscos e disclaimer.
   - Botão "Baixar userscript" (`pokelike-autoplay.user.js` servido em `/public/`).
   - Instruções passo a passo de instalação (Tampermonkey).
   - Painel de configuração (velocidade, modo agressivo/seguro, modo: Story / Battle Tower / Challenges, parar ao morrer, log no console) — salvo em `localStorage` sob uma chave compartilhada que o userscript lê via `@match` no mesmo domínio... como o script roda em pokelike.xyz e o hub em outro domínio, o ajuste é feito **dentro da própria página do pokelike**, num painel flutuante que o userscript injeta. O hub Lovable só ensina e distribui.

2. **Userscript `pokelike-autoplay.user.js`** com:
   - Cabeçalho Tampermonkey (`@match https://pokelike.xyz/*`, `@grant GM_setValue/GM_getValue`).
   - **Detector de estado**: observa o DOM (MutationObserver) e identifica em qual tela está — menu, escolha de ordem, batalha selvagem, escolha de evolução, game over, vitória.
   - **Motor de IA de batalha** (heurística, não LLM — roda local, instantâneo):
     - Tabela de efetividade de tipos Pokémon embutida.
     - Para cada movimento disponível: calcula dano esperado = `power * STAB * efetividade * (atk/def)` e escolhe o melhor.
     - Troca de Pokémon se o ativo tiver desvantagem grave de tipo e houver alternativa melhor no banco.
     - Usa item de cura se HP < 25% e houver poção.
   - **Auto-clicker** das telas não-decisórias: "Continue", "Next Map", "Skip", aceitar/recusar item, escolher evolução (preferência configurável).
   - **Painel flutuante (HUD)** no canto da tela com: start/stop, modo, velocidade entre ações, contador de batalhas vencidas, último log.
   - **Failsafes**: para automaticamente se detectar "GAME OVER" ou se 3 ações seguidas falharem.

3. **Estratégia de descoberta do DOM**: como pokelike.xyz é SPA e não tenho como inspecioná-lo a fundo de dentro do sandbox, o script vai usar **seletores resilientes** (texto de botões, classes parciais, ARIA) e expor um **modo debug** que loga no console toda transição de estado. Primeira entrega = versão funcional para o Story Mode Classic; Battle Tower e Challenges entram numa segunda iteração depois que você testar e me mandar prints/logs do console se algo não casar.

## Estrutura técnica (TanStack Start)

```text
src/routes/index.tsx              → landing + instruções + botão download
src/components/DownloadButton.tsx → fetch+blob de /pokelike-autoplay.user.js
src/components/InstallSteps.tsx
src/components/Disclaimer.tsx
public/pokelike-autoplay.user.js  → o userscript (servido estático)
```

Sem backend, sem Lovable Cloud, sem login. Tudo client-side.

## O que NÃO entra neste plano

- Login automatizado com sua conta no pokelike.xyz (você joga logado no seu próprio navegador, o script só clica por cima).
- Garantia de "zerar" — depende de RNG do jogo, da heurística aguentar o Elite Four e do DOM do site não mudar.
- Battle Tower infinito e Challenges específicos na v1 (entram depois com seus logs).

Confirma que posso seguir assim? Se sim, na fase de build eu já crio o hub + a primeira versão do userscript com Story Mode Classic cobrindo batalha selvagem, escolha de ordem, evolução e telas de transição.
