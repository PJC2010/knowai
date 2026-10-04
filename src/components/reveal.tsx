"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Content is visible until JavaScript opts below-the-fold sections into motion. */
export function ScrollReveals() {
  const pathname = usePathname();

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches || !("IntersectionObserver" in window)) return;

    const elements = new Set<HTMLElement>();
    const reveal = (element: HTMLElement) => {
      element.classList.add("is-revealed");
      observer.unobserve(element);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target as HTMLElement);
      }
    });

    // Let route scrolling finish before deciding which sections are below fold.
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelectorAll<HTMLElement>("[data-reveal]")
        .forEach((element) => {
          elements.add(element);
          if (element.getBoundingClientRect().top < window.innerHeight) {
            element.classList.add("is-revealed");
            return;
          }
          element.classList.add("reveal-ready");
          observer.observe(element);
        });
    });

    const showForReducedMotion = () => {
      if (reducedMotion.matches) elements.forEach(reveal);
    };
    const showFocusedContent = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const section = event.target.closest<HTMLElement>(".reveal-ready");
      if (section) reveal(section);
    };
    reducedMotion.addEventListener("change", showForReducedMotion);
    document.addEventListener("focusin", showFocusedContent);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      reducedMotion.removeEventListener("change", showForReducedMotion);
      document.removeEventListener("focusin", showFocusedContent);
      elements.forEach((element) => {
        element.classList.remove("reveal-ready", "is-revealed");
      });
    };
  }, [pathname]);

  return null;
}
