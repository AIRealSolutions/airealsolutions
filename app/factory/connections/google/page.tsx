import GoogleCallback from "./GoogleCallback";

export const metadata = { title: "Connecting Google | AI Real Solutions Factory", robots: { index: false } };

export default function GoogleCallbackPage() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a>
      </header>
      <GoogleCallback />
    </main>
  );
}
