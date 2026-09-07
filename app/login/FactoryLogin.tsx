"use client";

import {useEffect,useState} from "react";
import styles from "./login.module.css";

const SUPABASE_URL="https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY="sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const SESSION_KEY="airealsolutions.factory.session.v1";
const OWNER_EMAIL="marcspencer28461@gmail.com";

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
function persist(session:Session){
  const expiresAt=session.expires_at||Math.floor(Date.now()/1000)+(session.expires_in||3600);
  localStorage.setItem(SESSION_KEY,JSON.stringify({...session,expires_at:expiresAt}));
}

export default function FactoryLogin(){
  const[email,setEmail]=useState(OWNER_EMAIL);const[code,setCode]=useState("");const[sent,setSent]=useState(false);const[busy,setBusy]=useState(false);const[message,setMessage]=useState("");const[signedIn,setSignedIn]=useState(false);
  useEffect(()=>{void restore()},[]);
  async function restore(){
    try{
      const hash=new URLSearchParams(window.location.hash.replace(/^#/,""));
      const access=hash.get("access_token");
      if(access){
        const user=await fetchUser(access);
        const session:Session={access_token:access,refresh_token:hash.get("refresh_token")||undefined,expires_in:Number(hash.get("expires_in")||3600),user};
        persist(session);window.history.replaceState({},"",window.location.pathname);setSignedIn(true);setEmail(user.email||OWNER_EMAIL);setMessage("Signed in. Opening your Factory dashboard…");window.setTimeout(()=>window.location.assign("/factory/dashboard"),400);return;
      }
      const raw=localStorage.getItem(SESSION_KEY);if(!raw)return;
      const saved=JSON.parse(raw) as Session;if(!saved?.access_token)return;
      try{const user=await fetchUser(saved.access_token);persist({...saved,user});setSignedIn(true);setEmail(user.email||OWNER_EMAIL);setMessage("You are already signed in.");}
      catch{if(saved.refresh_token){const refreshed=await authRequest("token?grant_type=refresh_token",{refresh_token:saved.refresh_token});persist(refreshed as Session);setSignedIn(true);setMessage("Session refreshed. You can open My Factory.");}else localStorage.removeItem(SESSION_KEY)}
    }catch{localStorage.removeItem(SESSION_KEY)}
  }
  async function send(){
    if(!email.trim())return setMessage("Enter your email address.");setBusy(true);setMessage("");
    try{const redirect=encodeURIComponent(`${window.location.origin}/login`);await authRequest(`otp?redirect_to=${redirect}`,{email:email.trim(),create_user:false});setSent(true);setMessage("Check your email for the Factory sign-in link or verification code.");}
    catch(e){setMessage(e instanceof Error?e.message:"Could not send the sign-in email.")}finally{setBusy(false)}
  }
  async function verify(){
    if(!code.trim())return setMessage("Enter the code from your email.");setBusy(true);setMessage("");
    try{const session=await authRequest("verify",{email:email.trim(),token:code.trim(),type:"email"}) as Session;if(!session.access_token)throw new Error("No session was returned.");persist(session);setSignedIn(true);setMessage("Signed in. Opening your Factory dashboard…");window.setTimeout(()=>window.location.assign("/factory/dashboard"),350);}
    catch(e){setMessage(e instanceof Error?e.message:"Could not verify the code.")}finally{setBusy(false)}
  }
  function signOut(){localStorage.removeItem(SESSION_KEY);setSignedIn(false);setSent(false);setCode("");setMessage("Signed out on this device.")}
  return <section className={styles.wrap}>
    <div className={styles.intro}><span className="product-tag">Owner workspace</span><h1>Sign in to <span>My Factory.</span></h1><p>Manage your AI Real Solutions projects, architecture, features, automations, economics, build queues and project history from one place.</p><div className={styles.points}><span>Private project records</span><span>Economics & break-even</span><span>Architecture & build materialization</span><span>Automation planning</span></div></div>
    <div className={styles.card}><span className="product-tag">Passwordless login</span><h2>Factory access</h2>{signedIn?<><p className={styles.success}>Signed in as <strong>{email}</strong></p><a className="button button-primary" href="/factory/dashboard">Open My Factory</a><button className={styles.linkButton} type="button" onClick={signOut}>Sign out</button></>:<><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label>{!sent?<button className="button button-primary" type="button" disabled={busy} onClick={send}>{busy?"Sending…":"Email Sign-In"}</button>:<><label>Verification code <small>Use this if the email includes a six-digit code.</small><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} placeholder="123456"/></label><button className="button button-primary" type="button" disabled={busy} onClick={verify}>{busy?"Verifying…":"Verify Code"}</button><button className={styles.linkButton} type="button" disabled={busy} onClick={send}>Send another email</button></>}</>}{message&&<p className={styles.notice} role="status">{message}</p>}<small className={styles.security}>Access is filtered by your authenticated Factory membership and Supabase row-level security.</small></div>
  </section>
}
