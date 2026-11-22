(function () {
  var KEY = "mdv-saved";

  function read() {
    try {
      var list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (error) {
      return [];
    }
  }

  function write(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
  }

  function syncSaves() {
    var saved = read();
    Array.prototype.forEach.call(document.querySelectorAll("[data-save]"), function (button) {
      var on = saved.indexOf(button.getAttribute("data-save")) !== -1;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.textContent = on ? "Saved" : "Save";
    });
  }

  var CONFIG_KEY = "mdv-config";

  function readConfig() {
    var config = {
      showEarlier: true,
      showPrices: true,
      showInvited: true,
      contact: "",
      notice: "",
      featured: "",
      hidden: [],
      lifecycle: {}
    };
    try {
      var saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
      if (saved && typeof saved === "object") {
        if (saved.showEarlier === false) config.showEarlier = false;
        if (saved.showPrices === false) config.showPrices = false;
        if (saved.showInvited === false) config.showInvited = false;
        if (typeof saved.contact === "string" && saved.contact.trim()) config.contact = saved.contact.trim();
        if (typeof saved.notice === "string") config.notice = saved.notice.slice(0, 180);
        if (typeof saved.featured === "string") config.featured = saved.featured;
        if (Array.isArray(saved.hidden)) config.hidden = saved.hidden;
        if (saved.lifecycle && typeof saved.lifecycle === "object") config.lifecycle = saved.lifecycle;
      }
    } catch (parseError) {
      return config;
    }
    return config;
  }

  function catalog() {
    var node = document.getElementById("site-catalog");
    try {
      var list = JSON.parse(node ? node.textContent : "[]");
      return Array.isArray(list) ? list : [];
    } catch (parseError) {
      return [];
    }
  }

  function findEvent(slug) {
    var list = catalog();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].slug === slug) return list[i];
    }
    return null;
  }

  function pictureHTML(root, slug, alt) {
    var base = root + "images/opt/" + encodeURIComponent(slug);
    var esc = String(alt || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
    return '<picture><source type="image/webp" srcset="' + base + "-640.webp 640w, " + base + '-1200.webp 1200w" sizes="(min-width: 900px) 45vw, 100vw">' +
      '<img src="' + base + '-1200.jpg" width="1200" height="800" alt="' + esc + '" decoding="async"></picture>';
  }

  function ticketControl(event) {
    if (event.mode === "site" && (event.state === "On sale" || event.state === "Limited")) {
      var get = document.createElement("a");
      get.className = "btn signal";
      get.href = (document.body.getAttribute("data-root") || "") + "events/" + event.slug + ".html#tickets";
      get.textContent = "Get tickets";
      return get;
    }
    if ((event.state === "On sale" || event.state === "Limited") && event.ticket) {
      var link = document.createElement("a");
      link.className = "btn signal";
      link.href = event.ticket;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = event.provider ? "Buy tickets on " + event.provider : "Buy tickets";
      return link;
    }
    if (event.state === "Sold out" || event.state === "Invite only") {
      var note = document.createElement("p");
      note.className = "btn is-disabled";
      note.textContent = event.state === "Sold out" ? "Sold out" : "Invitation required";
      return note;
    }
    return null;
  }

  function applyFeatured(config) {
    var block = document.querySelector("[data-featured]");
    if (!block) return;
    if (!block.getAttribute("data-published-html")) {
      block.setAttribute("data-published-html", block.innerHTML);
    }
    var published = block.getAttribute("data-slug");
    block.innerHTML = block.getAttribute("data-published-html");
    block.setAttribute("data-slug", published);
    if (!config.featured || config.featured === published) return;
    var event = findEvent(config.featured);
    if (!event) return;
    var root = document.body.getAttribute("data-root") || "";
    block.setAttribute("data-slug", event.slug);
    var kind = block.querySelector("[data-featured-kind]");
    if (kind) kind.textContent = "Featured · " + event.kind + " · " + event.dates;
    var title = block.querySelector("[data-featured-title]");
    if (title) title.textContent = event.title;
    var summary = block.querySelector("[data-featured-summary]");
    if (summary) summary.textContent = event.summary;
    var meta = block.querySelector("[data-featured-meta]");
    if (meta) meta.textContent = event.place + " · " + event.seats;
    var pic = block.querySelector("[data-featured-picture]");
    if (pic) pic.innerHTML = pictureHTML(root, event.slug, event.title);
    var mon = block.querySelector("[data-featured-mon]");
    if (mon) mon.textContent = event.mon;
    var day = block.querySelector("[data-featured-day]");
    if (day) day.textContent = event.day;
    var year = block.querySelector("[data-featured-year]");
    if (year) year.textContent = event.year;
    var actions = block.querySelector("[data-featured-actions]");
    if (actions) {
      actions.textContent = "";
      var ticket = ticketControl(event);
      if (ticket) actions.appendChild(ticket);
      var page = document.createElement("a");
      page.className = "btn quiet";
      page.href = root + "events/" + event.slug + ".html";
      page.textContent = "Event page";
      actions.appendChild(page);
    }
  }

  function applySite(config) {
    config = config || readConfig();
    document.body.classList.toggle("hide-prices", !config.showPrices);
    document.body.classList.toggle("hide-invited", !config.showInvited);
    var note = document.querySelector("[data-site-note]");
    if (note) {
      note.textContent = config.notice;
      note.hidden = !config.notice.trim();
    }
    // Only a browser preview override replaces the published contact address.
    if (config.contact) {
      Array.prototype.forEach.call(document.querySelectorAll("[data-contact]"), function (link) {
        link.textContent = config.contact;
        link.href = "mailto:" + config.contact;
      });
    }
    var headerTicket = document.querySelector("[data-header-tickets]");
    if (headerTicket) {
      var root = document.body.getAttribute("data-root") || "";
      var chosen = config.featured ? findEvent(config.featured) : null;
      var slug = chosen ? chosen.slug : "harbor-assembly";
      headerTicket.href = root + "events/" + slug + ".html#tickets";
    }
    applyFeatured(config);
    var pageHidden = document.querySelector("[data-page-hidden]");
    if (pageHidden) {
      var slug = pageHidden.getAttribute("data-slug");
      var life = statusOf(slug, pageHidden.getAttribute("data-lifecycle"));
      var bits = [];
      if (config.hidden.indexOf(slug) !== -1) bits.push("This listing is hidden from the public lists on this browser.");
      if (life === "pending") bits.push("This listing is waiting for approval, so it is not on the public lists.");
      if (life === "draft") {
        var reason = config.lifecycle[slug] && config.lifecycle[slug].reason;
        bits.push(reason ? "This listing was rejected. " + reason : "This listing was rejected and is not on the public lists.");
      }
      if (life === "archived") bits.push("This event is in the archive.");
      pageHidden.hidden = bits.length === 0;
      pageHidden.textContent = bits.join(" ");
    }
    if (document.querySelector("[data-index]")) apply();
  }

  function statusOf(slug, fallback) {
    var row = readConfig().lifecycle[slug];
    if (row && row.status) return row.status;
    return fallback || "published";
  }

  function writeConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    applySite(config);
  }

  /* ---------------- browsing: filters, sort, pages, list or calendar ----------------
   * Every control is optional, so the same code runs the homepage (kind chips
   * only) and the events page (everything). State lives in the URL.
   *
   * Dates: each event's ISO time carries its own UTC offset (Nairobi +03:00,
   * Kigali +02:00), so its local date and time are read straight from the
   * string. "Today" and "this weekend" use the visitor's own calendar.
   */
  var SETTINGS = {};
  try {
    SETTINGS = JSON.parse(document.getElementById("site-settings").textContent) || {};
  } catch (e) {}
  var WEEKEND = Array.isArray(SETTINGS.weekend) && SETTINGS.weekend.length ? SETTINGS.weekend : [6, 0];
  var PER_PAGE = Math.max(1, Number(SETTINGS.perPage) || 9);
  var BRAND_NAME = SETTINGS.brand || "MDV";
  var page = 1;
  var lastSignature = "";
  var rangeFrom = ""; // "YYYY-MM-DD" from the Dates calendar
  var rangeTo = "";

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function localKey(date) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function addDays(key, n) {
    var d = new Date(key + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function weekdayOf(key) {
    return new Date(key + "T12:00:00Z").getUTCDay();
  }

  function whenWindow(when) {
    var today = localKey(new Date());
    if (when === "today") return [today, today];
    if (when === "30d") return [today, addDays(today, 30)];
    if (when === "weekend") {
      // The next run of weekend days (from site settings), including today.
      var start = today;
      for (var i = 0; i < 7 && WEEKEND.indexOf(weekdayOf(start)) === -1; i++) start = addDays(start, 1);
      var end = start;
      while (WEEKEND.indexOf(weekdayOf(addDays(end, 1))) !== -1 && end < addDays(start, 6)) end = addDays(end, 1);
      return [start, end];
    }
    return null;
  }

  var WHEN_LABEL = { today: "Today", weekend: "This weekend", "30d": "Next 30 days" };
  var AMOUNT_LABEL = { free: "Free", lt10: "Under USD 10", "10to50": "USD 10–50", gt50: "Over USD 50" };
  var BOOK_LABEL = { site: "Book on " + BRAND_NAME, external: "Organizer’s site", rsvp: "Register or invite" };

  function activeChip(root, attr, fallback) {
    var chip = root.querySelector("[" + attr + "].is-active");
    return chip ? chip.getAttribute(attr) : fallback;
  }

  function setChip(root, attr, value) {
    Array.prototype.forEach.call(root.querySelectorAll("[" + attr + "]"), function (chip) {
      var on = chip.getAttribute(attr) === value;
      chip.classList.toggle("is-active", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function val(root, selector, fallback) {
    var node = root.querySelector(selector);
    return node ? node.value : fallback;
  }

  function readState(root) {
    return {
      kind: activeChip(root, "data-filter", "All"),
      when: activeChip(root, "data-when", "any"),
      view: activeChip(root, "data-view", "list"),
      city: val(root, "select[data-city]", "All"),
      book: val(root, "select[data-price-filter]", "All"),
      price: val(root, "select[data-amount]", "All"),
      sort: val(root, "select[data-sort]", "date"),
      q: (val(root, "[data-search]", "") || "").trim()
    };
  }

  function writeState(root, s) {
    setChip(root, "data-filter", s.kind);
    setChip(root, "data-when", s.when);
    setChip(root, "data-view", s.view);
    [["select[data-city]", s.city], ["select[data-price-filter]", s.book], ["select[data-amount]", s.price], ["select[data-sort]", s.sort], ["[data-search]", s.q]].forEach(function (pair) {
      var node = root.querySelector(pair[0]);
      if (node) node.value = pair[1];
    });
  }

  var DEFAULTS = { kind: "All", when: "any", view: "list", city: "All", book: "All", price: "All", sort: "date", q: "" };

  // data-amount holds an approximate US dollar value, so currencies compare.
  function amountOk(card, price) {
    if (price === "All") return true;
    var raw = card.getAttribute("data-amount");
    if (raw === "" || raw === null) return false;
    var n = Number(raw);
    if (price === "free") return n === 0;
    if (price === "lt10") return n > 0 && n < 10;
    if (price === "10to50") return n >= 10 && n <= 50;
    if (price === "gt50") return n > 50;
    return true;
  }

  function cardDays(card) {
    var start = card.getAttribute("data-start") || "";
    var end = card.getAttribute("data-end") || start;
    return [start.slice(0, 10), end.slice(0, 10)];
  }

  function remember(cards) {
    cards.forEach(function (card, i) {
      if (!card._home) {
        card._home = card.parentNode;
        card._order = i;
      }
    });
  }

  function apply() {
    var root = document.querySelector("[data-index]");
    if (!root) return;
    var s = readState(root);
    var signature = JSON.stringify(s) + rangeFrom + rangeTo;
    if (lastSignature && signature !== lastSignature) page = 1; // new filters start at page 1
    lastSignature = signature;
    var saved = read();
    var config = readConfig();
    var cards = Array.prototype.slice.call(root.querySelectorAll("[data-event]"));
    remember(cards);
    var win = rangeFrom ? [rangeFrom, rangeTo || rangeFrom] : whenWindow(s.when);
    var q = s.q.toLowerCase();

    cards.forEach(function (card) {
      var slug = card.getAttribute("data-slug");
      var life = statusOf(slug, card.getAttribute("data-lifecycle"));
      var days = cardDays(card);
      var ok =
        (s.kind === "All" || s.kind === "Saved" || card.getAttribute("data-kind") === s.kind) &&
        (s.kind !== "Saved" || saved.indexOf(slug) !== -1) &&
        (s.city === "All" || card.getAttribute("data-city") === s.city) &&
        (s.book === "All" || card.getAttribute("data-price") === s.book) &&
        amountOk(card, s.price) &&
        (!win || (days[0] <= win[1] && days[1] >= win[0])) &&
        (!q || card.textContent.toLowerCase().indexOf(q) !== -1) &&
        (life === "published" || (life === "archived" && config.showEarlier)) &&
        config.hidden.indexOf(slug) === -1 &&
        (config.showEarlier || card.getAttribute("data-group") !== "earlier");
      card.hidden = !ok;
      card._match = ok;
    });

    // Sorting other than by date flattens the month groups into one list.
    var sortedBox = root.querySelector("[data-sorted-cards]");
    var sortedSection = root.querySelector("[data-sorted]");
    var flat = sortedBox && s.sort !== "date";
    if (flat) {
      cards.slice().sort(function (a, b) {
        if (s.sort === "price") {
          var pa = a.getAttribute("data-amount"), pb = b.getAttribute("data-amount");
          pa = pa === "" ? Infinity : Number(pa);
          pb = pb === "" ? Infinity : Number(pb);
          if (pa !== pb) return pa - pb;
        }
        if (s.sort === "fast") {
          var la = a.getAttribute("data-left"), lb = b.getAttribute("data-left");
          la = la === "" || la === "0" ? Infinity : Number(la);
          lb = lb === "" || lb === "0" ? Infinity : Number(lb);
          if (la !== lb) return la - lb;
        }
        return a.getAttribute("data-start") < b.getAttribute("data-start") ? -1 : 1;
      }).forEach(function (card) {
        sortedBox.appendChild(card);
      });
    } else {
      cards.slice().sort(function (a, b) {
        return a._order - b._order;
      }).forEach(function (card) {
        if (card.parentNode !== card._home) card._home.appendChild(card);
      });
    }

    var matches = Array.prototype.slice.call(root.querySelectorAll("[data-event]")).filter(function (card) {
      return card._match;
    }); // in display order
    var calendar = root.querySelector("[data-calendar]");
    var showCalendar = calendar && s.view === "calendar";

    // Pages (list view only, and only where the page has a pager).
    var pager = root.querySelector("[data-pager]");
    var pages = Math.max(1, Math.ceil(matches.length / PER_PAGE));
    if (page > pages) page = pages;
    var paged = pager && !showCalendar && matches.length > PER_PAGE;
    var first = (page - 1) * PER_PAGE;
    if (paged) {
      matches.forEach(function (card, i) {
        card.hidden = i < first || i >= first + PER_PAGE;
      });
    }
    if (pager) paintPager(pager, paged ? pages : 0);

    Array.prototype.forEach.call(root.querySelectorAll("section[data-group]"), function (group) {
      var any = Array.prototype.some.call(group.querySelectorAll("[data-event]"), function (card) {
        return !card.hidden;
      });
      group.hidden = showCalendar || flat || !any;
    });
    if (sortedSection) sortedSection.hidden = showCalendar || !flat || !matches.length;
    if (calendar) {
      calendar.hidden = !showCalendar || !matches.length;
      if (showCalendar) renderCalendar(calendar, matches);
    }

    var count = root.querySelector("[data-count]");
    if (count) {
      count.textContent = paged
        ? "Showing " + (first + 1) + "–" + Math.min(first + PER_PAGE, matches.length) + " of " + matches.length + " events"
        : matches.length === 1 ? "1 event" : matches.length + " events";
    }
    var empty = root.querySelector("[data-empty]");
    if (empty) empty.hidden = matches.length !== 0;
    paintActiveFilters(root, s);
    writeFilterUrl(s);
  }

  function paintPager(pager, pages) {
    pager.textContent = "";
    pager.hidden = pages < 2;
    if (pages < 2) return;
    function add(label, target, opts) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.setAttribute("data-page", String(target));
      if (opts && opts.aria) b.setAttribute("aria-label", opts.aria);
      if (opts && opts.current) {
        b.setAttribute("aria-current", "page");
        b.className = "is-current";
      }
      if (opts && opts.disabled) b.disabled = true;
      pager.appendChild(b);
    }
    add("← Previous", page - 1, { disabled: page === 1, aria: "Previous page" });
    for (var i = 1; i <= pages; i++) add(String(i), i, { current: i === page, aria: "Page " + i });
    add("Next →", page + 1, { disabled: page === pages, aria: "Next page" });
  }

  function renderCalendar(box, cards) {
    box.textContent = "";
    // The calendar plans ahead: past events stay in the list view.
    var todayKey = localKey(new Date());
    cards = cards.filter(function (card) {
      return cardDays(card)[1] >= todayKey;
    });
    if (!cards.length) {
      var none = document.createElement("p");
      none.className = "empty";
      none.textContent = "No upcoming events match. Past events are in the list view.";
      box.appendChild(none);
      return;
    }
    var byDay = {};
    cards.forEach(function (card) {
      var days = cardDays(card);
      for (var key = days[0], guard = 0; key <= days[1] && guard < 40; key = addDays(key, 1), guard += 1) {
        (byDay[key] = byDay[key] || []).push(card);
      }
    });
    var months = Object.keys(byDay).map(function (k) {
      return k.slice(0, 7);
    }).filter(function (m, i, all) {
      return all.indexOf(m) === i;
    }).sort();
    var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    months.forEach(function (month) {
      var first = new Date(month + "-01T12:00:00Z");
      var title = first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      var section = document.createElement("section");
      section.className = "cal-month";
      section.setAttribute("aria-label", title);
      var h = document.createElement("h2");
      h.textContent = title;
      section.appendChild(h);
      var grid = document.createElement("ol");
      grid.className = "cal-grid";
      names.forEach(function (d) {
        var head = document.createElement("li");
        head.className = "cal-head";
        head.setAttribute("aria-hidden", "true");
        head.textContent = d;
        grid.appendChild(head);
      });
      for (var i = 0; i < first.getUTCDay(); i += 1) {
        var padCell = document.createElement("li");
        padCell.className = "cal-pad";
        padCell.setAttribute("aria-hidden", "true");
        grid.appendChild(padCell);
      }
      for (var key = month + "-01"; key.slice(0, 7) === month; key = addDays(key, 1)) {
        var cell = document.createElement("li");
        var events = byDay[key] || [];
        cell.className = "cal-day" + (events.length ? " has-events" : "") + (key === todayKey ? " is-today" : "") + (WEEKEND.indexOf(weekdayOf(key)) !== -1 ? " is-weekend" : "");
        var label = document.createElement("time");
        label.setAttribute("datetime", key);
        label.textContent = String(Number(key.slice(8)));
        label.setAttribute("aria-label", new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));
        cell.appendChild(label);
        events.forEach(function (card) {
          var a = document.createElement("a");
          a.href = card.querySelector("a.card").getAttribute("href");
          a.className = "cal-event";
          a.setAttribute("data-kind", card.getAttribute("data-kind"));
          var start = card.getAttribute("data-start") || "";
          var t = document.createElement("span");
          t.textContent = start.slice(0, 10) === key ? start.slice(11, 16) : "Continues";
          a.appendChild(t);
          a.appendChild(document.createTextNode(" " + card.querySelector(".card-title").textContent + " · " + card.getAttribute("data-city")));
          cell.appendChild(a);
        });
        grid.appendChild(cell);
      }
      section.appendChild(grid);
      box.appendChild(section);
    });
  }

  var skipFilterUrl = false;
  var URL_KEYS = { kind: "kind", when: "when", view: "view", city: "city", book: "book", price: "price", sort: "sort", q: "q" };

  function writeFilterUrl(s) {
    if (skipFilterUrl || !document.querySelector("[data-index]")) return;
    var params = new URLSearchParams();
    Object.keys(URL_KEYS).forEach(function (k) {
      if (s[k] && s[k] !== DEFAULTS[k]) params.set(URL_KEYS[k], s[k]);
    });
    if (rangeFrom) params.set("from", rangeFrom);
    if (rangeTo) params.set("to", rangeTo);
    if (page > 1) params.set("page", String(page));
    var next = location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash;
    var current = location.pathname + location.search + location.hash;
    if (next !== current) history.replaceState(null, "", next);
    // Event pages offer "Back to results" with these filters.
    if (/events\.html$/.test(location.pathname)) {
      try {
        sessionStorage.setItem("mdv-last-list", "events.html" + (params.toString() ? "?" + params.toString() : ""));
      } catch (e) {}
    }
  }

  function paintActiveFilters(root, s) {
    var box = root.querySelector("[data-active-filters]");
    if (!box) return;
    box.textContent = "";
    function add(label, key) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.setAttribute("data-drop-filter", key);
      button.setAttribute("aria-label", "Remove filter: " + label);
      button.textContent = label + " ×";
      box.appendChild(button);
    }
    if (s.kind !== "All") add(s.kind === "Saved" ? "Saved" : s.kind, "kind");
    if (WHEN_LABEL[s.when]) add(WHEN_LABEL[s.when], "when");
    if (rangeFrom) add(rangeLabel(), "dates");
    if (s.city !== "All") add(s.city, "city");
    if (AMOUNT_LABEL[s.price]) add(AMOUNT_LABEL[s.price], "price");
    if (BOOK_LABEL[s.book]) add(BOOK_LABEL[s.book], "book");
    if (s.q) add("“" + s.q + "”", "q");
    if (box.childNodes.length > 1) {
      var clear = document.createElement("button");
      clear.type = "button";
      clear.className = "text-button";
      clear.setAttribute("data-clear-filters", "");
      clear.textContent = "Clear all";
      box.appendChild(clear);
    }
  }

  function readFilterUrl() {
    var root = document.querySelector("[data-index]");
    if (!root) return;
    var params = new URLSearchParams(location.search);
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      s[k] = params.get(URL_KEYS[k]) || DEFAULTS[k];
    });
    writeState(root, s);
    page = Math.max(1, parseInt(params.get("page"), 10) || 1);
    var isDay = /^\d{4}-\d{2}-\d{2}$/;
    rangeFrom = isDay.test(params.get("from") || "") ? params.get("from") : "";
    rangeTo = rangeFrom && isDay.test(params.get("to") || "") && params.get("to") >= rangeFrom ? params.get("to") : "";
    if (window.__paintDateTrigger) window.__paintDateTrigger();
    lastSignature = JSON.stringify(readState(root));
  }

  function clearFilters() {
    var root = document.querySelector("[data-index]");
    if (!root) return;
    var s = readState(root);
    var keep = { sort: s.sort, view: s.view };
    rangeFrom = "";
    rangeTo = "";
    if (window.__paintDateTrigger) window.__paintDateTrigger();
    writeState(root, Object.assign({}, DEFAULTS, keep));
    apply();
  }

  document.addEventListener("click", function (event) {
    var b = event.target.closest("[data-pager] [data-page]");
    if (!b || b.disabled) return;
    page = Number(b.getAttribute("data-page")) || 1;
    apply();
    var root = document.querySelector("[data-index]");
    var head = root && (root.querySelector(".filters") || root);
    if (head) head.scrollIntoView({ block: "start" });
  });

  function openPhoto(src, alt) {
    var dialog = document.getElementById("lightbox");
    if (!dialog) return;
    var image = dialog.querySelector("img");
    image.src = src;
    image.alt = alt || "";
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  document.addEventListener("click", function (event) {
    var save = event.target.closest("[data-save]");
    if (save) {
      event.preventDefault();
      event.stopPropagation();
      var id = save.getAttribute("data-save");
      var list = read();
      var index = list.indexOf(id);
      if (index === -1) list.push(id);
      else list.splice(index, 1);
      write(list);
      syncSaves();
      apply();
      return;
    }

    var share = event.target.closest("[data-share]");
    if (share && navigator.share) {
      navigator.share({ title: document.title, url: location.href.split("#")[0] }).catch(function () {});
      return;
    }

    var copy = event.target.closest("[data-copy]");
    if (copy) {
      var url = location.href.split("#")[0];
      var label = copy.textContent;
      var done = function () {
        copy.textContent = "Link copied";
        setTimeout(function () {
          copy.textContent = label;
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done);
      }
      return;
    }

    var drop = event.target.closest("[data-drop-filter]");
    if (drop) {
      var indexRoot = document.querySelector("[data-index]");
      var st = readState(indexRoot);
      if (drop.getAttribute("data-drop-filter") === "dates") {
        rangeFrom = "";
        rangeTo = "";
        if (window.__paintDateTrigger) window.__paintDateTrigger();
      }
      st[drop.getAttribute("data-drop-filter")] = DEFAULTS[drop.getAttribute("data-drop-filter")];
      writeState(indexRoot, st);
      apply();
      return;
    }

    if (event.target.closest("[data-clear-filters]")) {
      clearFilters();
      return;
    }

    var photo = event.target.closest("[data-photo]");
    if (photo) {
      openPhoto(photo.getAttribute("data-photo"), photo.getAttribute("data-alt"));
    }
  });

  /* ---------------- Dates dropdown: a calendar to choose a date range ---------------- */

  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function prettyDay(key) {
    return Number(key.slice(8)) + " " + MONTH_SHORT[Number(key.slice(5, 7)) - 1];
  }

  function rangeLabel() {
    if (!rangeFrom) return "Any date";
    if (!rangeTo || rangeTo === rangeFrom) return prettyDay(rangeFrom) + " " + rangeFrom.slice(0, 4);
    return prettyDay(rangeFrom) + " – " + prettyDay(rangeTo) + " " + rangeTo.slice(0, 4);
  }

  (function datePicker() {
    var root = document.querySelector("[data-index]");
    var trigger = root && root.querySelector("[data-date-trigger]");
    var pop = root && root.querySelector("[data-date-pop]");
    if (!trigger || !pop) return;
    var valueNode = trigger.querySelector("[data-date-value]");
    var shown = null; // "YYYY-MM" on screen
    var pickFrom = "";
    var pickTo = "";
    var focusKey = "";

    // Days that have at least one listed event, from the cards on the page.
    function eventDays() {
      var days = {};
      Array.prototype.forEach.call(root.querySelectorAll("[data-event]"), function (card) {
        var life = statusOf(card.getAttribute("data-slug"), card.getAttribute("data-lifecycle"));
        if (life !== "published" && life !== "archived") return;
        var d = cardDays(card);
        for (var k = d[0], g = 0; k <= d[1] && g < 40; k = addDays(k, 1), g++) days[k] = (days[k] || 0) + 1;
      });
      return days;
    }

    function paintTrigger() {
      valueNode.textContent = rangeLabel();
      trigger.classList.toggle("is-set", !!rangeFrom);
    }

    function monthAdd(ym, n) {
      var y = Number(ym.slice(0, 4));
      var m = Number(ym.slice(5, 7)) - 1 + n;
      y += Math.floor(m / 12);
      m = ((m % 12) + 12) % 12;
      return y + "-" + pad(m + 1);
    }

    function render() {
      var days = eventDays();
      var today = localKey(new Date());
      pop.textContent = "";
      var head = document.createElement("div");
      head.className = "dp-head";
      var prev = document.createElement("button");
      prev.type = "button";
      prev.className = "dp-nav";
      prev.setAttribute("aria-label", "Previous month");
      prev.textContent = "←";
      prev.onclick = function () { shown = monthAdd(shown, -1); render(); };
      var next = document.createElement("button");
      next.type = "button";
      next.className = "dp-nav";
      next.setAttribute("aria-label", "Next month");
      next.textContent = "→";
      next.onclick = function () { shown = monthAdd(shown, 1); render(); };
      var title = document.createElement("strong");
      title.setAttribute("aria-live", "polite");
      title.textContent = MONTH_NAMES[Number(shown.slice(5, 7)) - 1] + " " + shown.slice(0, 4);
      head.appendChild(prev);
      head.appendChild(title);
      head.appendChild(next);
      pop.appendChild(head);

      var hint = document.createElement("p");
      hint.className = "dp-hint";
      hint.textContent = !pickFrom ? "Choose a start date." : !pickTo ? "Now choose an end date, or press Done for one day." : rangeLabelFor(pickFrom, pickTo);
      pop.appendChild(hint);

      var grid = document.createElement("div");
      grid.className = "dp-grid";
      grid.setAttribute("role", "grid");
      ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach(function (d) {
        var c = document.createElement("span");
        c.className = "dp-dow";
        c.setAttribute("aria-hidden", "true");
        c.textContent = d;
        grid.appendChild(c);
      });
      var first = shown + "-01";
      for (var i = 0; i < weekdayOf(first); i++) {
        var padCell = document.createElement("span");
        padCell.setAttribute("aria-hidden", "true");
        grid.appendChild(padCell);
      }
      var lo = pickFrom;
      var hi = pickTo || pickFrom;
      for (var key = first; key.slice(0, 7) === shown; key = addDays(key, 1)) {
        (function (k) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "dp-day";
          b.setAttribute("data-day", k);
          b.textContent = String(Number(k.slice(8)));
          var n = days[k] || 0;
          var inRange = lo && k >= lo && k <= hi;
          if (n) b.classList.add("has-ev");
          if (k === today) b.classList.add("is-today");
          if (inRange) b.classList.add("in-range");
          if (k === lo || k === hi) b.classList.add("is-end");
          if (WEEKEND.indexOf(weekdayOf(k)) !== -1) b.classList.add("is-weekend");
          b.setAttribute("aria-pressed", inRange ? "true" : "false");
          b.setAttribute("aria-label", new Date(k + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) + (n ? ", " + n + (n === 1 ? " event" : " events") : ", no events"));
          b.tabIndex = k === focusKey ? 0 : -1;
          b.onclick = function () {
            if (!pickFrom || pickTo) {
              pickFrom = k;
              pickTo = "";
            } else if (k < pickFrom) {
              pickTo = pickFrom;
              pickFrom = k;
            } else {
              pickTo = k;
            }
            focusKey = k;
            render();
            var again = pop.querySelector('[data-day="' + k + '"]');
            if (again) again.focus();
          };
          grid.appendChild(b);
        })(key);
      }
      pop.appendChild(grid);
      if (!pop.querySelector(".dp-day[tabindex='0']")) {
        var firstDay = pop.querySelector(".dp-day");
        if (firstDay) firstDay.tabIndex = 0;
      }

      var quick = document.createElement("div");
      quick.className = "dp-quick";
      [["Today", function () { var t = localKey(new Date()); return [t, t]; }],
        ["This weekend", function () { return whenWindow("weekend"); }],
        ["Next 7 days", function () { var t = localKey(new Date()); return [t, addDays(t, 7)]; }],
        ["Next 30 days", function () { var t = localKey(new Date()); return [t, addDays(t, 30)]; }]].forEach(function (q) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = q[0];
        b.onclick = function () {
          var r = q[1]();
          pickFrom = r[0];
          pickTo = r[1];
          commit();
        };
        quick.appendChild(b);
      });
      pop.appendChild(quick);

      var foot = document.createElement("div");
      foot.className = "dp-foot";
      var clear = document.createElement("button");
      clear.type = "button";
      clear.className = "text-button";
      clear.textContent = "Clear dates";
      clear.onclick = function () { pickFrom = ""; pickTo = ""; commit(); };
      var done = document.createElement("button");
      done.type = "button";
      done.className = "btn signal";
      done.textContent = "Done";
      done.onclick = commit;
      foot.appendChild(clear);
      foot.appendChild(done);
      pop.appendChild(foot);
    }

    function rangeLabelFor(a, b) {
      var oldF = rangeFrom, oldT = rangeTo;
      rangeFrom = a; rangeTo = b;
      var t = rangeLabel();
      rangeFrom = oldF; rangeTo = oldT;
      return t;
    }

    function open() {
      pickFrom = rangeFrom;
      pickTo = rangeTo;
      shown = (rangeFrom || localKey(new Date())).slice(0, 7);
      focusKey = rangeFrom || localKey(new Date());
      render();
      pop.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      var f = pop.querySelector(".dp-day[tabindex='0']");
      if (f) f.focus();
    }

    function close(refocus) {
      pop.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (refocus) trigger.focus();
    }

    function commit() {
      rangeFrom = pickFrom;
      rangeTo = pickTo && pickTo !== pickFrom ? pickTo : "";
      if (rangeFrom) setChip(root, "data-when", "any"); // a date range replaces the When chips
      paintTrigger();
      close(true);
      apply();
    }

    trigger.addEventListener("click", function () {
      if (pop.hidden) open();
      else close(false);
    });
    pop.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      var day = e.target.closest && e.target.closest(".dp-day");
      if (!day) return;
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      var k = addDays(day.getAttribute("data-day"), step);
      focusKey = k;
      if (k.slice(0, 7) !== shown) {
        shown = k.slice(0, 7);
        render();
      } else {
        Array.prototype.forEach.call(pop.querySelectorAll(".dp-day"), function (b) { b.tabIndex = -1; });
      }
      var target = pop.querySelector('[data-day="' + k + '"]');
      if (target) {
        target.tabIndex = 0;
        target.focus();
      }
    });
    document.addEventListener("click", function (e) {
      // composedPath() is taken when the click happens, so a day button that the
      // calendar has since redrawn still counts as "inside".
      var path = e.composedPath ? e.composedPath() : [];
      if (!pop.hidden && path.indexOf(pop) === -1 && path.indexOf(trigger) === -1) close(false);
    });
    window.__paintDateTrigger = paintTrigger;
    paintTrigger();
  })();

  var root = document.querySelector("[data-index]");
  if (root) {
    root.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-filter], [data-when], [data-view]");
      if (!chip || !root.contains(chip)) return;
      var attr = chip.hasAttribute("data-filter") ? "data-filter" : chip.hasAttribute("data-when") ? "data-when" : "data-view";
      if (attr === "data-when" && rangeFrom) { // a When chip replaces a chosen date range
        rangeFrom = "";
        rangeTo = "";
        if (window.__paintDateTrigger) window.__paintDateTrigger();
      }
      setChip(root, attr, chip.getAttribute(attr));
      apply();
    });
    ["select[data-city]", "select[data-price-filter]", "select[data-amount]", "select[data-sort]"].forEach(function (sel) {
      var node = root.querySelector(sel);
      if (node) node.addEventListener("change", apply);
    });
    var search = root.querySelector("[data-search]");
    if (search) search.addEventListener("input", apply);
    readFilterUrl();
    apply();
  }

  window.addEventListener("popstate", function () {
    skipFilterUrl = true;
    readFilterUrl();
    apply();
    skipFilterUrl = false;
  });

  /* ---------------- header search with suggestions ---------------- */

  (function siteSearch() {
    var input = document.querySelector("[data-site-search]");
    var list = document.querySelector("[data-site-results]");
    var form = document.querySelector("[data-site-search-form]");
    var toggle = document.querySelector("[data-search-toggle]");
    var mast = document.querySelector("[data-mast]");
    if (!input || !list) return;
    var siteRoot = document.body.getAttribute("data-root") || "";
    var active = -1;
    var items = [];

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }

    function highlight(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, n) {
        li.classList.toggle("is-active", n === i);
        li.setAttribute("aria-selected", n === i ? "true" : "false");
      });
      if (i >= 0 && list.children[i]) input.setAttribute("aria-activedescendant", list.children[i].id);
    }

    function suggest() {
      var q = input.value.trim().toLowerCase();
      list.textContent = "";
      items = [];
      if (q.length < 2) return close();
      var config = readConfig();
      catalog().forEach(function (e) {
        var life = statusOf(e.slug, e.lifecycle);
        if (life !== "published" && life !== "archived") return;
        if (config.hidden.indexOf(e.slug) !== -1) return;
        var hay = (e.title + " " + e.kind + " " + e.place + " " + e.summary).toLowerCase();
        if (hay.indexOf(q) === -1) return;
        var score = e.title.toLowerCase().indexOf(q) === 0 ? 0 : e.title.toLowerCase().indexOf(q) !== -1 ? 1 : 2;
        items.push({ e: e, score: score + (e.group === "upcoming" ? 0 : 3) });
      });
      items.sort(function (a, b) {
        return a.score - b.score || (a.e.start < b.e.start ? -1 : 1);
      });
      items = items.slice(0, 6);
      items.forEach(function (item, i) {
        var li = document.createElement("li");
        li.id = "site-search-opt-" + i;
        li.setAttribute("role", "option");
        var a = document.createElement("a");
        a.href = siteRoot + "events/" + item.e.slug + ".html";
        a.tabIndex = -1;
        var strong = document.createElement("strong");
        strong.textContent = item.e.title;
        var meta = document.createElement("span");
        meta.textContent = item.e.dates + " · " + item.e.place + (item.e.group === "upcoming" ? "" : " · earlier");
        a.appendChild(strong);
        a.appendChild(meta);
        li.appendChild(a);
        list.appendChild(li);
      });
      var all = document.createElement("li");
      all.id = "site-search-opt-" + items.length;
      all.setAttribute("role", "option");
      all.className = "search-all";
      var link = document.createElement("a");
      link.href = siteRoot + "events.html?q=" + encodeURIComponent(input.value.trim());
      link.tabIndex = -1;
      link.textContent = items.length ? "See all results for “" + input.value.trim() + "”" : "No matches. Search all events for “" + input.value.trim() + "”";
      all.appendChild(link);
      list.appendChild(all);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight(-1);
    }

    input.addEventListener("input", suggest);
    input.addEventListener("focus", suggest);
    input.addEventListener("keydown", function (e) {
      var n = list.children.length;
      if (e.key === "ArrowDown" && n) {
        e.preventDefault();
        highlight((active + 1) % n);
      } else if (e.key === "ArrowUp" && n) {
        e.preventDefault();
        highlight(active <= 0 ? n - 1 : active - 1);
      } else if (e.key === "Enter" && active >= 0 && list.children[active]) {
        e.preventDefault();
        location.href = list.children[active].querySelector("a").href;
      } else if (e.key === "Escape") {
        close();
        if (mast && mast.classList.contains("is-search")) {
          mast.classList.remove("is-search");
          if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
            toggle.focus();
          }
        }
      }
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest("[data-site-search-form]")) close();
    });
    if (toggle && mast) {
      toggle.addEventListener("click", function () {
        var on = !mast.classList.contains("is-search");
        mast.classList.toggle("is-search", on);
        toggle.setAttribute("aria-expanded", on ? "true" : "false");
        if (on) input.focus();
      });
    }
    // The events page has its own search box; keep the header one in sync.
    if (form && document.querySelector("[data-index] [data-search]")) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var inner = document.querySelector("[data-index] [data-search]");
        inner.value = input.value;
        close();
        apply();
        inner.scrollIntoView({ block: "center" });
      });
    }
  })();

  /* ---------------- event page: back to results, read more ---------------- */

  (function eventPage() {
    var back = document.querySelector("[data-back-results]");
    if (back) {
      var last = null;
      try {
        last = sessionStorage.getItem("mdv-last-list");
      } catch (e) {}
      if (last && last !== "events.html") {
        back.href = (document.body.getAttribute("data-root") || "") + last;
        back.hidden = false;
      }
    }
    var wrap = document.querySelector("[data-readmore]");
    if (wrap) {
      var text = wrap.querySelector(".summary");
      var btn = wrap.querySelector("[data-readmore-toggle]");
      wrap.classList.add("is-clamped");
      if (text.scrollHeight > text.clientHeight + 4) {
        btn.hidden = false;
        btn.addEventListener("click", function () {
          var open = wrap.classList.toggle("is-open");
          btn.setAttribute("aria-expanded", open ? "true" : "false");
          btn.textContent = open ? "Show less" : "Read more";
        });
      } else {
        wrap.classList.remove("is-clamped");
      }
    }
  })();

  /* ---------------- venues directory: search, city, access, sort, pages ---------------- */

  (function venueIndex() {
    var root = document.querySelector("[data-venue-index]");
    if (!root) return;
    var list = root.querySelector("[data-venue-list]");
    var cards = Array.prototype.slice.call(list.querySelectorAll("[data-venue]"));
    var search = root.querySelector("[data-venue-search]");
    var sort = root.querySelector("[data-venue-sort]");
    var stepfree = root.querySelector("[data-venue-stepfree]");
    var pager = root.querySelector("[data-venue-pager]");
    var count = root.querySelector("[data-venue-count]");
    var emptyNote = root.querySelector("[data-venue-empty]");
    var PER = 12;
    var city = "All";
    var vpage = 1;

    function paint() {
      var q = search.value.trim().toLowerCase();
      var matches = cards.filter(function (c) {
        return (city === "All" || c.getAttribute("data-city") === city) &&
          (!stepfree.checked || c.getAttribute("data-stepfree") === "1") &&
          (!q || c.getAttribute("data-search").indexOf(q) !== -1);
      });
      matches.sort(function (a, b) {
        if (sort.value === "name") return a.getAttribute("data-name").localeCompare(b.getAttribute("data-name"));
        if (sort.value === "city") return a.getAttribute("data-city").localeCompare(b.getAttribute("data-city")) || a.getAttribute("data-name").localeCompare(b.getAttribute("data-name"));
        return Number(b.getAttribute("data-upcoming")) - Number(a.getAttribute("data-upcoming")) || a.getAttribute("data-name").localeCompare(b.getAttribute("data-name"));
      });
      var pages = Math.max(1, Math.ceil(matches.length / PER));
      if (vpage > pages) vpage = pages;
      var from = (vpage - 1) * PER;
      cards.forEach(function (c) { c.hidden = true; });
      matches.forEach(function (c, i) {
        list.appendChild(c);
        c.hidden = i < from || i >= from + PER;
      });
      count.textContent = matches.length > PER
        ? "Showing " + (from + 1) + "–" + Math.min(from + PER, matches.length) + " of " + matches.length + " venues"
        : matches.length === 1 ? "1 venue" : matches.length + " venues";
      emptyNote.hidden = matches.length !== 0;
      pager.textContent = "";
      pager.hidden = pages < 2;
      for (var i = 1; pages > 1 && i <= pages; i++) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = String(i);
        b.setAttribute("aria-label", "Page " + i);
        if (i === vpage) {
          b.className = "is-current";
          b.setAttribute("aria-current", "page");
        }
        b.setAttribute("data-vpage", String(i));
        pager.appendChild(b);
      }
    }

    root.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-venue-city]");
      if (chip) {
        city = chip.getAttribute("data-venue-city");
        Array.prototype.forEach.call(root.querySelectorAll("[data-venue-city]"), function (c) {
          var on = c === chip;
          c.classList.toggle("is-active", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        vpage = 1;
        paint();
        return;
      }
      var pg = e.target.closest("[data-vpage]");
      if (pg) {
        vpage = Number(pg.getAttribute("data-vpage"));
        paint();
        root.scrollIntoView({ block: "start" });
        return;
      }
      if (e.target.closest("[data-venue-clear]")) {
        search.value = "";
        stepfree.checked = false;
        root.querySelector('[data-venue-city="All"]').click();
      }
    });
    search.addEventListener("input", function () { vpage = 1; paint(); });
    sort.addEventListener("change", paint);
    stepfree.addEventListener("change", function () { vpage = 1; paint(); });
    paint();
  })();

  function paintCountdowns() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-countdown]"), function (node) {
      var start = new Date(node.getAttribute("data-countdown"));
      var end = new Date(node.getAttribute("data-end") || node.getAttribute("data-countdown"));
      var now = new Date();
      var day = function (d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
      };
      var days = Math.round((day(start) - day(now)) / 86400000);
      var text = "";
      if (now > end) text = "Ended";
      else if (now >= start) text = "Happening now";
      else if (days === 0) text = "Today";
      else if (days === 1) text = "Tomorrow";
      else if (days < 60) text = "In " + days + " days";
      node.textContent = text;
      node.hidden = !text;
    });
  }

  syncSaves();
  paintCountdowns();
  applySite();

  // Place, Price and How to book fold behind a "Filters" button.
  (function () {
    var toggle = document.querySelector("[data-more-toggle]");
    var panel = document.querySelector("[data-more-filters]");
    if (!toggle || !panel) return;
    var badge = toggle.querySelector("[data-more-count]");
    function paintCount() {
      var n = 0;
      panel.querySelectorAll("select").forEach(function (sel) { if (sel.value !== "All") n++; });
      badge.textContent = String(n);
      badge.hidden = n === 0;
      toggle.classList.toggle("is-set", n > 0);
    }
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      panel.classList.toggle("is-open", open);
    });
    document.addEventListener("change", paintCount);
    document.addEventListener("click", function () { setTimeout(paintCount, 0); });
    window.addEventListener("popstate", function () { setTimeout(paintCount, 0); });
    setTimeout(paintCount, 0);
  })();

  // Shared with js/portal.js (the organizer desk).
  window.MDVSite = {
    readConfig: readConfig,
    writeConfig: writeConfig,
    statusOf: statusOf,
    catalog: catalog
  };
})();
