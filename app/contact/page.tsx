export const metadata = {
  title: "Contact | AI Real Solutions",
  description:
    "Start a conversation with AI Real Solutions about automation, software development, civic technology, AI workflows, marketing, or public-sector projects.",
};

export default function ContactPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/" aria-label="AI Real Solutions home"><span className="brand-mark">AI</span><span>Real Solutions</span></a>
        <nav aria-label="Primary navigation">
          <a href="/services">Services</a><a href="/products">Products</a><a href="/about">About</a><a className="nav-cta" href="/contact">Start a Project</a>
        </nav>
      </header>

      <section className="page-hero contact-hero">
        <p className="eyebrow">Start a project</p>
        <h1>Tell us what should work better.</h1>
        <p>You do not need to know which AI model, software stack, or automation platform you need. Start with the problem, the process, or the result you are trying to achieve.</p>
      </section>

      <section className="section contact-grid">
        <article className="contact-card">
          <p className="eyebrow">A good starting point</p>
          <h2>What to send</h2>
          <ul>
            <li>What your organization does</li>
            <li>What task, process, or communication is causing friction</li>
            <li>Who currently handles the work</li>
            <li>What a better outcome would look like</li>
            <li>Any software or data you already use</li>
          </ul>
        </article>

        <article className="contact-card contact-action-card">
          <p className="eyebrow">Contact</p>
          <h2>Start the conversation.</h2>
          <p>Email the project summary, even if it is rough. The first goal is simply to understand the problem well enough to decide what should happen next.</p>
          <a className="button button-primary" href="mailto:marcspencer28461@gmail.com?subject=AI%20Real%20Solutions%20Project%20Inquiry">Email AI Real Solutions</a>
          <p className="contact-email">marcspencer28461@gmail.com</p>
        </article>
      </section>
    </main>
  );
}
