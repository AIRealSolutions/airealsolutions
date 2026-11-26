// The Office service worker: shows phone notifications and makes the Office installable.
// It does not cache pages or data; everything still comes fresh from the server.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {}); // present so browsers treat the Office as an installable app

self.addEventListener("push", (event) => {
  let msg = { title: "The Office", body: "", url: "/office" };
  try { msg = { ...msg, ...event.data.json() }; } catch { if (event.data) msg.body = event.data.text(); }
  const url = typeof msg.url === "string" && msg.url.startsWith("/office") ? msg.url : "/office";
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag, data: { url }, icon: "/office-icons/icon-192.png", badge: "/office-icons/badge-96.png",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/office", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if (w.url.startsWith(self.location.origin + "/office")) { await w.focus(); return w.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
