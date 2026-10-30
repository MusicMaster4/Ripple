import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/** Blend against the rendered page, including canvas waves and light buttons. */
export function DotCursor({ playing }: { playing: boolean }) {
  const cursor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Clear native cursor URLs left by the previous implementation during HMR.
    document.documentElement.style.removeProperty("--cursor");
    document.documentElement.style.removeProperty("--cursor-hover");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const hide = () => {
      if (cursor.current) cursor.current.style.visibility = "hidden";
      document.documentElement.classList.remove("has-dot-cursor");
    };
    const move = (event: PointerEvent) => {
      const dot = cursor.current;
      if (!dot || !finePointer.matches || event.pointerType === "touch") {
        hide();
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) {
        hide();
        return;
      }
      document.documentElement.classList.add("has-dot-cursor");
      dot.style.visibility = "visible";
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
      dot.classList.toggle(
        "is-hovering",
        !!target?.closest("button:not(:disabled), a, summary"),
      );
    };
    window.addEventListener("pointermove", move);
    document.documentElement.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    finePointer.addEventListener("change", hide);
    return () => {
      hide();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      finePointer.removeEventListener("change", hide);
    };
  }, []);

  return createPortal(
    <div
      ref={cursor}
      className={`dot-cursor${playing ? " is-playing" : ""}`}
      aria-hidden="true"
    />,
    document.body,
  );
}
