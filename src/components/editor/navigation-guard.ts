"use client";
import { useEffect, useRef } from "react";

/** No draft text is stored in history or browser storage. */
export function useNavigationGuard(blocked: boolean, inFlight: boolean, onLeave: () => void) {
  const state = useRef({ blocked, inFlight, onLeave });
  const allowed = useRef(false);
  state.current = { blocked, inFlight, onLeave };
  function allow() { allowed.current = true; state.current.onLeave(); }
  function canLeave() {
    if (allowed.current || !state.current.blocked) return true;
    if (state.current.inFlight) {
      window.alert("A request is still in progress. Wait for it to finish before leaving so its result is not lost.");
      return false;
    }
    return window.confirm("Leave this draft and discard your unsaved changes? Your local text has not been saved.");
  }
  useEffect(() => {
    const currentUrl = window.location.href;
    const currentHistory = window.history.state;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (state.current.blocked && !allowed.current) { event.preventDefault(); event.returnValue = ""; }
    };
    const click = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.download || link.getAttribute("href")?.startsWith("#") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!canLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
      else if (state.current.blocked) allow();
    };
    const submit = (event: SubmitEvent) => {
      if (!canLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
      else if (state.current.blocked) allow();
    };
    const pop = (event: PopStateEvent) => {
      if (!canLeave()) {
        event.stopImmediatePropagation();
        window.history.pushState(currentHistory, "", currentUrl);
      } else if (state.current.blocked) allow();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", pop, true);
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", pop, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
    };
  }, []);
  return { canLeave, allow };
}
