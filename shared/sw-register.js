// Registers the cache worker for this site, whatever depth the page sits at:
// the worker lives at the site root and takes over from there.
//
// Failures are ignored on purpose. Without a worker the pages load exactly as
// they did before; with one, repeat visits come off the disk cache.

if ("serviceWorker" in navigator) {
  const workerUrl = new URL("../sw.js", import.meta.url);
  const scope = new URL("../", import.meta.url);
  const register = () => {
    navigator.serviceWorker.register(workerUrl, { scope: scope.pathname }).catch(() => {});
  };
  if (document.readyState === "complete") register();
  else addEventListener("load", register, { once: true });
}
