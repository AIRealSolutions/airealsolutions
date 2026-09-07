import MyFactoryDashboard from "./MyFactoryDashboard";

export const metadata={
  title:"My Factory | AI Real Solutions",
  description:"Private AI Real Solutions project operating dashboard."
};

export default function MyFactoryPage(){
  return <main>
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><a href="/factory">Factory</a><a href="/build">New Project</a><a className="nav-cta" href="/login">Account</a></nav></header>
    <MyFactoryDashboard/>
  </main>;
}
