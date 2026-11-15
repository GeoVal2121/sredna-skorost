(function () {
  "use strict";
  var buttons = Array.from(document.querySelectorAll("[data-install]"));
  var help = document.getElementById("installHelp"), text = document.getElementById("installSteps");
  var standalone = window.matchMedia("(display-mode: standalone)");
  var pending = null, installed = false, busy = false;
  function render() {
    buttons.forEach(function (button) {
      button.hidden = installed || standalone.matches || navigator.standalone === true;
      button.disabled = busy;
    });
  }
  function instructions() {
    var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    text.textContent = ios
      ? "Отвори сайта в Safari. От менюто „Споделяне“ избери „Добавяне към началния екран“, включи „Отваряне като уеб приложение“, ако се показва, и натисни „Добавяне“."
      : /Android/.test(navigator.userAgent)
        ? "В Chrome отвори менюто ⋮ и избери „Добавяне към началния екран“ или „Инсталиране на приложението“, ако се показва. Ако си отворил линка в друго приложение, първо го отвори в Chrome."
        : "Потърси „Инсталиране на приложението“ в менюто или адресната лента на браузъра. Ако липсва, отвори сайта в Chrome или Edge.";
    if (!help.open) help.showModal();
  }
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault(); pending = event; render();
  });
  window.addEventListener("appinstalled", function () {
    installed = true; pending = null; if (help.open) help.close(); render();
  });
  if (standalone.addEventListener) standalone.addEventListener("change", render);
  buttons.forEach(function (button) {
    button.addEventListener("click", async function () {
      if (busy || installed || standalone.matches || navigator.standalone === true) return;
      if (!pending) { instructions(); return; }
      var event = pending; pending = null; busy = true; render();
      try {
        await event.prompt();
        var choice = await event.userChoice;
        if (choice.outcome === "accepted") { installed = true; if (help.open) help.close(); }
      } catch (error) { if (!installed) instructions(); }
      finally { busy = false; render(); }
    });
  });
  render();
}());
