import FactoryLogin from "./FactoryLogin";

export const metadata={
  title:"Factory Login | AI Real Solutions",
  description:"Sign in to the AI Real Solutions Software + Automation Factory."
};

export default function LoginPage(){
  return <main>
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><a href="/factory">Factory</a><a href="/products">Products</a><a href="/build">New Project</a></nav></header>
    <FactoryLogin/>
  </main>;
}
