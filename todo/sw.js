self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification("Works ToDo", {
      body: data.title || "タスクの予定時刻です",
      tag: data.tag || "todo",
      icon: "/logo.png",
      data: { id: String(data.id || "") },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/todo/", self.location.origin);
  if (event.notification.data?.id)
    target.searchParams.set("task", event.notification.data.id);
  event.waitUntil(clients.openWindow(target.href));
});
