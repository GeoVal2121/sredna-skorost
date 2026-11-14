// Safari toolbars and the keyboard change the visible area without a window resize.
(function () {
  "use strict";
  var viewport = window.visualViewport, frame = document.getElementById("viewport");
  if (!viewport) return; // CSS dynamic viewport units remain the fallback.
  function fit() {
    // Preserve native pinch zoom instead of shrinking the interface while zoomed.
    if (viewport.scale !== 1) return;
    frame.style.height = viewport.height + "px";
    frame.style.width = viewport.width + "px";
    frame.style.top = viewport.offsetTop + "px";
    frame.style.left = viewport.offsetLeft + "px";
  }
  viewport.addEventListener("resize", fit);
  viewport.addEventListener("scroll", fit);
  window.addEventListener("pageshow", fit);
  fit();
}());
