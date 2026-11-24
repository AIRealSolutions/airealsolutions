import MyFactoryDashboard from "./MyFactoryDashboard";
import OfficeNavLink, { OfficeBanner } from "../../office/OfficeNavLink";

export const metadata={
  title:"My Factory | AI Real Solutions",
  description:"Private AI Real Solutions project operating dashboard."
};

export default function MyFactoryPage(){
  return <main>
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark">AI</span><span>Real Solutions</span></a><nav><OfficeNavLink/><a href="/factory">Factory</a><a href="/build">New Project</a><a href="/factory/connections">Connections</a><a href="/factory/admin">Admin</a><a className="nav-cta" href="/login">Account</a></nav></header>
    <OfficeBanner/><MyFactoryDashboard/>
  </main>;
}
