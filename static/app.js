/* Small progressive enhancements. Every page works without this file. */
(function () {
  "use strict";
  var body = document.body;

  // --- mobile navigation drawer
  var menu = document.getElementById("menu-btn");
  var scrim = document.getElementById("scrim");
  if (menu) { menu.addEventListener("click", function () { body.classList.toggle("nav-open"); }); }
  if (scrim) { scrim.addEventListener("click", function () { body.classList.remove("nav-open"); }); }

  // --- dates: quick buttons such as 今天 / 明天 / 3 天后
  function iso(d) {
    var m = String(d.getMonth() + 1), day = String(d.getDate());
    return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (day.length < 2 ? "0" + day : day);
  }
  function serverToday() {
    var parts = (body.getAttribute("data-today") || "").split("-");
    if (parts.length === 3) { return new Date(+parts[0], +parts[1] - 1, +parts[2]); }
    return new Date();
  }
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target.closest("[data-set-date]") : null;
    if (!t) { return; }
    var input = document.getElementById(t.getAttribute("data-set-date"));
    if (!input) { return; }
    var d = serverToday();
    var add = t.getAttribute("data-days");
    if (add === "mon") { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); }
    else { d.setDate(d.getDate() + parseInt(add || "0", 10)); }
    input.value = iso(d);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    ev.preventDefault();
  });

  // --- copy to clipboard
  function copyText(text, done) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { legacy(text, done); });
    } else { legacy(text, done); }
  }
  function legacy(text, done) {   // plain http on a LAN is not a "secure context"
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "0"; ta.style.left = "0"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignore */ }
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) { done(); } else { window.prompt("长按或 Ctrl+C 复制：", text); }
  }
  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest("[data-copy]") : null;
    if (!btn) { return; }
    var src = document.getElementById(btn.getAttribute("data-copy"));
    if (!src) { return; }
    var text = src.value !== undefined && src.tagName !== "DIV" && src.tagName !== "PRE" ? src.value : src.textContent;
    var label = btn.textContent;
    copyText(text.replace(/\u00a0/g, " ").trim(), function () {
      btn.classList.add("copied"); btn.textContent = "已复制";
      window.setTimeout(function () { btn.classList.remove("copied"); btn.textContent = label; }, 1600);
    });
    ev.preventDefault();
  });

  // --- confirmations for destructive actions, and no double submission from a double click
  document.addEventListener("submit", function (ev) {
    var form = ev.target;
    if (form.getAttribute("data-sent")) { ev.preventDefault(); return; }
    var msg = form.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) { ev.preventDefault(); return; }
    form.setAttribute("data-sent", "1");
    window.setTimeout(function () { form.removeAttribute("data-sent"); }, 4000);   // in case the page stays
  });

  // --- filters that apply as soon as a choice changes
  document.addEventListener("change", function (ev) {
    if (ev.target.hasAttribute && ev.target.hasAttribute("data-autosubmit") && ev.target.form) { ev.target.form.submit(); }
  });

  // --- show a block only when a select has a given value: data-show-when="selectId=value1|value2"
  function syncShow() {
    var nodes = document.querySelectorAll("[data-show-when]");
    for (var i = 0; i < nodes.length; i++) {
      var rule = nodes[i].getAttribute("data-show-when").split("=");
      var src = document.getElementById(rule[0]);
      if (!src) { continue; }
      var val = src.type === "checkbox" ? (src.checked ? "1" : "0") : src.value;
      if (src.type === "radio") {
        var picked = document.querySelector('input[name="' + src.name + '"]:checked');
        val = picked ? picked.value : "";
      }
      nodes[i].classList.toggle("hidden", rule[1].split("|").indexOf(val) === -1);
    }
  }
  document.addEventListener("change", syncShow);
  syncShow();

  // --- print
  document.addEventListener("click", function (ev) {
    if (ev.target.closest && ev.target.closest("[data-print]")) { window.print(); ev.preventDefault(); }
  });
})();
