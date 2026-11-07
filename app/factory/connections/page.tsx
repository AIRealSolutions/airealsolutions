import ConnectionsPanel from "./ConnectionsPanel";

export const metadata = { title: "Connections | AI Real Solutions Factory" };

export default function ConnectionsPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a>
        <nav>
          <a href="/factory/dashboard">My Factory</a>
          <a href="/build">New Project</a>
          <a className="nav-cta" href="/factory/connections">Connections</a>
        </nav>
      </header>
      <section className="page-hero">
        <p className="eyebrow">Factory connections</p>
        <h1>Connect the tools your work runs on.</h1>
        <p>Link your Google account for Gmail and Calendar. Factory admins can also check the GitHub, Vercel and Supabase accounts used to build and ship customer projects.</p>
      </section>
      <ConnectionsPanel />
    </main>
  );
}
