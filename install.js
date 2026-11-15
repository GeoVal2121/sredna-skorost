(function () {
  "use strict";
  var buttons = Array.from(document.querySelectorAll("[data-install]"));
  var help = document.getElementById("installHelp"), text = document.getElementById("installSteps");
  var handoff = document.getElementById("installHandoff"), copy = document.getElementById("installCopy"), link = document.getElementById("installLink");
  var appUrl = "https://sredna-skorost.netlify.app/";
  copy.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(appUrl);
      copy.textContent = "Копирано — отвори Safari";
    } catch (error) {
      link.value = appUrl; link.hidden = false; link.focus(); link.select();
      copy.textContent = "Задръж върху линка и го копирай";
    }
  });
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
    handoff.hidden = !ios;
    document.getElementById("installSafari").open = !ios;
    document.getElementById("installSafariTitle").hidden = !ios;
    link.hidden = true; copy.textContent = "Копирай линка за Safari";
    text.textContent = ios
      ? "В Safari:\n1. Натисни „Споделяне“ (квадрат със стрелка ↑).\n2. Избери „Добавяне към началния екран“.\n3. Натисни „Добавяне“.\n\nАко има „Отваряне като уеб приложение“, остави го включено."
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
