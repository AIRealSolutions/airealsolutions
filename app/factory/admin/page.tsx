import AdminAccounts from "./AdminAccounts";
import OfficeNavLink from "../../office/OfficeNavLink";
export const metadata={title:"Factory Admin | AI Real Solutions"};
export default function AdminPage(){return <main><header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><OfficeNavLink/><a href="/factory/dashboard">My Factory</a><a href="/factory/connections">Connections</a><a className="nav-cta" href="/factory/admin">Admin</a></nav></header><AdminAccounts/></main>}
