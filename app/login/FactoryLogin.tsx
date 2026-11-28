"use client";

import {useEffect,useState} from "react";
import styles from "./login.module.css";
import OfficeNavLink from "../office/OfficeNavLink";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const SESSION_KEY="airealsolutions.factory.session.v1";

type Session={access_token:string;refresh_token?:string;expires_in?:number;expires_at?:number;user:{id:string;email?:string}};

async function authRequest(path:string,body:unknown){
  const response=await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{method:"POST",headers:{apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||"Authentication failed.");
  return data;
}
async function fetchUser(token:string){
  const response=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data?.id)throw new Error("Could not verify this Factory session.");
  return data as {id:string;email?:string};
}
/** Is the signed-in user an AI Real Solutions administrator (factory_admins)? */
async function isAdmin(token:string){
  try{
    const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/factory_is_admin`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:"{}"});
    if(r.ok&&(await r.json())===true)return true;
    // Office team members (assistant, CPA) also start in the Office.
    const m=await fetch(`${SUPABASE_URL}/rest/v1/rpc/office_role`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:"{}"});
    return m.ok&&Boolean(await m.json());
  }catch{return false}
}
/** After signing in: a same-site ?next= path, else the Office for administrators, else the Factory dashboard. */
async function goAfterSignIn(){
  const next=new URLSearchParams(window.location.search).get("next")||"";
  if(next.startsWith("/")&&!next.startsWith("//")&&!next.startsWith("/\\")){window.location.assign(next);return}
  let token="";
  try{token=JSON.parse(localStorage.getItem(SESSION_KEY)||"{}").access_token||""}catch{}
  window.location.assign(token&&await isAdmin(token)?"/office":"/factory/dashboard");
}
function persist(session:Session){
  const expiresAt=session.expires_at||Math.floor(Date.now()/1000)+(session.expires_in||3600);
  localStorage.setItem(SESSION_KEY,JSON.stringify({...session,expires_at:expiresAt}));
}
function recoveryRedirect(){
  const configured=process.env.NEXT_PUBLIC_FACTORY_AUTH_REDIRECT;
  return configured||"https://airealsolutions.com/login";
}

export default function FactoryLogin(){
  const[email,setEmail]=useState("");
  const[mode,setMode]=useState<"signin"|"signup">("signin");
  const[password,setPassword]=useState("");
  const[newPassword,setNewPassword]=useState("");
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState("");
  const[signedIn,setSignedIn]=useState(false);
  const[recovery,setRecovery]=useState(false);
  useEffect(()=>{
    // Invitation links can carry ?email= and ?mode=signup so a new team member lands on "Create account".
    const q=new URLSearchParams(window.location.search);
    const invited=q.get("email");if(invited)setEmail(invited);
    if(q.get("mode")==="signup")setMode("signup");
    void restore();
  },[]);

  async function restore(){
    try{
      const hash=new URLSearchParams(window.location.hash.replace(/^#/,""));
      const access=hash.get("access_token");
      const recoveryMode=hash.get("type")==="recovery";
      const query=new URLSearchParams(window.location.search);
      const code=query.get("code");
      if(code){
        setRecovery(true);
        setMessage("Verifying your password reset link…");
        try{
          const session=await authRequest("token?grant_type=pkce",{auth_code:code}) as Session;
          if(!session?.access_token)throw new Error("No recovery session was returned.");
          persist(session);setEmail(session.user?.email||"");
          window.history.replaceState({},"",window.location.pathname);
          setMessage("Choose a new password for your Factory account.");return;
        }catch{
          setMessage("This password reset link could not be verified. Request a new reset link.");return;
        }
      }
      if(access){
        const user=await fetchUser(access);
        const session:Session={access_token:access,refresh_token:hash.get("refresh_token")||undefined,expires_in:Number(hash.get("expires_in")||3600),user};
        persist(session);window.history.replaceState({},"",window.location.pathname);
        setEmail(user.email||"");
        if(recoveryMode){setRecovery(true);setMessage("Choose a new password for your Factory account.");return;}
        setSignedIn(true);setMessage("Signed in. Opening…");window.setTimeout(()=>void goAfterSignIn(),400);return;
      }
      const raw=localStorage.getItem(SESSION_KEY);if(!raw)return;
      const saved=JSON.parse(raw) as Session;if(!saved?.access_token)return;
      try{const user=await fetchUser(saved.access_token);persist({...saved,user});setSignedIn(true);setEmail(user.email||"");setMessage("You are already signed in.");}
      catch{if(saved.refresh_token){const refreshed=await authRequest("token?grant_type=refresh_token",{refresh_token:saved.refresh_token}) as Session;persist(refreshed);setSignedIn(true);setEmail(refreshed.user?.email||"");setMessage("Session refreshed. You can open My Factory.");}else localStorage.removeItem(SESSION_KEY)}
    }catch{localStorage.removeItem(SESSION_KEY)}
  }

  async function signIn(){
    if(!email.trim()||!password)return setMessage("Enter your email address and password.");
    setBusy(true);setMessage("");
    try{
      const session=await authRequest("token?grant_type=password",{email:email.trim(),password}) as Session;
      if(!session.access_token)throw new Error("No session was returned.");
      persist(session);setSignedIn(true);setMessage("Signed in. Opening…");window.setTimeout(()=>void goAfterSignIn(),350);
    }catch(e){setMessage(e instanceof Error?e.message:"Could not sign in.");}finally{setBusy(false)}
  }

  async function signUp(){
    if(!email.trim()||!password)return setMessage("Enter your email address and choose a password.");
    if(password.length<8)return setMessage("Use a password with at least 8 characters.");
    setBusy(true);setMessage("");
    try{
      const data=await authRequest(`signup?redirect_to=${encodeURIComponent(recoveryRedirect())}`,{email:email.trim().toLowerCase(),password}) as Partial<Session>&{identities?:unknown[]};
      if(data.access_token&&data.user){persist(data as Session);setSignedIn(true);setMessage("Account created. Opening…");window.setTimeout(()=>void goAfterSignIn(),350);return}
      // Supabase returns a user with no identities when the email already has an account.
      if(Array.isArray(data.identities)&&data.identities.length===0){setMode("signin");setMessage("An account already exists for this email. Sign in, or use “Set or reset password”.");return}
      setMessage(`Account created. Check ${email.trim()} for a confirmation email, then click the link to finish signing in.`);
    }catch(e){setMessage(e instanceof Error?e.message:"Could not create the account.");}finally{setBusy(false)}
  }

  async function sendRecovery(){
    if(!email.trim())return setMessage("Enter your email address first.");
    setBusy(true);setMessage("");
    try{
      await authRequest(`recover?redirect_to=${encodeURIComponent(recoveryRedirect())}`,{email:email.trim()});
      setMessage("Password reset email sent. Use the newest email when it arrives.");
    }catch(e){setMessage(e instanceof Error?e.message:"Could not send the password reset email.");}finally{setBusy(false)}
  }

  async function saveNewPassword(){
    if(newPassword.length<8)return setMessage("Use a password with at least 8 characters.");
    const raw=localStorage.getItem(SESSION_KEY);if(!raw)return setMessage("The recovery session expired. Request a new password reset email.");
    const session=JSON.parse(raw) as Session;
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`${SUPABASE_URL}/auth/v1/user`,{method:"PUT",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({password:newPassword})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.msg||data?.message||"Could not update password.");
      setRecovery(false);setSignedIn(true);setNewPassword("");setMessage("Password saved. Opening…");window.setTimeout(()=>void goAfterSignIn(),500);
    }catch(e){setMessage(e instanceof Error?e.message:"Could not update password.");}finally{setBusy(false)}
  }

  function signOut(){localStorage.removeItem(SESSION_KEY);setSignedIn(false);setRecovery(false);setPassword("");setMessage("Signed out on this device.");}

  return <section className={styles.wrap}>
    <div className={styles.intro}><span className="product-tag">Team & owner workspace</span><h1>Sign in to <span>AI Real Solutions.</span></h1><p>Manage your AI Real Solutions projects, architecture, features, automations, economics, build queues and project history from one place.</p><div className={styles.points}><span>Private project records</span><span>Economics & break-even</span><span>Architecture & build materialization</span><span>Automation planning</span></div></div>
    <div className={styles.card}><span className="product-tag">Secure login</span><h2>{mode==="signup"&&!signedIn&&!recovery?"Create your account":"Sign in"}</h2>
      {recovery?<><p className={styles.success}>Password recovery for <strong>{email}</strong></p><label>New password<input type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} autoComplete="new-password" minLength={8}/></label><button className="button button-primary" type="button" disabled={busy} onClick={saveNewPassword}>{busy?"Saving…":"Set New Password"}</button></>
      :signedIn?<><p className={styles.success}>Signed in as <strong>{email}</strong></p><OfficeNavLink className="button button-primary" label="Open the Office" /><a className="button button-secondary" href="/factory/dashboard">Open My Factory</a><button className={styles.linkButton} type="button" onClick={signOut}>Sign out</button></>
      :mode==="signup"?<><label>Email address<small>Use the email address your invitation was sent to.</small><input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label><label>Choose a password<small>At least 8 characters.</small><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" minLength={8} onKeyDown={e=>{if(e.key==="Enter")void signUp()}}/></label><button className="button button-primary" type="button" disabled={busy} onClick={signUp}>{busy?"Creating account…":"Create Account"}</button><button className={styles.linkButton} type="button" disabled={busy} onClick={()=>{setMode("signin");setMessage("")}}>Already have an account? Sign in</button></>
      :<><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" onKeyDown={e=>{if(e.key==="Enter")void signIn()}}/></label><button className="button button-primary" type="button" disabled={busy} onClick={signIn}>{busy?"Signing in…":"Sign In"}</button><button className={styles.linkButton} type="button" disabled={busy} onClick={()=>{setMode("signup");setMessage("")}}>New here? Create an account</button><button className={styles.linkButton} type="button" disabled={busy} onClick={sendRecovery}>Set or reset password</button></>}
      {message&&<p className={styles.notice} role="status">{message}</p>}<small className={styles.security}>Factory access is protected by Supabase authentication, membership checks and row-level security.</small>
    </div>
  </section>
}
