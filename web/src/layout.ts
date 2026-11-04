// A narrow desktop window is compact too; the touch clause covers phone landscape.
export const compactViewport = window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1100px)');
export const compactClient = () => compactViewport.matches;

// Keep the app within Safari's visible viewport when the keyboard opens.
let viewportFrame = 0;
function updateVisibleViewport() {
  cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    const viewport = window.visualViewport;
    if (compactClient() && viewport && viewport.scale === 1) {
      document.documentElement.style.setProperty('--compact-height', `${viewport.height}px`);
      document.documentElement.style.setProperty('--compact-top', `${viewport.offsetTop}px`);
    } else {
      document.documentElement.style.removeProperty('--compact-height');
      document.documentElement.style.removeProperty('--compact-top');
    }
  });
}
window.visualViewport?.addEventListener('resize', updateVisibleViewport);
window.visualViewport?.addEventListener('scroll', updateVisibleViewport);
compactViewport.addEventListener('change', updateVisibleViewport);
updateVisibleViewport();
