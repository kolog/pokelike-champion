import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pokelike Auto-Player — Userscript hub" },
      { name: "description", content: "Install a Tampermonkey userscript that auto-plays pokelike.xyz with a type-chart AI." },
      { property: "og:title", content: "Pokelike Auto-Player" },
      { property: "og:description", content: "Userscript that plays pokelike.xyz for you." },
    ],
  }),
  component: Index,
});

function downloadScript() {
  fetch("/pokelike-autoplay.user.js")
    .then((r) => {
      if (!r.ok) throw new Error("Download failed: " + r.status);
      return r.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pokelike-autoplay.user.js";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    })
    .catch((e) => alert(e.message));
}

function Index() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Userscript · v0.1.0
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Pokelike <span className="text-emerald-400">Auto-Player</span>
        </h1>
        <p className="mt-4 text-lg text-slate-300">
          Um userscript que joga <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm">pokelike.xyz</code> por
          você. IA heurística baseada na tabela de tipos Pokémon, com HUD flutuante de controle dentro do próprio site.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={downloadScript}
            className="rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            ⬇ Baixar userscript
          </button>
          <a
            href="https://www.tampermonkey.net/"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-700 px-5 py-3 font-medium text-slate-200 transition hover:border-slate-500"
          >
            Instalar Tampermonkey
          </a>
        </div>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">Como instalar</h2>
          <ol className="mt-4 space-y-3 text-slate-300">
            <li><span className="mr-2 text-emerald-400 font-mono">1.</span>Instale a extensão <a className="text-emerald-300 underline" href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer">Tampermonkey</a> (Chrome, Edge, Brave, Firefox…).</li>
            <li><span className="mr-2 text-emerald-400 font-mono">2.</span>Clique em <b>Baixar userscript</b> acima.</li>
            <li><span className="mr-2 text-emerald-400 font-mono">3.</span>Abra o arquivo <code className="rounded bg-slate-800 px-1 py-0.5">.user.js</code> baixado — o Tampermonkey vai abrir a tela de instalação. Clique em <b>Install</b>.</li>
            <li><span className="mr-2 text-emerald-400 font-mono">4.</span>Acesse <a className="text-emerald-300 underline" href="https://pokelike.xyz" target="_blank" rel="noreferrer">pokelike.xyz</a>, faça login normalmente e comece um modo (Story / Battle Tower / Challenge).</li>
            <li><span className="mr-2 text-emerald-400 font-mono">5.</span>No canto inferior direito vai aparecer o HUD do Auto-Player. Clique em <b>▶ Start</b>.</li>
          </ol>
        </section>

        <section className="mt-12 grid gap-4 sm:grid-cols-2">
          <Feature title="Motor de tipos" body="Tabela de efetividade Gen 6+ embutida. Escolhe o golpe de maior dano esperado contra os tipos do oponente." />
          <Feature title="Auto-transições" body="Clica em Continue, Next Map, Skip, aceita/recusa ofertas e escolhe evolução conforme sua preferência." />
          <Feature title="HUD no jogo" body="Painel flutuante com Start/Stop, velocidade, modo de evolução e debug — não precisa voltar nesse site." />
          <Feature title="Failsafes" body="Para sozinho ao detectar GAME OVER ou após 8 ticks sem encontrar ação. Logs detalhados no console (F12)." />
        </section>

        <section className="mt-12 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-100">
          <h3 className="mb-2 font-semibold text-amber-300">⚠ Aviso</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>Automatizar pokelike.xyz <b>provavelmente viola os termos do site</b>. Use por sua conta e risco.</li>
            <li>O jogo é uma SPA — qualquer update do dev pode quebrar os seletores do script. Se travar, abra o console (F12) e me mande os logs <code className="rounded bg-slate-800 px-1">[PokelikeAI]</code> para eu atualizar.</li>
            <li>O script é 100% local: não envia dados para lugar nenhum, não usa sua conta fora do navegador.</li>
            <li>Cobertura inicial: <b>Story Classic</b> (batalha selvagem, ordem, evolução, transições). Battle Tower e Challenges no próximo ajuste.</li>
          </ul>
        </section>

        <footer className="mt-12 text-center text-xs text-slate-500">
          Feito com Lovable · Sem login, sem servidor — tudo client-side.
        </footer>
      </div>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <h3 className="font-semibold text-emerald-300">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{body}</p>
    </div>
  );
}
