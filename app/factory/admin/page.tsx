import AdminAccounts from "./AdminAccounts";
export const metadata={title:"Factory Admin | AI Real Solutions"};
export default function AdminPage(){return <main><header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><a href="/factory/dashboard">My Factory</a><a className="nav-cta" href="/factory/admin">Admin</a></nav></header><AdminAccounts/></main>}
