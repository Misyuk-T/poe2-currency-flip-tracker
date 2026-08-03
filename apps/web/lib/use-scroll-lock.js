import { useEffect } from "react";

/**
 * Freeze background scrolling while a modal is open.
 *
 * Setting `overflow: hidden` on <body> alone is NOT enough here: this page
 * scrolls on the document element, so <body> happily clips its own box while
 * the viewport keeps scrolling behind the modal. Both elements have to be
 * locked.
 *
 * The scrollbar's width is added back as padding so the page doesn't visibly
 * jump sideways when its scrollbar disappears.
 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active) return undefined;
    const { body } = document;
    const html = document.documentElement;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
    };
    // Measure the actual layout box, not `innerWidth - clientWidth`.
    // `scrollbar-gutter: stable` keeps the old layout width after the native
    // scrollbar disappears even though `clientWidth` grows. Using clientWidth
    // in that case adds a second gutter and squeezes the whole page sideways.
    const layoutWidth = html.getBoundingClientRect().width;
    const bodyPaddingRight = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    const releasedWidth = Math.max(0, html.getBoundingClientRect().width - layoutWidth);
    if (releasedWidth > 0) body.style.paddingRight = `${bodyPaddingRight + releasedWidth}px`;

    return () => {
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.paddingRight = previous.bodyPaddingRight;
    };
  }, [active]);
}
