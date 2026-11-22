/* Ticketing prototype (event pages, checkout, My tickets).
 * Everything here runs in the browser and stores orders in localStorage under
 * "mdv-orders". In the live site the same flows call a backend and a payment
 * provider; the data shapes below are meant to carry over.
 */
(function () {
  "use strict";

  var ORDERS_KEY = "mdv-orders";
  var FEE_PERCENT = 3; // booking fee, % of the order after discounts
  var HOLD_MINUTES = 10;
  var PROMOS = {};
  var QR_SRC = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
  var LIVE = ["paid", "refund_requested", "confirmed"];
  var RATES = { USD: 1 }; // units of each currency per US dollar
  var CURRENCY = "KES";
  var BRAND = "MDV";

  // Everything below comes from the desk's site settings (#site-settings).
  try {
    var cfg = JSON.parse(document.getElementById("site-settings").textContent);
    if (typeof cfg.feePercent === "number") FEE_PERCENT = cfg.feePercent;
    if (cfg.hold) HOLD_MINUTES = cfg.hold;
    if (cfg.promos) PROMOS = cfg.promos;
    if (cfg.rates) RATES = cfg.rates;
    if (cfg.currency) CURRENCY = cfg.currency;
    if (cfg.brand) BRAND = cfg.brand;
  } catch (e) {}
  var CODE_PREFIX = (BRAND.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "TIX").slice(0, 5);

  var root = document.body.getAttribute("data-root") || "";

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function money(n, cur) {
    return (cur || CURRENCY) + " " + Math.round(n || 0).toLocaleString("en-US");
  }

  function usdText(n, cur) {
    cur = cur || CURRENCY;
    if (!n || cur === "USD" || !RATES[cur]) return "";
    return "≈ USD " + Math.max(1, Math.round(n / RATES[cur])).toLocaleString("en-US");
  }

  function catalog() {
    var node = document.getElementById("site-catalog");
    try {
      var list = JSON.parse(node ? node.textContent : "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  var EVENTS = catalog();

  function eventBy(slug) {
    for (var i = 0; i < EVENTS.length; i += 1) if (EVENTS[i].slug === slug) return EVENTS[i];
    return null;
  }

  function typeBy(ev, id) {
    for (var i = 0; i < ev.types.length; i += 1) if (ev.types[i].id === id) return ev.types[i];
    return null;
  }

  function readOrders() {
    try {
      var list = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function writeOrders(list) {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(list));
  }

  function updateOrder(id, change) {
    var list = readOrders();
    list.forEach(function (order) {
      if (order.id === id) change(order);
    });
    writeOrders(list);
  }

  function rand(chars, n) {
    var out = "";
    var bytes = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    for (var i = 0; i < n; i += 1) out += chars[bytes[i] % chars.length];
    return out;
  }

  function ticketCode() {
    var c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return CODE_PREFIX + "-" + rand(c, 4) + "-" + rand(c, 4);
  }

  function orderId() {
    return CODE_PREFIX + rand("0123456789", 6);
  }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function statusLabel(s) {
    return {
      paid: "Paid",
      refund_requested: "Refund requested",
      refunded: "Refunded",
      pending: "Pending",
      confirmed: "Confirmed",
      declined: "Declined",
      cancelled: "Cancelled",
      waiting: "Waiting",
      offered: "Seat offered"
    }[s] || s;
  }

  function isLive(order) {
    return LIVE.indexOf(order.status) !== -1;
  }

  /* ---------- inventory ---------- */

  function soldByType(slug) {
    var sold = {};
    readOrders().forEach(function (order) {
      if (order.slug !== slug || order.kind !== "order" || !isLive(order)) return;
      order.lines.forEach(function (line) {
        sold[line.type] = (sold[line.type] || 0) + line.qty;
      });
    });
    return sold;
  }

  function seatsLeft(ev) {
    var sold = soldByType(ev.slug);
    var used = 0;
    ev.types.forEach(function (t) {
      if (t.seat) used += sold[t.id] || 0;
    });
    return Math.max(0, ev.pool - used);
  }

  function typeLeft(ev, t) {
    var sold = soldByType(ev.slug)[t.id] || 0;
    var left = t.seat ? seatsLeft(ev) : 999;
    if (typeof t.limit === "number") left = Math.min(left, Math.max(0, t.limit - sold));
    return left;
  }

  /* ---------- QR codes ---------- */

  var qrWaiters = null;

  function withQR(cb) {
    if (window.qrcode) return cb(true);
    if (qrWaiters) return qrWaiters.push(cb);
    qrWaiters = [cb];
    var s = document.createElement("script");
    s.src = QR_SRC;
    s.onload = function () {
      qrWaiters.forEach(function (fn) { fn(true); });
    };
    s.onerror = function () {
      qrWaiters.forEach(function (fn) { fn(false); });
    };
    document.head.appendChild(s);
  }

  function paintQR(box, text) {
    withQR(function (ok) {
      if (ok && window.qrcode) {
        var qr = window.qrcode(0, "M");
        qr.addData(text);
        qr.make();
        box.innerHTML = qr.createSvgTag(4, 2);
        var svg = box.querySelector("svg");
        if (svg) {
          svg.setAttribute("role", "img");
          svg.setAttribute("aria-label", "QR code for ticket " + text);
        }
      } else {
        box.textContent = text;
        box.classList.add("qr-fallback");
      }
    });
  }

  /* ---------- calendar ---------- */

  function icsStamp(iso) {
    return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  function icsEscape(v) {
    return String(v).replace(/\\/g, "\\\\").replace(/[,;]/g, function (m) { return "\\" + m; }).replace(/\n/g, "\\n");
  }

  function downloadICS(ev, order) {
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//" + BRAND + "//Tickets//EN",
      "BEGIN:VEVENT",
      "UID:" + order.id + "@mdv.example",
      "DTSTAMP:" + icsStamp(new Date().toISOString()),
      "DTSTART:" + icsStamp(ev.start),
      "DTEND:" + icsStamp(ev.end || ev.start),
      "SUMMARY:" + icsEscape(ev.title),
      "LOCATION:" + icsEscape(ev.address || ev.place),
      "DESCRIPTION:" + icsEscape("Order " + order.id + ". Tickets: " + location.origin + location.pathname.replace(/[^/]*$/, "") + "tickets.html"),
      "END:VEVENT",
      "END:VCALENDAR"
    ];
    download(ev.slug + ".ics", lines.join("\r\n"), "text/calendar");
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  /* ---------- ticket card ---------- */

  function ticketCard(order, ticket) {
    var ev = eventBy(order.slug) || { title: order.title, dates: "", place: "" };
    var card = el("article", "ticket-card");
    var void_ = !isLive(order);
    if (void_) card.classList.add("is-void");
    var info = el("div", "tc-info");
    info.appendChild(el("p", "kind", order.kind === "rsvp" ? "Invitation" : ticket.label));
    info.appendChild(el("h3", "", ev.title));
    info.appendChild(el("p", "meta", ev.dates + " · " + ev.place));
    info.appendChild(el("p", "tc-holder", ticket.holder));
    info.appendChild(el("p", "tc-code", ticket.code));
    var flag = "";
    if (void_) flag = statusLabel(order.status) + ". Not valid for entry.";
    else if (ticket.checkedIn) flag = "Used " + fmtDateTime(ticket.checkedIn);
    if (flag) info.appendChild(el("p", "tc-flag", flag));
    var qr = el("div", "qr");
    card.appendChild(info);
    card.appendChild(qr);
    paintQR(qr, ticket.code);
    return card;
  }

  /* ---------- picker (event page and checkout) ---------- */

  function makePicker(container, ev, qty, onChange) {
    container.textContent = "";
    var rows = {};
    ev.types.forEach(function (t) {
      var row = el("div", "tt-row");
      var info = el("div", "tt-info");
      info.appendChild(el("strong", "", t.label));
      if (t.note) info.appendChild(el("span", "tt-note", t.note));
      var left = el("span", "tt-left");
      info.appendChild(left);
      var side = el("div", "tt-side");
      side.appendChild(el("span", "tt-price", money(t.price, ev.currency)));
      var box = el("div", "qty");
      var minus = el("button", "", "−");
      minus.type = "button";
      minus.setAttribute("aria-label", "Fewer " + t.label);
      var out = el("output", "", "0");
      var plus = el("button", "", "+");
      plus.type = "button";
      plus.setAttribute("aria-label", "More " + t.label);
      box.appendChild(minus);
      box.appendChild(out);
      box.appendChild(plus);
      side.appendChild(box);
      row.appendChild(info);
      row.appendChild(side);
      container.appendChild(row);
      rows[t.id] = { row: row, left: left, out: out, minus: minus, plus: plus, t: t };
      minus.addEventListener("click", function () {
        if ((qty[t.id] || 0) > 0) qty[t.id] -= 1;
        // add-ons cannot outnumber seats
        clampAddons(ev, qty);
        paint();
      });
      plus.addEventListener("click", function () {
        if (canAdd(ev, qty, t)) qty[t.id] = (qty[t.id] || 0) + 1;
        paint();
      });
    });

    function paint() {
      ev.types.forEach(function (t) {
        var r = rows[t.id];
        var left = typeLeft(ev, t);
        var n = qty[t.id] || 0;
        r.out.textContent = String(n);
        r.minus.disabled = n === 0;
        r.plus.disabled = !canAdd(ev, qty, t);
        r.row.classList.toggle("is-out", left === 0);
        r.left.classList.toggle("is-note", !t.seat && left > 0);
        if (left === 0) r.left.textContent = t.seat ? "Sold out" : "None left";
        else if (!t.seat) r.left.textContent = "One per ticket";
        else if (left <= 5) r.left.textContent = "Only " + left + " left";
        else r.left.textContent = "";
      });
      onChange();
    }

    paint();
    return paint;
  }

  function seatCount(ev, qty) {
    var n = 0;
    ev.types.forEach(function (t) {
      if (t.seat) n += qty[t.id] || 0;
    });
    return n;
  }

  function canAdd(ev, qty, t) {
    var n = qty[t.id] || 0;
    if (n + 1 > typeLeft(ev, t)) return false;
    if (t.seat) {
      if (seatCount(ev, qty) + 1 > Math.min(ev.max || 6, seatsLeft(ev))) return false;
    } else if (n + 1 > seatCount(ev, qty)) {
      return false;
    }
    return true;
  }

  function clampAddons(ev, qty) {
    var seats = seatCount(ev, qty);
    ev.types.forEach(function (t) {
      if (!t.seat && (qty[t.id] || 0) > seats) qty[t.id] = seats;
    });
  }

  function priceOf(ev, qty, promo) {
    var lines = [];
    var sub = 0;
    ev.types.forEach(function (t) {
      var n = qty[t.id] || 0;
      if (!n) return;
      lines.push({ type: t.id, label: t.label, qty: n, price: t.price, seat: !!t.seat });
      sub += n * t.price;
    });
    var discount = promo && PROMOS[promo] ? Math.round(sub * PROMOS[promo]) : 0;
    var fee = Math.round((sub - discount) * FEE_PERCENT / 100);
    return { lines: lines, sub: sub, discount: discount, fee: fee, total: sub - discount + fee, cur: ev.currency || CURRENCY };
  }

  function qtyToParam(qty) {
    return Object.keys(qty).filter(function (k) { return qty[k] > 0; }).map(function (k) { return k + ":" + qty[k]; }).join(",");
  }

  function paramToQty(ev, text) {
    var qty = {};
    (text || "").split(",").forEach(function (pair) {
      var bits = pair.split(":");
      var t = typeBy(ev, bits[0]);
      var n = parseInt(bits[1], 10);
      if (t && n > 0) qty[t.id] = n;
    });
    // trim to what is actually available
    var trimmed = {};
    ev.types.forEach(function (t) {
      for (var i = 0; i < (qty[t.id] || 0); i += 1) {
        if (canAdd(ev, trimmed, t)) trimmed[t.id] = (trimmed[t.id] || 0) + 1;
      }
    });
    return trimmed;
  }

  /* ---------- live seat lines on public pages ---------- */

  function paintLiveState() {
    EVENTS.forEach(function (ev) {
      if (ev.mode !== "site") return;
      var left = seatsLeft(ev);
      var state = left === 0 ? "Sold out" : left <= 12 ? "Limited" : "On sale";
      var text = left === 0 ? "Sold out" : left + " seats left";
      var nodes = document.querySelectorAll('[data-live-state="' + ev.slug + '"], [data-event][data-slug="' + ev.slug + '"] .card-foot .state');
      Array.prototype.forEach.call(nodes, function (node) {
        node.textContent = text;
        node.setAttribute("data-state", state);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-waitlist-count]"), function (node) {
      var slug = node.getAttribute("data-waitlist-count");
      var n = readOrders().filter(function (o) { return o.slug === slug && o.kind === "waitlist" && o.status === "waiting"; }).length;
      node.textContent = n ? n + (n === 1 ? " person is" : " people are") + " on the waitlist." : "";
    });
  }

  /* ---------- event page ---------- */

  function initEventPage() {
    var picker = document.querySelector("[data-ticket-picker]");
    if (picker) {
      var ev = eventBy(picker.getAttribute("data-slug"));
      if (ev) {
        var qty = {};
        var total = document.querySelector("[data-tt-total]");
        var go = document.querySelector("[data-checkout]");
        makePicker(picker, ev, qty, function () {
          var p = priceOf(ev, qty, "");
          total.textContent = money(p.sub, p.cur);
          var seats = seatCount(ev, qty);
          go.href = root + "checkout.html?event=" + ev.slug + (seats ? "&t=" + qtyToParam(qty) : "");
          go.classList.toggle("is-off", seats === 0);
          go.setAttribute("aria-disabled", seats === 0 ? "true" : "false");
          go.textContent = seats === 0 ? (seatsLeft(ev) === 0 ? "Sold out" : "Choose tickets") : "Checkout · " + seats + (seats === 1 ? " ticket" : " tickets");
        });
        go.addEventListener("click", function (e) {
          if (go.getAttribute("aria-disabled") === "true") e.preventDefault();
        });
      }
    }

    document.addEventListener("click", function (e) {
      var open = e.target.closest("[data-dialog-open]");
      if (open) {
        var dlg = document.getElementById(open.getAttribute("data-dialog-open"));
        if (dlg && dlg.showModal) dlg.showModal();
        return;
      }
      var close = e.target.closest("[data-dialog-close]");
      if (close) {
        var parent = close.closest("dialog");
        if (parent) parent.close();
      }
    });

    var rsvp = document.querySelector("[data-rsvp-form]");
    if (rsvp) {
      rsvp.addEventListener("submit", function (e) {
        e.preventDefault();
        var ev = eventBy(rsvp.getAttribute("data-slug"));
        var err = rsvp.querySelector(".form-error");
        var name = rsvp.name.value.trim();
        var email = rsvp.email.value.trim().toLowerCase();
        var code = rsvp.code ? rsvp.code.value.trim().toUpperCase() : "";
        var msg = "";
        if (!name) msg = "Enter your name.";
        else if (!validEmail(email)) msg = "Enter a valid email.";
        else if (ev.invite && code !== String(ev.invite).toUpperCase()) msg = "That code does not match the invitation. Check it, or write to the organizer.";
        else if (readOrders().some(function (o) { return o.slug === ev.slug && o.kind === "rsvp" && o.buyer.email === email && isLive(o); })) msg = "This email has already confirmed a place.";
        if (msg) {
          err.textContent = msg;
          err.hidden = false;
          return;
        }
        var order = {
          id: orderId(),
          kind: "rsvp",
          slug: ev.slug,
          title: ev.title,
          status: "confirmed",
          created: new Date().toISOString(),
          buyer: { name: name, email: email, phone: "" },
          lines: [{ type: "invite", label: "Invitation", qty: 1, price: 0, seat: true }],
          total: 0,
          answers: { note: rsvp.note.value.trim() },
          tickets: [{ code: ticketCode(), holder: name, type: "invite", label: "Invitation", checkedIn: null }]
        };
        var list = readOrders();
        list.push(order);
        writeOrders(list);
        rsvp.textContent = "";
        rsvp.appendChild(el("p", "kind", "Confirmed"));
        rsvp.appendChild(el("h2", "", "Your place is confirmed"));
        rsvp.appendChild(el("p", "", "A confirmation would be emailed to " + email + ". Your pass is in My tickets."));
        var actions = el("div", "admin-actions");
        var link = el("a", "btn signal", "Open My tickets");
        link.href = root + "tickets.html";
        actions.appendChild(link);
        rsvp.appendChild(actions);
        rsvp.appendChild(ticketCard(order, order.tickets[0]));
      });
    }

    var wait = document.querySelector("[data-waitlist-form]");
    if (wait) {
      wait.addEventListener("submit", function (e) {
        e.preventDefault();
        var ev = eventBy(wait.getAttribute("data-slug"));
        var err = wait.querySelector(".form-error");
        var name = wait.name.value.trim();
        var email = wait.email.value.trim().toLowerCase();
        var existing = readOrders().filter(function (o) { return o.slug === ev.slug && o.kind === "waitlist" && o.status === "waiting"; });
        var msg = !name ? "Enter your name." : !validEmail(email) ? "Enter a valid email." : existing.some(function (o) { return o.buyer.email === email; }) ? "This email is already on the waitlist." : "";
        if (msg) {
          err.textContent = msg;
          err.hidden = false;
          return;
        }
        var qty = parseInt(wait.qty.value, 10) || 1;
        var list = readOrders();
        list.push({
          id: orderId(),
          kind: "waitlist",
          slug: ev.slug,
          title: ev.title,
          status: "waiting",
          created: new Date().toISOString(),
          buyer: { name: name, email: email, phone: "" },
          lines: [{ type: "waitlist", label: "Seats wanted", qty: qty, price: 0, seat: true }],
          total: 0,
          answers: {},
          tickets: []
        });
        writeOrders(list);
        wait.textContent = "";
        wait.appendChild(el("p", "kind", "Waitlist"));
        wait.appendChild(el("h2", "", "You’re number " + (existing.length + 1) + " on the list"));
        wait.appendChild(el("p", "", "If a seat comes back, " + BRAND + " emails " + email + " with a link that holds it for 24 hours."));
        var done = el("button", "btn quiet", "Close");
        done.type = "button";
        done.setAttribute("data-dialog-close", "");
        wait.appendChild(done);
        paintLiveState();
      });
    }
  }

  /* ---------- checkout ---------- */

  function initCheckout() {
    var app = document.querySelector("[data-checkout-app]");
    if (!app) return;
    var params = new URLSearchParams(location.search);
    var ev = eventBy(params.get("event") || "");
    var steps = app.querySelectorAll("[data-step]");
    var labels = app.querySelectorAll("[data-step-label]");

    function show(n) {
      Array.prototype.forEach.call(steps, function (s) {
        s.hidden = s.getAttribute("data-step") !== String(n);
      });
      Array.prototype.forEach.call(labels, function (l) {
        var k = parseInt(l.getAttribute("data-step-label"), 10);
        l.classList.toggle("is-active", k === n);
        l.classList.toggle("is-done", k < n);
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (!ev || ev.mode !== "site" || seatsLeft(ev) === 0) {
      app.querySelector("[data-summary]").hidden = true;
      app.querySelector("[data-steps]").hidden = true;
      show(0);
      return;
    }

    var qty = paramToQty(ev, params.get("t"));
    var promo = "";
    var holdEnd = 0;
    var holdTimer = null;
    var current = 1;

    function error(step, msg) {
      var node = app.querySelector('[data-error="' + step + '"]');
      node.textContent = msg || "";
      node.hidden = !msg;
    }

    function paintSummary() {
      var p = priceOf(ev, qty, promo);
      app.querySelector("[data-sum-title]").textContent = ev.title;
      app.querySelector("[data-sum-meta]").textContent = ev.dates + " · " + ev.place;
      var ul = app.querySelector("[data-sum-lines]");
      ul.textContent = "";
      if (!p.lines.length) ul.appendChild(el("li", "meta", "No tickets chosen yet."));
      p.lines.forEach(function (line) {
        var li = el("li");
        li.appendChild(el("span", "", line.qty + " × " + line.label));
        li.appendChild(el("span", "", money(line.qty * line.price, p.cur)));
        ul.appendChild(li);
      });
      app.querySelector("[data-sum-sub]").textContent = money(p.sub, p.cur);
      app.querySelector("[data-sum-discount-row]").hidden = !p.discount;
      app.querySelector("[data-sum-discount]").textContent = "− " + money(p.discount, p.cur) + " (" + promo + ")";
      app.querySelector("[data-sum-fee]").textContent = money(p.fee, p.cur);
      app.querySelector("[data-sum-total]").textContent = money(p.total, p.cur);
      var usdNode = app.querySelector("[data-sum-usd]");
      if (usdNode) usdNode.textContent = usdText(p.total, p.cur);
      var payBtn = app.querySelector("[data-pay-button]");
      if (payBtn && !payBtn.disabled) payBtn.textContent = "Pay " + money(p.total, p.cur);
      return p;
    }

    var repaint = makePicker(app.querySelector("[data-co-picker]"), ev, qty, paintSummary);

    app.querySelector("[data-promo-apply]").addEventListener("click", function () {
      var code = app.querySelector("[data-promo]").value.trim().toUpperCase();
      var note = app.querySelector("[data-promo-note]");
      if (!code) {
        promo = "";
        note.textContent = "";
      } else if (PROMOS[code]) {
        promo = code;
        note.textContent = code + " applied: " + Math.round(PROMOS[code] * 100) + "% off tickets.";
      } else {
        promo = "";
        note.textContent = "That code is not valid for this event.";
      }
      paintSummary();
    });

    function startHold() {
      if (holdEnd && Date.now() < holdEnd) return;
      holdEnd = Date.now() + HOLD_MINUTES * 60000;
      clearInterval(holdTimer);
      holdTimer = setInterval(tickHold, 1000);
      tickHold();
    }

    function tickHold() {
      var ms = holdEnd - Date.now();
      if (ms <= 0) {
        clearInterval(holdTimer);
        holdEnd = 0;
        show(1);
        current = 1;
        repaint();
        error(1, "Your " + HOLD_MINUTES + "-minute hold ran out and the seats went back on sale. Check the tickets and continue again.");
        return;
      }
      var m = Math.floor(ms / 60000);
      var s = Math.floor((ms % 60000) / 1000);
      Array.prototype.forEach.call(app.querySelectorAll(".hold"), function (node) {
        var warn = ms < 120000;
        if (warn && !node.classList.contains("is-warn")) node.setAttribute("role", "alert");
        node.classList.toggle("is-warn", warn);
      });
      Array.prototype.forEach.call(app.querySelectorAll("[data-hold-timer]"), function (node) {
        node.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      });
    }

    function buildHolders() {
      var box = app.querySelector("[data-holders]");
      var previous = {};
      Array.prototype.forEach.call(box.querySelectorAll("input"), function (input) {
        previous[input.name] = input.value;
      });
      box.textContent = "";
      var i = 0;
      ev.types.forEach(function (t) {
        if (!t.seat) return;
        for (var k = 0; k < (qty[t.id] || 0); k += 1) {
          i += 1;
          var label = el("label", "field");
          label.appendChild(el("span", "", "Ticket " + i + " · " + t.label));
          var input = el("input", "search");
          input.name = "holder-" + i;
          input.setAttribute("data-type", t.id);
          input.placeholder = "Name on the ticket";
          input.value = previous[input.name] || "";
          label.appendChild(input);
          box.appendChild(label);
        }
      });
      var qbox = app.querySelector("[data-questions]");
      if (!qbox.childNodes.length && ev.questions && ev.questions.length) {
        qbox.appendChild(el("h2", "", "For the organizer"));
        ev.questions.forEach(function (q) {
          var label = el("label", "field");
          label.appendChild(el("span", "", q.label));
          var input = el("input", "search");
          input.name = "q-" + q.id;
          input.maxLength = 140;
          label.appendChild(input);
          qbox.appendChild(label);
        });
      }
    }

    app.addEventListener("click", function (e) {
      var next = e.target.closest("[data-next]");
      var back = e.target.closest("[data-back]");
      if (back) {
        current = parseInt(back.getAttribute("data-back"), 10);
        show(current);
        return;
      }
      if (!next) return;
      var to = parseInt(next.getAttribute("data-next"), 10);
      if (to === 2) {
        if (!seatCount(ev, qty)) return error(1, "Choose at least one ticket.");
        error(1, "");
        buildHolders();
        startHold();
      }
      if (to === 3) {
        var f = app.querySelector("[data-details]");
        var msg = "";
        if (!f.name.value.trim()) msg = "Enter your full name.";
        else if (!validEmail(f.email.value.trim())) msg = "Enter a valid email. Tickets are sent there.";
        else if (f.phone.value.replace(/\D/g, "").length < 7) msg = "Enter a mobile number, for day-of changes.";
        else if (!f.terms.checked) msg = "Agree to the terms and refund policy to continue.";
        if (msg) return error(2, msg);
        error(2, "");
      }
      current = to;
      show(to);
      paintSummary();
    });

    Array.prototype.forEach.call(app.querySelectorAll('input[name="method"]'), function (radio) {
      radio.addEventListener("change", function () {
        var card = radio.value === "card" && radio.checked;
        app.querySelector("[data-pay-card]").hidden = !card;
        app.querySelector("[data-pay-mobile]").hidden = card;
        error(3, "");
      });
    });

    app.querySelector("[data-pay]").addEventListener("submit", function (e) {
      e.preventDefault();
      var method = app.querySelector('input[name="method"]:checked').value;
      var pay = app.querySelector("[data-pay]");
      if (method === "card") {
        var num = pay.card.value.replace(/\s/g, "");
        var exp = pay.exp.value.trim();
        var m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(exp);
        if (!/^\d{15,16}$/.test(num)) return error(3, "Enter the card number. In test mode use 4242 4242 4242 4242.");
        if (!m || +m[1] < 1 || +m[1] > 12 || new Date(2000 + +m[2], +m[1], 0) < new Date()) return error(3, "Enter a valid expiry date, MM/YY.");
        if (!/^\d{3,4}$/.test(pay.cvc.value.trim())) return error(3, "Enter the 3 or 4 digit security code.");
      }
      if (method === "mobile") {
        var phone = pay.mobile.value.replace(/[^\d]/g, "");
        if (phone.length < 9 || phone.length > 13) return error(3, "Enter the mobile money number, for example +254 712 345 678.");
      }
      error(3, "");
      var btn = app.querySelector("[data-pay-button]");
      btn.disabled = true;
      btn.textContent = method === "mobile" ? "Approve on your phone…" : "Processing…";
      setTimeout(function () {
        btn.disabled = false;
        if (method === "card" && pay.card.value.replace(/\s/g, "") === "4000000000000002") {
          paintSummary();
          return error(3, "The bank declined this card. No money was taken. Try another card or mobile money.");
        }
        if (method === "mobile" && /0001$/.test(pay.mobile.value.replace(/[^\d]/g, ""))) {
          paintSummary();
          return error(3, "The payment was not approved on the phone (wrong PIN or not enough balance). No money was taken. Try again or use a card.");
        }
        // re-check seats: another buyer (or tab) may have taken them
        var ok = ev.types.every(function (t) { return (qty[t.id] || 0) <= typeLeft(ev, t); }) && seatCount(ev, qty) <= seatsLeft(ev);
        if (!ok) {
          paintSummary();
          show(1);
          repaint();
          return error(1, "Some of these seats were just sold. Your card was not charged. Check the tickets again.");
        }
        finish(method);
      }, method === "mobile" ? 1600 : 1100);
    });

    function finish(method) {
      clearInterval(holdTimer);
      var f = app.querySelector("[data-details]");
      var p = priceOf(ev, qty, promo);
      var buyerName = f.name.value.trim();
      var tickets = [];
      Array.prototype.forEach.call(app.querySelectorAll("[data-holders] input"), function (input) {
        var t = typeBy(ev, input.getAttribute("data-type"));
        tickets.push({ code: ticketCode(), holder: input.value.trim() || buyerName, type: t.id, label: t.label, checkedIn: null });
      });
      var answers = {};
      (ev.questions || []).forEach(function (q) {
        var input = f.querySelector('[name="q-' + q.id + '"]');
        if (input && input.value.trim()) answers[q.id] = input.value.trim();
      });
      var order = {
        id: orderId(),
        kind: "order",
        slug: ev.slug,
        title: ev.title,
        status: "paid",
        created: new Date().toISOString(),
        buyer: { name: buyerName, email: f.email.value.trim().toLowerCase(), phone: f.phone.value.trim() },
        lines: p.lines,
        currency: p.cur,
        subtotal: p.sub,
        discount: p.discount,
        promo: promo,
        fee: p.fee,
        total: p.total,
        method: method,
        payment: "test_" + rand("abcdef0123456789", 12),
        news: f.news.checked,
        answers: answers,
        tickets: tickets
      };
      var list = readOrders();
      list.push(order);
      writeOrders(list);
      app.querySelector("[data-done-title]").textContent = "You’re going to " + ev.title;
      app.querySelector("[data-done-lede]").textContent =
        "Order " + order.id + " · " + money(order.total, order.currency) + " paid. The tickets would be emailed to " + order.buyer.email + ". They are also in My tickets.";
      var box = app.querySelector("[data-done-tickets]");
      box.textContent = "";
      tickets.forEach(function (t) {
        box.appendChild(ticketCard(order, t));
      });
      app.querySelector("[data-ics]").onclick = function () {
        downloadICS(ev, order);
      };
      app.querySelector("[data-summary]").classList.add("is-done");
      show(4);
    }

    show(1);
  }

  /* ---------- my tickets ---------- */

  function initMyTickets() {
    var page = document.querySelector("[data-my-tickets]");
    if (!page) return;
    var filterEmail = "";
    var box = page.querySelector("[data-orders]");
    var empty = page.querySelector("[data-orders-empty]");

    function paint() {
      var list = readOrders().filter(function (o) {
        return !filterEmail || o.buyer.email === filterEmail;
      }).sort(function (a, b) { return b.created < a.created ? -1 : 1; });
      box.textContent = "";
      empty.hidden = list.length !== 0;
      if (filterEmail && !list.length) {
        empty.hidden = false;
        empty.textContent = "No orders for " + filterEmail + " in this browser.";
      }
      list.forEach(function (order) {
        var ev = eventBy(order.slug) || { title: order.title, dates: "", place: "", start: order.created };
        var block = el("section", "order-block");
        var head = el("div", "order-head");
        var left = el("div");
        left.appendChild(el("p", "kind", order.kind === "rsvp" ? "Invitation · " + order.id : order.kind === "waitlist" ? "Waitlist · " + order.id : "Order · " + order.id));
        left.appendChild(el("h2", "", ev.title));
        if (ev.dates) left.appendChild(el("p", "meta", ev.dates + " · " + ev.place));
        head.appendChild(left);
        var right = el("div", "order-right");
        right.appendChild(el("span", "pill", statusLabel(order.status)));
        if (order.total) right.appendChild(el("strong", "", money(order.total, order.currency)));
        head.appendChild(right);
        block.appendChild(head);

        if (order.kind === "waitlist") {
          block.appendChild(el("p", "", order.status === "offered"
            ? "A seat came back. In the live site the email holds a checkout link for 24 hours."
            : "You asked for " + order.lines[0].qty + " seat(s). " + BRAND + " emails you if one comes back."));
        }
        if (order.tickets.length) {
          var grid = el("div", "ticket-cards");
          order.tickets.forEach(function (t) {
            grid.appendChild(ticketCard(order, t));
          });
          block.appendChild(grid);
        }
        var actions = el("div", "admin-actions");
        if (isLive(order) && ev.start) {
          var cal = el("button", "btn quiet", "Add to calendar");
          cal.type = "button";
          cal.onclick = function () { downloadICS(ev, order); };
          actions.appendChild(cal);
        }
        var daysOut = ev.start ? (new Date(ev.start) - new Date()) / 86400000 : 0;
        if (order.kind === "order" && order.status === "paid") {
          if (daysOut > 7) {
            var refund = el("button", "btn quiet", "Request refund");
            refund.type = "button";
            refund.onclick = function () {
              if (!window.confirm("Request a refund of " + money(order.total - order.fee, order.currency) + "? The booking fee is not refunded.")) return;
              updateOrder(order.id, function (o) { o.status = "refund_requested"; o.refundAsked = new Date().toISOString(); });
              paint();
            };
            actions.appendChild(refund);
          } else {
            actions.appendChild(el("p", "fine", "Inside 7 days of the event: tickets can be transferred, not refunded."));
          }
          var rename = el("button", "btn quiet", "Change a name");
          rename.type = "button";
          rename.onclick = function () {
            var pick = order.tickets.length === 1 ? 1 : parseInt(window.prompt("Which ticket? 1 to " + order.tickets.length, "1"), 10);
            if (!(pick >= 1 && pick <= order.tickets.length)) return;
            var name = (window.prompt("New name for ticket " + pick, order.tickets[pick - 1].holder) || "").trim();
            if (!name) return;
            updateOrder(order.id, function (o) { o.tickets[pick - 1].holder = name; });
            paint();
          };
          actions.appendChild(rename);
        }
        if (order.kind === "rsvp" && order.status === "confirmed") {
          var cancel = el("button", "btn quiet", "I can’t come");
          cancel.type = "button";
          cancel.onclick = function () {
            if (!window.confirm("Give up your place? The studio can offer it to someone else.")) return;
            updateOrder(order.id, function (o) { o.status = "cancelled"; });
            paint();
          };
          actions.appendChild(cancel);
        }
        if (order.status === "refund_requested") actions.appendChild(el("p", "fine", "Refund requested. " + BRAND + " reviews it within 2 working days."));
        if (isLive(order) && ev.online_url) {
          var join = el("a", "btn signal", "Join online");
          join.href = ev.online_url;
          join.target = "_blank";
          join.rel = "noopener noreferrer";
          actions.insertBefore(join, actions.firstChild);
        }
        if (actions.childNodes.length) block.appendChild(actions);
        box.appendChild(block);
      });
    }

    page.querySelector("[data-lookup]").addEventListener("submit", function (e) {
      e.preventDefault();
      filterEmail = e.target.email.value.trim().toLowerCase();
      paint();
    });
    window.addEventListener("storage", function (e) {
      if (e.key === ORDERS_KEY) paint();
    });
    paint();
  }

  /* ---------- shared with js/portal.js ---------- */

  window.MDVTickets = {
    KEY: ORDERS_KEY,
    FEE_PERCENT: FEE_PERCENT,
    BRAND: BRAND,
    CURRENCY: CURRENCY,
    RATES: RATES,
    usdText: usdText,
    PROMOS: PROMOS,
    EVENTS: EVENTS,
    eventBy: eventBy,
    typeBy: typeBy,
    readOrders: readOrders,
    writeOrders: writeOrders,
    updateOrder: updateOrder,
    seatsLeft: seatsLeft,
    typeLeft: typeLeft,
    soldByType: soldByType,
    priceOf: priceOf,
    ticketCode: ticketCode,
    orderId: orderId,
    money: money,
    statusLabel: statusLabel,
    isLive: isLive,
    fmtDateTime: fmtDateTime,
    download: download,
    paintQR: paintQR
  };

  paintLiveState();
  initEventPage();
  initCheckout();
  initMyTickets();
  window.addEventListener("storage", function (e) {
    if (e.key === ORDERS_KEY) paintLiveState();
  });
})();
