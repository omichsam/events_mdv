/* Organizer desk.
 *
 * One small app that renders every desk view from data:
 *   - the content store (#portal-content, or GET /api/content from serve.py):
 *     events, venues, categories, badges, page text, site settings, users
 *   - ticketing helpers and orders (window.MDVTickets, js/tickets.js)
 *   - browser preview switches (window.MDVSite, js/site.js)
 *
 * Saving: with serve.py running, every save PUTs the content store, which is
 * validated, backed up, written, and followed by a site rebuild. Without it,
 * saves stay in this browser as a draft that can be exported.
 *
 * Views are addressed by the URL hash (Back, refresh, and links work):
 *   #home  #events  #events/new  #events/<slug>/<tab>  #approvals  #orders
 *   #orders/<id>  #checkin  #customers  #reports  #content/<page>  #venues
 *   #taxonomy/<kinds|badges>  #users  #settings/<tab>  #activity
 * Roles (admin, editor, box_office, door) decide which views are reachable.
 */
(function () {
  "use strict";

  var T = window.MDVTickets;
  var S = window.MDVSite;
  var gate = document.getElementById("portal-login");
  var desk = document.getElementById("portal-desk");
  if (!T || !S || !gate || !desk) return;

  var SESSION_KEY = "mdv-portal";
  var ACTIVITY_KEY = "mdv-activity";
  var DISMISS_KEY = "mdv-desk-dismissed";

  var view = desk.querySelector("[data-view]");
  var dialog = document.getElementById("desk-dialog");
  /* ---------------- content store ----------------
   * CONTENT is the whole site: events, venues, kinds, badges, pages, site
   * settings, users. With serve.py running, saving publishes it and rebuilds
   * the site. Without it, saves are kept as a draft in this browser.
   */
  var DRAFT_KEY = "mdv-content-draft";
  var EMBEDDED = parseObject(document.getElementById("portal-content"));
  var CONTENT = clone(EMBEDDED);
  var SERVER = false;
  var PUBLISHED_AT = EMBEDDED.updated || "";
  var RECORDS = [];
  var BY = {};
  var EVT = {};

  function parseObject(node) {
    try {
      var data = JSON.parse(node ? node.textContent : "{}");
      return data && typeof data === "object" ? data : {};
    } catch (e) {
      return {};
    }
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x || {}));
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Event times are stored as local wall time plus the city's offset, so the
  // date and time are read straight from the string.
  function partsOf(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "") || [0, "1970", "01", "01", "00", "00"];
    return { year: m[1], month: MONTHS[Number(m[2]) - 1], day: String(Number(m[3])), hour: m[4], minute: m[5] };
  }

  function dayKeyMV(iso) {
    return String(iso || "").slice(0, 10);
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // Mirrors derive() + portal_record() in render_site.py.
  function toRecord(e) {
    var end = e.end || e.start;
    var s = partsOf(e.start);
    var en = partsOf(end);
    var sk = dayKeyMV(e.start);
    var ek = dayKeyMV(end);
    var dates;
    if (sk === ek) dates = Number(s.day) + " " + s.month + " " + s.year + ", " + s.hour + ":" + s.minute;
    else if (sk.slice(0, 7) === ek.slice(0, 7)) dates = Number(s.day) + "–" + Number(en.day) + " " + s.month + " " + s.year;
    else dates = Number(s.day) + " " + s.month + " " + s.year + " – " + Number(en.day) + " " + en.month + " " + en.year;
    function rows(list, fmt) {
      return (list || []).map(fmt);
    }
    return {
      slug: e.slug,
      kind: e.kind || "",
      title: e.title || "(untitled)",
      summary: e.summary || "",
      offer: e.offer_line || "",
      dates: dates,
      month: s.month + " " + s.year,
      city: e.city || "",
      venue: e.venue || "",
      place: e.venue === "Online" ? "Online" : (e.venue || "") + ", " + (e.city || ""),
      address: e.address || "",
      directions: e.directions || "",
      invited: (Number(e.capacity) || 0) + " invited",
      seats: e.seats || "",
      state: e.state || "",
      price: e.price || "No public price",
      provider: e.provider || "No ticket seller",
      ticket: e.ticket || "",
      group: ek >= todayKey() ? "Upcoming" : "Earlier",
      lifecycle: e.lifecycle || "pending",
      offers: rows(e.offers, function (x) { return x[0] + " · " + x[1] + " — " + x[2]; }),
      schedule: rows(e.schedule, function (x) { return x[0] + " — " + x[1] + ". " + x[2]; }),
      people: rows(e.people, function (x) { return x[0] + " — " + x[1]; }),
      facts: rows(e.facts, function (x) { return x[0] + ": " + x[1]; }),
      faq: rows(e.faq, function (x) { return x[0] + " — " + x[1]; }),
      language: e.language || "",
      audience: e.audience || "",
      included: e.included || [],
      notes: e.notes || [],
      start: e.start,
      end: end,
      featured: !!e.featured,
      listed: e.listed !== false,
      waitlist: !!e.waitlist,
      invite: e.invite_code || "",
      badges: e.badges || []
    };
  }

  function reindex() {
    CONTENT.events = CONTENT.events || [];
    RECORDS = CONTENT.events.map(toRecord);
    BY = {};
    EVT = {};
    RECORDS.forEach(function (r) {
      BY[r.slug] = r;
    });
    CONTENT.events.forEach(function (e) {
      EVT[e.slug] = e;
    });
  }

  // Ticketing view of an event, in the shape js/tickets.js expects.
  function ticketing(slug) {
    var e = EVT[slug];
    if (!e) return null;
    return {
      slug: e.slug, title: e.title, mode: e.mode || "external", pool: Number(e.pool) || 0,
      max: Number(e.max_per_order) || 6, types: e.types || [], questions: e.questions || [],
      waitlist: !!e.waitlist, invite: e.invite_code || "", start: e.start, end: e.end
    };
  }

  function readDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      return d && Array.isArray(d.events) ? d : null;
    } catch (e) {
      return null;
    }
  }

  (function () {
    var draft = readDraft();
    if (draft) CONTENT = draft;
    reindex();
  })();

  var LIFE = {
    published: "Live",
    pending: "Awaiting approval",
    draft: "Rejected",
    archived: "Archived"
  };
  var MODE = {
    site: (T.BRAND || "MDV") + " checkout",
    rsvp: "Invitation",
    external: "Organizer site",
    closed: "Sales closed"
  };

  // Remembered between renders so filters survive a refresh of the view.
  var state = {
    events: { q: "", life: "", mode: "", kind: "", city: "", when: "upcoming" },
    orders: { q: "", event: "", kind: "", status: "" },
    door: "",
    doorQ: "",
    attendeeQ: ""
  };

  /* ================================================================
   * Small helpers
   * ================================================================ */

  function parseJSON(node) {
    try {
      var data = JSON.parse(node ? node.textContent : "[]");
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function append(node, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) {
      kid.forEach(function (k) {
        append(node, k);
      });
    } else if (typeof kid === "string" || typeof kid === "number") {
      node.appendChild(document.createTextNode(String(kid)));
    } else {
      node.appendChild(kid);
    }
  }

  // h("tag", {class, text, onclick, attr...}, children...)
  function h(tag, props) {
    var node = document.createElement(tag);
    var value = null;
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "value") value = v;
      else if (k === "checked") node.checked = !!v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i += 1) append(node, arguments[i]);
    if (value !== null) node.value = value; // after <option>s exist
    return node;
  }

  function button(label, onclick, cls) {
    return h("button", { type: "button", class: "btn " + (cls || "quiet"), onclick: onclick }, label);
  }

  function link(label, href, cls) {
    return h("a", { class: cls || "btn quiet", href: href }, label);
  }

  function pill(text, tone) {
    return h("span", { class: "pill" + (tone ? " pill-" + tone : "") }, text);
  }

  function bar(pct, tone) {
    pct = Math.max(0, Math.min(100, pct || 0));
    return h("span", { class: "progress" + (tone ? " is-" + tone : ""), role: "img", "aria-label": pct + "%" },
      h("span", { style: "width:" + pct + "%" }));
  }

  function panel(title, body, extra) {
    return h("section", { class: "panel" + (extra ? " " + extra : "") },
      title ? h("div", { class: "panel-head" }, h("h2", { text: title })) : null,
      body);
  }

  function empty(text, action) {
    return h("div", { class: "desk-empty" }, h("p", { text: text }), action || null);
  }

  function select(options, value, onchange, label) {
    var node = h("select", { class: "select", onchange: onchange, "aria-label": label || null },
      options.map(function (o) {
        return h("option", { value: o[0] }, o[1]);
      }));
    node.value = value;
    return node;
  }

  function field(label, control) {
    return h("label", { class: "field" }, h("span", { text: label }), control);
  }

  function money(n, cur) {
    return T.money(n || 0, cur);
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many || one + "s");
  }

  function daysUntil(iso) {
    var start = new Date(iso);
    var today = new Date();
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.round((start - today) / 86400000);
  }

  function whenLabel(iso) {
    var d = daysUntil(iso);
    if (d < 0) return d === -1 ? "Yesterday" : Math.abs(d) + " days ago";
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d < 60) return "In " + d + " days";
    return "In " + Math.round(d / 30) + " months";
  }

  function dateBlock(iso) {
    var d = new Date(iso);
    return h("span", { class: "date-block" },
      h("span", { text: d.toLocaleString("en-GB", { month: "short" }) }),
      h("strong", { text: String(d.getDate()) }));
  }

  function thumb(slug) {
    return h("img", { class: "thumb", src: "images/opt/" + slug + "-640.webp", alt: "", loading: "lazy" });
  }

  function user() {
    return CURRENT ? CURRENT.name : "Someone";
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function csvCell(v) {
    v = String(v === undefined || v === null ? "" : v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // keep spreadsheets from running formulas
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function csv(rows) {
    return rows.map(function (r) {
      return r.map(csvCell).join(",");
    }).join("\r\n");
  }

  /* ================================================================
   * Data: listings, lifecycle, stats, activity
   * ================================================================ */

  function life(slug) {
    return S.statusOf(slug, BY[slug] ? BY[slug].lifecycle : "published");
  }

  function lifeReason(slug) {
    var row = S.readConfig().lifecycle[slug];
    if (row && row.reason) return row.reason;
    var e = EVT[slug];
    return e && e.review && e.review.reason ? e.review.reason : "";
  }

  function isHidden(slug) {
    return S.readConfig().hidden.indexOf(slug) !== -1 || (EVT[slug] && EVT[slug].listed === false);
  }

  function featuredSlug() {
    var chosen = S.readConfig().featured;
    if (chosen && EVT[chosen]) return chosen;
    var def = RECORDS.filter(function (r) {
      return r.featured;
    })[0];
    return def ? def.slug : "";
  }

  function isUpcoming(r) {
    return r.group === "Upcoming";
  }

  function mode(slug) {
    var c = ticketing(slug);
    return c ? c.mode : "external";
  }

  function lifeTone(status) {
    return { published: "paid", pending: "refund_requested", draft: "declined", archived: "" }[status] || "";
  }

  // Older builds kept approvals in this browser only. Clear those so the
  // published content is what everyone sees.
  function clearOverride(change) {
    var config = S.readConfig();
    change(config);
    S.writeConfig(config);
  }

  function setLife(slug, status, reason) {
    var before = life(slug);
    var e = EVT[slug];
    e.lifecycle = status;
    e.review = { status: status, reason: reason || "", at: nowISO(), by: user() };
    clearOverride(function (c) {
      delete c.lifecycle[slug];
    });
    var verbs = { published: "Approved", draft: "Rejected", pending: "Put on hold", archived: "Archived" };
    var verb = before === "archived" && status === "published" ? "Restored" : verbs[status];
    logActivity(verb + " " + e.title + (reason ? ": " + reason : ""), "#events/" + slug + "/overview");
    saveContent(e.title + ": " + LIFE[status].toLowerCase() + ".");
  }

  function setHidden(slug, hidden) {
    var e = EVT[slug];
    e.listed = !hidden;
    clearOverride(function (c) {
      c.hidden = c.hidden.filter(function (s) { return s !== slug; });
    });
    logActivity((hidden ? "Hid " : "Showed ") + e.title + " on the public lists", "#events/" + slug + "/overview");
    saveContent(hidden ? e.title + " is hidden from the public lists." : e.title + " is back on the public lists.");
  }

  function setFeatured(slug) {
    CONTENT.events.forEach(function (e) {
      e.featured = e.slug === slug;
    });
    clearOverride(function (c) {
      c.featured = "";
    });
    logActivity(slug ? "Featured " + EVT[slug].title + " on the homepage" : "Reset the homepage feature", slug ? "#events/" + slug + "/overview" : "#settings/homepage");
    saveContent(slug ? EVT[slug].title + " is the homepage feature." : "Homepage feature reset.");
  }

  /* ---------------- saving and publishing ---------------- */

  var busy = false;

  function setBusy(on) {
    busy = on;
    desk.classList.toggle("is-busy", on);
    paintPublish();
  }

  function saveContent(message, after) {
    CONTENT.updated = nowISO();
    reindex();
    if (!SERVER) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(CONTENT));
      toast(message + " Saved as a draft in this browser. Start serve.py to publish.");
      paintPublish();
      refresh();
      if (after) after(true);
      return;
    }
    setBusy(true);
    fetch("api/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-MDV-Desk": "1" },
      body: JSON.stringify(CONTENT)
    }).then(function (r) {
      return r.json().then(function (j) {
        return { ok: r.ok && j.ok, j: j };
      });
    }).then(function (res) {
      setBusy(false);
      if (res.ok) {
        localStorage.removeItem(DRAFT_KEY);
        PUBLISHED_AT = res.j.updated || nowISO();
        toast(message + " Published, and the site was rebuilt.");
      } else {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(CONTENT));
        toast("Not published: " + (res.j.error || "the build failed") + " Your changes are kept as a draft.");
        if (res.j.output && window.console) console.warn(res.j.output);
      }
      paintPublish();
      refresh();
      if (after) after(res.ok);
    }).catch(function () {
      setBusy(false);
      SERVER = false;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(CONTENT));
      toast("The publishing server did not answer. Your changes are saved as a draft.");
      paintPublish();
      refresh();
      if (after) after(false);
    });
  }

  function publishDraft() {
    saveContent("Draft published.");
  }

  function discardDraft() {
    if (!window.confirm("Discard every unpublished change in this browser?")) return;
    localStorage.removeItem(DRAFT_KEY);
    CONTENT = clone(EMBEDDED);
    reindex();
    logActivity("Discarded the unpublished draft");
    toast("Draft discarded.");
    if (SERVER) {
      fetch("api/content", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
        CONTENT = d;
        reindex();
        paintPublish();
        refresh();
      });
    }
    paintPublish();
    refresh();
  }

  function exportContent() {
    T.download("content.json", JSON.stringify(CONTENT, null, 2), "application/json");
    toast("Downloaded content.json. Put it in data/ and run render_site.py to publish by hand.");
  }

  var publishBox = null;

  function paintPublish() {
    if (!publishBox) {
      publishBox = h("div", { class: "publish-state", "aria-live": "polite" });
      var top = desk.querySelector(".desk-top");
      top.insertBefore(publishBox, top.querySelector(".desk-search"));
    }
    publishBox.textContent = "";
    var draft = !!readDraft();
    var label;
    var tone;
    if (busy) {
      label = "Publishing…";
      tone = "busy";
    } else if (SERVER && !draft) {
      label = "Live" + (PUBLISHED_AT ? " · published " + T.fmtDateTime(PUBLISHED_AT) : "");
      tone = "live";
    } else if (SERVER && draft) {
      label = "Unpublished changes";
      tone = "draft";
    } else {
      label = draft ? "Draft only · not connected" : "Read only · not connected";
      tone = "offline";
    }
    publishBox.className = "publish-state is-" + tone;
    publishBox.appendChild(h("span", { class: "dot", "aria-hidden": "true" }));
    publishBox.appendChild(h("span", { text: label }));
    if (draft && SERVER && !busy && canEdit()) publishBox.appendChild(button("Publish", publishDraft, "signal"));
    if (draft && !busy && canEdit()) publishBox.appendChild(button("Discard", discardDraft));
    if (!SERVER) publishBox.title = "Run python serve.py and open http://127.0.0.1:8000/portal.html to publish from the desk.";
  }

  function eventStats(slug) {
    var s = { sold: 0, revenue: 0, refunded: 0, refundAmt: 0, tickets: 0, checked: 0, waiting: 0, orders: 0, left: null, pct: null };
    T.readOrders().forEach(function (o) {
      if (o.slug !== slug) return;
      if (o.kind === "waitlist") {
        if (o.status === "waiting") s.waiting += 1;
        return;
      }
      if (o.status === "refunded") {
        s.refunded += 1;
        s.refundAmt += o.total - (o.fee || 0);
        return;
      }
      if (!T.isLive(o)) return;
      s.orders += 1;
      o.lines.forEach(function (l) {
        if (l.seat) s.sold += l.qty;
      });
      s.revenue += o.total;
      s.tickets += o.tickets.length;
      s.checked += o.tickets.filter(function (t) {
        return t.checkedIn;
      }).length;
    });
    var cat = ticketing(slug);
    if (cat && cat.mode === "site") {
      s.left = T.seatsLeft(cat);
      s.pct = s.sold + s.left ? Math.round((100 * s.sold) / (s.sold + s.left)) : 0;
    }
    return s;
  }

  // The published seat line is fixed at build time; events sold here count live.
  function seatLine(r) {
    var cat = ticketing(r.slug);
    if (!cat || cat.mode !== "site") return r.seats;
    var left = T.seatsLeft(cat);
    return left === 0 ? "Sold out" : plural(left, "seat") + " left";
  }

  function salesCell(r) {
    var m = mode(r.slug);
    var s = eventStats(r.slug);
    if (m === "site") {
      return h("div", { class: "sales-cell" },
        h("span", { text: s.sold + " sold · " + s.left + " left" }),
        bar(s.pct, s.left === 0 ? "good" : s.left <= 5 ? "warn" : ""));
    }
    if (m === "rsvp") return h("span", { text: s.sold + " confirmed" });
    if (m === "external") return h("span", { class: "meta", text: r.seats + " · on " + r.provider });
    return h("span", { class: "meta", text: "Sales closed" });
  }

  function readActivity() {
    try {
      var list = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function logActivity(text, href) {
    var list = readActivity();
    list.unshift({ at: nowISO(), who: user(), text: text, href: href || "" });
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(list.slice(0, 100)));
  }

  // Staff actions plus customer events (orders, invitations, waitlist joins).
  function feed(limit) {
    var items = readActivity().slice();
    T.readOrders().forEach(function (o) {
      var text = o.kind === "order" ? "New order " + o.id + " · " + o.title + " · " + money(o.total, ocur(o))
        : o.kind === "rsvp" ? o.buyer.name + " confirmed an invitation to " + o.title
        : o.buyer.name + " joined the waitlist for " + o.title;
      items.push({ at: o.created, who: o.kind === "order" ? "Checkout" : "Public site", text: text, href: "#orders/" + o.id });
      if (o.refundAsked) items.push({ at: o.refundAsked, who: o.buyer.name, text: "Refund requested on " + o.id, href: "#orders/" + o.id });
    });
    items.sort(function (a, b) {
      return a.at < b.at ? 1 : -1;
    });
    return items.filter(canSeeEntry).slice(0, limit || 12);
  }

  /* ================================================================
   * Needs attention: the desk's to-do list
   * ================================================================ */

  function readDismissed() {
    try {
      var list = JSON.parse(sessionStorage.getItem(DISMISS_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function dismiss(id) {
    var list = readDismissed();
    if (list.indexOf(id) === -1) list.push(id);
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(list));
    refresh();
  }

  function attention() {
    var items = [];
    if (readDraft() && canEdit()) {
      items.push({ id: "draft-" + (readDraft().updated || ""), tone: "warn", title: SERVER ? "Unpublished changes" : "Draft not published",
        detail: SERVER ? "Changes saved in this browser are not on the site yet." : "Start serve.py to publish, or export content.json.",
        action: SERVER ? "Review" : "Export", href: SERVER ? "#settings/data" : "#settings/data" });
    }
    T.readOrders().forEach(function (o) {
      if (o.status === "refund_requested") {
        items.push({ id: "refund-" + o.id, tone: "warn", title: "Refund requested", detail: o.buyer.name + " · " + o.title + " · " + money(o.total, ocur(o)), action: "Review", href: "#orders/" + o.id });
      }
    });
    RECORDS.forEach(function (r) {
      var status = life(r.slug);
      if (status === "pending") {
        items.push({ id: "pending-" + r.slug, tone: "info", title: "Waiting for approval", detail: r.title + " · " + r.dates, action: "Review", href: "#approvals" });
      }
      if (status === "draft") {
        items.push({ id: "draft-" + r.slug, tone: "bad", title: "Rejected listing", detail: r.title + (lifeReason(r.slug) ? " · " + lifeReason(r.slug) : ""), action: "Open", href: "#events/" + r.slug + "/overview" });
      }
      if (!isUpcoming(r) || status !== "published") return;
      var s = eventStats(r.slug);
      var m = mode(r.slug);
      if (s.waiting) {
        items.push({ id: "wait-" + r.slug + "-" + s.waiting, tone: "info", title: plural(s.waiting, "person", "people") + " on the waitlist", detail: r.title, action: "Open waitlist", href: "#orders?kind=waitlist&event=" + r.slug });
      }
      if (m === "site" && s.left === 0) {
        items.push({ id: "soldout-" + r.slug, tone: "good", title: "Sold out", detail: r.title + (sees("money") ? " · " + money(s.revenue, curOf(r.slug)) : ""), action: "Tickets", href: "#events/" + r.slug + "/tickets" });
      } else if (m === "site" && s.left <= 5) {
        items.push({ id: "low-" + r.slug + "-" + s.left, tone: "warn", title: "Only " + plural(s.left, "seat") + " left", detail: r.title, action: "Tickets", href: "#events/" + r.slug + "/tickets" });
      }
      var d = daysUntil(r.start);
      if (d >= 0 && d <= 21 && (m === "site" || m === "rsvp")) {
        items.push({ id: "soon-" + r.slug, tone: "info", title: "Starts " + whenLabel(r.start).toLowerCase(), detail: r.title + " · " + plural(s.tickets, "guest") + " on the door list", action: "Guest list", href: "#events/" + r.slug + "/attendees" });
      }
    });
    var gone = readDismissed();
    return items.filter(function (i) {
      return gone.indexOf(i.id) === -1 && can(routeOf(i.href));
    });
  }

  function paintBadges() {
    paintBell();
    var counts = {
      home: attention().length,
      approvals: RECORDS.filter(function (r) {
        return life(r.slug) === "pending";
      }).length,
      orders: T.readOrders().filter(function (o) {
        return o.status === "refund_requested";
      }).length
    };
    Object.keys(counts).forEach(function (k) {
      var node = desk.querySelector('[data-badge="' + k + '"]');
      if (!node) return;
      node.textContent = String(counts[k]);
      node.hidden = counts[k] === 0;
    });
  }

  /* ================================================================
   * Shell: toasts, dialog, header, routing
   * ================================================================ */

  /* ---------------- Toasts and the notification centre ----------------
   * toast(message, tone, href) shows a short alert and keeps it in the
   * notification history. Tone is guessed from the wording when not given:
   * success, error, warning, or info.
   */
  var NOTICE_KEY = "mdv-desk-notices";
  var SEEN_KEY = "mdv-desk-seen";
  var TOAST_ICONS = {
    success: '<path d="m5 12 4 4 10-10"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>',
    warning: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    order: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>'
  };

  function svgIcon(name) {
    var span = h("span", { class: "n-icon", "aria-hidden": "true" });
    span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (TOAST_ICONS[name] || TOAST_ICONS.info) + "</svg>";
    return span;
  }

  function toneOf(message) {
    var m = String(message);
    if (/^not |did not|failed|could not|invalid|not valid|wrong|missing|error|denied|declined\b(?!\. The buyer)/i.test(m)) return "error";
    if (/keep at least|first\.|draft|deleted|cleared|discard|deactivat|remove/i.test(m)) return "warning";
    if (/published|saved|added|approved|checked in|sent|resent|emailed|exported|downloaded|updated|created|switched|welcome|restored/i.test(m)) return "success";
    return "info";
  }

  function readNotices() {
    try {
      return JSON.parse(localStorage.getItem(NOTICE_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function recordNotice(text, tone, href) {
    var list = readNotices();
    list.unshift({ at: nowISO(), who: user(), tone: tone, text: text, href: href || "" });
    localStorage.setItem(NOTICE_KEY, JSON.stringify(list.slice(0, 60)));
  }

  function toast(message, tone, href) {
    tone = tone || toneOf(message);
    recordNotice(message, tone, href);
    var box = desk.querySelector("[data-toasts]");
    var life = tone === "error" ? 9000 : tone === "warning" ? 6500 : 4800;
    var bar = h("span", { class: "toast-bar" });
    var item = h("div", { class: "toast toast-" + tone, role: tone === "error" ? "alert" : "status" },
      svgIcon(tone),
      h("div", { class: "toast-body" },
        h("strong", { text: { success: "Done", error: "Something went wrong", warning: "Heads up", info: "Note" }[tone] || "Note" }),
        h("p", { text: message }),
        href ? h("a", { class: "toast-link", href: href, onclick: function () { item.remove(); }, text: "Open" }) : null),
      h("button", { type: "button", class: "toast-x", "aria-label": "Dismiss", onclick: function () { item.remove(); }, text: "×" }),
      bar);
    bar.style.animationDuration = life + "ms";
    box.appendChild(item);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    var timer = null;
    var left = life;
    var started = Date.now();
    function arm() {
      started = Date.now();
      timer = setTimeout(function () {
        if (item.parentNode) {
          item.classList.add("is-leaving");
          setTimeout(function () { item.remove(); }, 200);
        }
      }, left);
    }
    item.addEventListener("mouseenter", function () {
      clearTimeout(timer);
      left -= Date.now() - started;
      item.classList.add("is-paused");
    });
    item.addEventListener("mouseleave", function () {
      item.classList.remove("is-paused");
      arm();
    });
    arm();
    paintBell();
  }

  // Everything that happened: alerts shown here, staff actions, and customer activity.
  function noticeKind(n) {
    if (n.kind) return n.kind;
    if (/order|refund|checkout/i.test(n.text + " " + n.who)) return "orders";
    if (n.who === "Public site" || /waitlist|invitation/i.test(n.text)) return "orders";
    if (/signed in|signed out|switched|viewing as|user|role|password|profile/i.test(n.text)) return "team";
    return "system";
  }

  function allNotices() {
    var seen = {};
    var out = [];
    readNotices().forEach(function (n) {
      out.push({ at: n.at, who: n.who, text: n.text, href: n.href, tone: n.tone });
      seen[n.text + n.at.slice(0, 16)] = 1;
    });
    feed(40).forEach(function (f) {
      if (seen[f.text + String(f.at).slice(0, 16)]) return;
      var tone = /refund requested/i.test(f.text) ? "warning" : /new order/i.test(f.text) ? "order" : f.who === "Public site" ? "people" : "info";
      out.push({ at: f.at, who: f.who, text: f.text, href: f.href, tone: tone });
    });
    out.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    return out.slice(0, 60);
  }

  function seenAt() {
    try {
      return (JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"))[CURRENT ? CURRENT.id : ""] || "";
    } catch (e) {
      return "";
    }
  }

  function markSeen() {
    var map = {};
    try {
      map = JSON.parse(localStorage.getItem(SEEN_KEY) || "{}");
    } catch (e) {}
    if (CURRENT) map[CURRENT.id] = nowISO();
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  }

  function unreadCount() {
    var since = seenAt();
    return allNotices().filter(function (n) { return n.at > since && n.who !== user(); }).length;
  }

  var bellBtn = null;
  var bellPop = null;
  var bellFilter = "all";

  function paintBell() {
    if (!bellBtn || !CURRENT) return;
    var n = unreadCount();
    var alerts = attention().length;
    var badge = bellBtn.querySelector(".bell-count");
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = n === 0;
    bellBtn.classList.toggle("has-alerts", alerts > 0 && n === 0);
    bellBtn.setAttribute("aria-label", "Notifications" + (n ? ", " + n + " new" : "") + (alerts ? ", " + alerts + " need attention" : ""));
    if (bellPop && !bellPop.hidden) paintBellPop();
  }

  function paintBellPop() {
    var since = seenAt();
    bellPop.textContent = "";
    var alerts = attention();
    var list = allNotices();
    var tabs = [["all", "All"], ["alerts", "Alerts"], ["orders", "Orders"], ["team", "Team"], ["system", "System"]];
    var head = h("div", { class: "bell-head" },
      h("strong", { text: "Notifications" }),
      h("button", { type: "button", class: "linkish", onclick: function () { markSeen(); paintBell(); paintBellPop(); }, text: "Mark all read" }));
    var tabRow = h("div", { class: "bell-tabs", role: "tablist" }, tabs.map(function (t) {
      var count = t[0] === "alerts" ? alerts.length : t[0] === "all" ? 0 : list.filter(function (n) { return noticeKind(n) === t[0] && n.at > since; }).length;
      return h("button", { type: "button", role: "tab", "aria-selected": String(bellFilter === t[0]), class: bellFilter === t[0] ? "is-active" : "",
        onclick: function () { bellFilter = t[0]; paintBellPop(); } }, t[1], count ? h("span", { class: "bell-tab-n", text: String(count) }) : null);
    }));
    var body = h("div", { class: "bell-list" });
    if (bellFilter === "all" || bellFilter === "alerts") {
      alerts.slice(0, bellFilter === "alerts" ? 30 : 3).forEach(function (a) {
        var tone = a.tone === "bad" ? "error" : a.tone === "warn" ? "warning" : a.tone === "good" ? "success" : "info";
        body.appendChild(h("a", { class: "bell-item is-alert tone-" + tone, href: a.href, onclick: closeBell },
          svgIcon(tone), h("span", { class: "bell-text" }, h("strong", { text: a.title }), h("span", { class: "meta", text: a.detail })),
          h("span", { class: "bell-act", text: a.action })));
      });
      if (bellFilter === "all" && alerts.length > 3) {
        body.appendChild(h("button", { type: "button", class: "bell-more", onclick: function () { bellFilter = "alerts"; paintBellPop(); }, text: "All " + alerts.length + " alerts →" }));
      }
    }
    if (bellFilter !== "alerts") {
      var shown = list.filter(function (n) { return bellFilter === "all" || noticeKind(n) === bellFilter; }).slice(0, 25);
      if (shown.length && bellFilter === "all") body.appendChild(h("p", { class: "bell-sec", text: "Recent" }));
      shown.forEach(function (n) {
        var fresh = n.at > since && n.who !== user();
        var inner = [svgIcon(n.tone || "info"),
          h("span", { class: "bell-text" }, h("span", { text: n.text }), h("span", { class: "meta", text: n.who + " · " + agoText(n.at) })),
          fresh ? h("span", { class: "bell-dot", "aria-label": "New" }) : null];
        body.appendChild(n.href ? h("a", { class: "bell-item tone-" + (n.tone || "info") + (fresh ? " is-new" : ""), href: n.href, onclick: closeBell }, inner)
          : h("div", { class: "bell-item tone-" + (n.tone || "info") + (fresh ? " is-new" : "") }, inner));
      });
      if (!shown.length) body.appendChild(h("p", { class: "bell-empty", text: bellFilter === "all" ? "No other activity yet." : "Nothing here yet." }));
    } else if (!alerts.length) {
      body.appendChild(h("p", { class: "bell-empty", text: "No alerts. Everything is in order." }));
    }
    var foot = h("div", { class: "bell-foot" }, can("activity") ? h("a", { href: "#activity", onclick: closeBell, text: "Open the activity log" }) : h("span"),
      h("button", { type: "button", class: "linkish", onclick: function () {
        localStorage.removeItem(NOTICE_KEY);
        paintBellPop();
        paintBell();
      }, text: "Clear alerts history" }));
    append(bellPop, [head, tabRow, body, foot]);
  }

  function agoText(iso) {
    var s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!(s >= 0)) return T.fmtDateTime(iso);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 7 * 86400) return Math.floor(s / 86400) + " d ago";
    return T.fmtDateTime(iso);
  }

  function closeBell() {
    if (!bellPop || bellPop.hidden) return;
    bellPop.hidden = true;
    bellBtn.setAttribute("aria-expanded", "false");
    markSeen();
    paintBell();
  }

  // New orders, refund requests, and waitlist joins from other tabs raise an alert.
  var knownOrders = null;

  function watchIncoming(quiet) {
    var now = {};
    T.readOrders().forEach(function (o) { now[o.id] = o.status + "|" + (o.refundAsked || ""); });
    if (knownOrders && !quiet && CURRENT && (can("orders") || can("home"))) {
      T.readOrders().forEach(function (o) {
        var before = knownOrders[o.id];
        if (before === undefined) {
          if (o.kind === "order") toast("New order " + o.id + " · " + o.title + " · " + money(o.total, ocur(o)), "success", "#orders/" + o.id);
          else if (o.kind === "rsvp") toast(o.buyer.name + " confirmed an invitation to " + o.title, "info", "#orders/" + o.id);
          else toast(o.buyer.name + " joined the waitlist for " + o.title, "info", "#orders/" + o.id);
        } else if (before !== now[o.id] && o.status === "refund_requested") {
          toast("Refund requested on " + o.id + " by " + o.buyer.name, "warning", "#orders/" + o.id);
        }
      });
    }
    knownOrders = now;
  }

  /* ---------------- Account menu: profile, switch user, sign out ---------------- */

  var VIEW_AS_KEY = "mdv-portal-as"; // the super admin who is viewing as someone else
  var RECENT_KEY = "mdv-portal-recent";
  var acctBtn = null;
  var acctPop = null;

  function viewingAs() {
    var id = sessionStorage.getItem(VIEW_AS_KEY);
    return id ? findUser(id) : null;
  }

  function rememberAccount(u) {
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch (e) {}
    list = [u.id].concat(list.filter(function (id) { return id !== u.id; })).slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  }

  function recentAccounts() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").map(findUser).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  function setupTopActions() {
    var top = desk.querySelector(".desk-top");
    if (bellBtn) return;
    var wrap = h("div", { class: "top-actions" });
    bellBtn = h("button", { type: "button", class: "icon-btn bell", "aria-haspopup": "dialog", "aria-expanded": "false" });
    bellBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
    bellBtn.appendChild(h("span", { class: "bell-count", hidden: true }));
    bellPop = h("div", { class: "bell-pop", role: "dialog", "aria-label": "Notifications", hidden: true });
    bellBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeAcct();
      var open = bellPop.hidden;
      if (!open) return closeBell();
      bellPop.hidden = false;
      bellBtn.setAttribute("aria-expanded", "true");
      paintBellPop();
    });
    acctBtn = h("button", { type: "button", class: "acct-btn", "aria-haspopup": "menu", "aria-expanded": "false" });
    acctPop = h("div", { class: "acct-pop", role: "menu", hidden: true });
    acctBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeBell();
      if (!acctPop.hidden) return closeAcct();
      paintAcctPop();
      acctPop.hidden = false;
      acctBtn.setAttribute("aria-expanded", "true");
    });
    append(wrap, [h("div", { class: "pop-anchor" }, bellBtn, bellPop), h("div", { class: "pop-anchor" }, acctBtn, acctPop)]);
    top.appendChild(wrap);
    document.addEventListener("click", function (e) {
      var path = e.composedPath ? e.composedPath() : [];
      if (bellPop && !bellPop.hidden && path.indexOf(bellPop) === -1) closeBell();
      if (acctPop && !acctPop.hidden && path.indexOf(acctPop) === -1) closeAcct();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (bellPop && !bellPop.hidden) { closeBell(); bellBtn.focus(); }
      if (acctPop && !acctPop.hidden) { closeAcct(); acctBtn.focus(); }
    });
    setInterval(function () {
      if (desk.hidden) return;
      watchIncoming();
      paintBell();
    }, 15000);
  }

  function closeAcct() {
    if (!acctPop || acctPop.hidden) return;
    acctPop.hidden = true;
    acctBtn.setAttribute("aria-expanded", "false");
  }

  function paintAcctBtn() {
    if (!acctBtn || !CURRENT) return;
    acctBtn.textContent = "";
    append(acctBtn, [h("span", { class: avatarClass(CURRENT) + " avatar-sm", "aria-hidden": "true", text: initials(CURRENT.name) }),
      h("span", { class: "acct-name" }, h("strong", { text: CURRENT.name.split(" ")[0] }), h("span", { class: "meta", text: ROLES[CURRENT.role].label })),
      h("span", { class: "acct-caret", "aria-hidden": "true", text: "▾" })]);
    acctBtn.setAttribute("aria-label", "Account: " + CURRENT.name + ", " + ROLES[CURRENT.role].label);
    var banner = desk.querySelector("[data-view-as]");
    var boss = viewingAs();
    if (boss && !banner) {
      banner = h("div", { class: "view-as-bar", "data-view-as": "1", role: "status" });
      desk.querySelector(".desk-main").insertBefore(banner, desk.querySelector(".desk-top"));
    }
    if (banner) {
      banner.hidden = !boss;
      banner.textContent = "";
      if (boss) {
        append(banner, [h("span", { text: "You are viewing the desk as " + CURRENT.name + " (" + ROLES[CURRENT.role].label + "). Their permissions apply." }),
          button("Return to " + boss.name, function () { returnFromViewAs(); }, "signal")]);
      }
    }
  }

  function paintAcctPop() {
    acctPop.textContent = "";
    var item = function (label, note, fn, cls) {
      return h("button", { type: "button", role: "menuitem", class: "acct-item" + (cls ? " " + cls : ""), onclick: function () { closeAcct(); fn(); } },
        h("span", { text: label }), note ? h("span", { class: "meta", text: note }) : null);
    };
    append(acctPop, [
      h("div", { class: "acct-head" },
        h("span", { class: avatarClass(CURRENT) + " avatar-lg", "aria-hidden": "true", text: initials(CURRENT.name) }),
        h("div", {}, h("strong", { text: CURRENT.name }), h("p", { class: "meta", text: CURRENT.email || CURRENT.username }),
          h("span", { class: "pill", text: ROLES[CURRENT.role].label }))),
      item("My profile", "View and edit your details", function () { go("#profile"); }),
      item("Switch user", "Sign in as another person on this browser", openSwitcher),
      viewingAs() ? item("Return to " + viewingAs().name, "Leave view-as mode", returnFromViewAs) : null,
      h("hr"),
      item("Sign out", "", function () { desk.querySelector("[data-sign-out]").click(); }, "danger")
    ]);
  }

  function openSwitcher() {
    var people = (CONTENT.users || []).filter(function (u) { return u.active !== false && (!CURRENT || u.id !== CURRENT.id); });
    var recent = recentAccounts().map(function (u) { return u.id; });
    people.sort(function (a, b) {
      var ra = recent.indexOf(a.id), rb = recent.indexOf(b.id);
      if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name);
    });
    var boss = isSuper() && !viewingAs();
    var q = h("input", { class: "search", type: "search", placeholder: "Search people by name, username, or role", "aria-label": "Search people" });
    var listBox = h("div", { class: "switch-list", role: "list" });
    var pwBox = h("div", { class: "switch-pw", hidden: true });

    function paintList() {
      var term = q.value.trim().toLowerCase();
      listBox.textContent = "";
      var shown = people.filter(function (u) {
        return !term || (u.name + " " + u.username + " " + ROLES[u.role].label + " " + (u.title || "")).toLowerCase().indexOf(term) !== -1;
      });
      shown.forEach(function (u) {
        var row = h("div", { class: "switch-row", role: "listitem" },
          h("span", { class: avatarClass(u), "aria-hidden": "true", text: initials(u.name) }),
          h("span", { class: "switch-who" }, h("strong", { text: u.name }),
            h("span", { class: "meta", text: ROLES[u.role].label + " · @" + u.username + (recent.indexOf(u.id) !== -1 ? " · used recently" : "") })),
          h("span", { class: "switch-acts" },
            button("Sign in", function () { askPassword(u); }, "signal"),
            boss ? button("View as", function () { startViewAs(u); }) : null));
        listBox.appendChild(row);
      });
      if (!shown.length) listBox.appendChild(h("p", { class: "bell-empty", text: "No one matches that search." }));
    }

    function askPassword(u) {
      pwBox.hidden = false;
      pwBox.textContent = "";
      var pw = h("input", { class: "search", type: "password", autocomplete: "current-password", "aria-label": "Password for " + u.name });
      var err = h("p", { class: "form-error", role: "alert", hidden: true });
      var go2 = function () {
        passwordHash(u.username, pw.value).then(function (hash) {
          if (hash !== u.password) {
            err.textContent = "That password does not match " + u.name + "'s account.";
            err.hidden = false;
            pw.select();
            return;
          }
          switchTo(u);
        });
      };
      pw.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go2(); } });
      append(pwBox, [h("p", { class: "kind", text: "Sign in as " + u.name }),
        h("div", { class: "switch-pw-row" }, pw, button("Switch", go2, "signal"), button("Cancel", function () { pwBox.hidden = true; })), err]);
      pw.focus();
    }

    openDialog([
      h("div", { class: "dialog-head" }, h("div", {}, h("p", { class: "kind", text: "Account" }), h("h2", { text: "Switch user" })), button("Close", closeDialog)),
      h("p", { class: "meta", text: boss
        ? "Sign in with someone's password, or use View as to see the desk with their permissions (no password needed for a super admin)."
        : "Choose a person and enter their password. You will be signed out of " + (CURRENT ? CURRENT.name : "this account") + "." }),
      q, pwBox, listBox
    ]);
    q.addEventListener("input", paintList);
    paintList();
    q.focus();
  }

  function switchTo(u) {
    var from = CURRENT ? CURRENT.name : "";
    logActivity("Signed out (switched to " + u.name + ")");
    sessionStorage.removeItem(VIEW_AS_KEY);
    sessionStorage.removeItem(DISMISS_KEY);
    sessionStorage.setItem(SESSION_KEY, u.id);
    CURRENT = u;
    logActivity("Signed in (" + ROLES[u.role].label + ")" + (from ? ", switched from " + from : ""));
    rememberAccount(u);
    closeDialog();
    if (!can(routeBase(location.hash || "#home").split("/")[0])) history.replaceState(null, "", "#" + homeRoute());
    showDesk(u);
    toast("Switched to " + u.name + " (" + ROLES[u.role].label + ").", "success");
  }

  function startViewAs(u) {
    if (!isSuper()) return;
    var boss = CURRENT;
    logActivity("Started viewing the desk as " + u.name);
    sessionStorage.setItem(VIEW_AS_KEY, boss.id);
    sessionStorage.setItem(SESSION_KEY, u.id);
    CURRENT = u;
    closeDialog();
    if (!can(routeBase(location.hash || "#home").split("/")[0])) history.replaceState(null, "", "#" + homeRoute());
    showDesk(u);
    toast("Viewing as " + u.name + ". Use Return to " + boss.name + " to go back.", "info");
  }

  function returnFromViewAs() {
    var boss = viewingAs();
    if (!boss) return;
    var was = CURRENT ? CURRENT.name : "";
    sessionStorage.removeItem(VIEW_AS_KEY);
    sessionStorage.setItem(SESSION_KEY, boss.id);
    CURRENT = boss;
    logActivity("Stopped viewing as " + was);
    showDesk(boss);
    toast("Back to your own account, " + boss.name + ".", "success");
  }


  function openDialog(nodes) {
    var body = dialog.querySelector("[data-dialog-body]");
    body.textContent = "";
    append(body, nodes);
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener("close", function () {
    if (dialog.open) return; // another dialog opened in the meantime
    var route = parseRoute();
    if (route.parts[0] === "orders" && route.parts[1]) history.replaceState(null, "", "#orders");
  });

  dialog.addEventListener("click", function (e) {
    if (e.target === dialog) closeDialog(); // click on the backdrop
  });

  function askReason(title, hint, confirmLabel, done) {
    var input = h("textarea", { class: "search", rows: "3", maxlength: "200", placeholder: hint });
    var err = h("p", { class: "form-error", role: "alert", hidden: true });
    openDialog([
      h("p", { class: "kind", text: "Reason" }),
      h("h2", { text: title }),
      field("Shown to the organizer", input),
      err,
      h("div", { class: "admin-actions" },
        button(confirmLabel, function () {
          var reason = input.value.trim();
          if (!reason) {
            err.textContent = "Add a short reason so the organizer knows what to fix.";
            err.hidden = false;
            return;
          }
          closeDialog();
          done(reason);
        }, "signal"),
        button("Cancel", closeDialog))
    ]);
    input.focus();
  }

  function setHead(kicker, title, note) {
    desk.querySelector("[data-kicker]").textContent = kicker || "";
    desk.querySelector("[data-title]").textContent = title || "";
    desk.querySelector("[data-note]").textContent = note || "";
    document.title = title + " · Desk · " + BRAND;
  }

  function parseRoute() {
    var raw = location.hash.replace(/^#/, "") || "home";
    var bits = raw.split("?");
    var query = {};
    if (bits[1]) {
      new URLSearchParams(bits[1]).forEach(function (v, k) {
        query[k] = v;
      });
    }
    return { parts: bits[0].split("/").map(decodeURIComponent), query: query };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  var ROUTES = {
    home: renderHome,
    events: renderEventsRoute,
    approvals: renderApprovals,
    orders: renderOrders,
    checkin: renderCheckin,
    reports: renderReports,
    directory: function () { go("#venues"); },
    venues: renderVenues,
    taxonomy: renderTaxonomy,
    content: renderContent,
    customers: renderCustomers,
    users: renderUsers,
    organizers: renderOrganizers,
    analytics: renderAnalytics,
    profile: renderProfile,
    settings: renderSettings,
    activity: renderActivity
  };

  function render() {
    if (desk.hidden) return;
    var route = parseRoute();
    var name = ROUTES[route.parts[0]] ? route.parts[0] : homeRoute();
    if (name !== "directory" && !can(name)) {
      name = homeRoute();
      history.replaceState(null, "", "#" + name);
      route = parseRoute();
    }
    Array.prototype.forEach.call(desk.querySelectorAll("[data-route]"), function (a) {
      var on = a.getAttribute("data-route") === name;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    view.textContent = "";
    ROUTES[name](route);
    paintBadges();
    setMenu(false);
  }

  var lastRoute = "";

  function refresh() {
    // Re-render in place, keeping the scroll position.
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function routeBase(hash) {
    var parts = hash.replace(/^#/, "").split("?")[0].split("/");
    return parts[0] === "events" ? parts.slice(0, 2).join("/") : parts[0];
  }

  window.addEventListener("hashchange", function () {
    closeDialog();
    render();
    // Scroll up for a new page, not for a tab or a dialog on the same page.
    if (routeBase(location.hash) !== routeBase(lastRoute)) window.scrollTo(0, 0);
    lastRoute = location.hash;
  });

  /* ================================================================
   * Home
   * ================================================================ */

  function renderHome() {
    var todo = attention();
    var today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    setHead("Desk", "Home", today + " · " + (todo.length ? plural(todo.length, "thing") + " need" + (todo.length === 1 ? "s" : "") + " you" : "nothing waiting"));

    homeStats();

    var todoList = todo.length
      ? h("ul", { class: "attention" }, todo.map(function (item) {
        return h("li", { class: "att-item is-" + item.tone },
          h("span", { class: "att-dot", "aria-hidden": "true" }),
          h("div", { class: "att-body" }, h("strong", { text: item.title }), h("p", { class: "meta", text: item.detail })),
          h("div", { class: "row-actions" },
            link(item.action, item.href, "btn signal"),
            button("Dismiss", function () {
              dismiss(item.id);
            })));
      }))
      : empty("All clear. Refund requests, approvals, waitlists, and low seats show up here.");

    var upcoming = RECORDS.filter(function (r) {
      return isUpcoming(r) && life(r.slug) !== "archived";
    }).sort(function (a, b) {
      return a.start < b.start ? -1 : 1;
    });
    var next = h("ul", { class: "next-list" }, upcoming.map(function (r) {
      return h("li", {},
        h("a", { class: "next-row", href: "#events/" + r.slug + "/overview" },
          dateBlock(r.start),
          h("div", { class: "next-body" },
            h("strong", { text: r.title }),
            h("span", { class: "meta", text: whenLabel(r.start) + " · " + MODE[mode(r.slug)] + (life(r.slug) !== "published" ? " · " + LIFE[life(r.slug)] : "") }),
            sees("money") ? salesCell(r) : h("span", { class: "meta", text: r.city + " · " + r.kind }))));
    }));

    var activity = feed(8);
    var feedList = activity.length
      ? h("ul", { class: "feed" }, activity.map(function (a) {
        return h("li", {},
          h("span", { class: "feed-time", text: T.fmtDateTime(a.at) }),
          a.href ? h("a", { href: a.href, text: a.text }) : h("span", { text: a.text }),
          h("span", { class: "meta", text: a.who }));
      }))
      : empty("No activity yet.");

    view.appendChild(h("div", { class: "home-grid" },
      panel("Needs attention", todoList, "span-2"),
      panel("Coming up", next),
      h("section", { class: "panel" },
        h("div", { class: "panel-head" }, h("h2", { text: sees("team") ? "Recent activity" : "Activity for you" }), can("activity") ? link("Full log", "#activity", "text-link") : null),
        feedList)));
  }

  /*
   * The top of Home differs by role: admins see the whole operation,
   * box office sees sales and the door, editors see listings, and the
   * super admin also sees the platform. Everyone sees their own work.
   */
  function homeStats() {
    var r0 = role();
    var me = CURRENT || {};
    var ordersAll = T.readOrders();
    var totals = { revenue: 0, sold: 0, checked: 0, tickets: 0 };
    RECORDS.forEach(function (r) {
      var s = eventStats(r.slug);
      totals.revenue += toUSD(s.revenue, curOf(r.slug));
      if (mode(r.slug) === "site") totals.sold += s.sold;
      totals.checked += s.checked;
      totals.tickets += s.tickets;
    });
    var countLife = function (k) { return RECORDS.filter(function (r) { return life(r.slug) === k; }).length; };
    var live = RECORDS.filter(function (r) { return isUpcoming(r) && life(r.slug) === "published" && !isHidden(r.slug); }).length;
    var pending = countLife("pending");
    var buyers = {};
    ordersAll.forEach(function (o) { if (o.buyer && o.buyer.email) buyers[o.buyer.email.toLowerCase()] = true; });
    var refundsOpen = ordersAll.filter(function (o) { return o.status === "refund_requested"; }).length;
    var waiting = ordersAll.filter(function (o) { return o.kind === "waitlist" && o.status === "waiting"; }).length;
    var soon = RECORDS.filter(function (r) { var d = daysUntil(r.start); return d >= 0 && d <= 30 && life(r.slug) === "published"; }).length;
    var rate = totals.tickets ? Math.round((100 * totals.checked) / totals.tickets) + "%" : "—";

    var tiles = {
      revenue: ["Revenue", usdMoney(totals.revenue), "All currencies, test mode", "#reports"],
      sold: ["Tickets sold", totals.sold, "Sold on " + BRAND, "#orders"],
      live: ["Live events", live, "Upcoming and on the public lists", "#events"],
      pending: ["Awaiting approval", pending, pending ? "Review before they go live" : "Queue is clear", "#approvals"],
      customers: ["Customers", Object.keys(buyers).length, "Unique buyers and registrants", "#customers"],
      checkin: ["Check-in rate", rate, totals.checked + " of " + totals.tickets + " tickets", "#checkin"],
      refunds: ["Refund requests", refundsOpen, refundsOpen ? "Waiting for a decision" : "None open", "#orders?status=refund_requested"],
      soon: ["Next 30 days", soon, "Live events coming up", "#events"],
      waitlist: ["Waitlist", waiting, waiting ? "People waiting for a seat" : "Nobody waiting", "#orders?kind=waitlist"],
      rejected: ["Rejected", countLife("draft"), "Listings to fix and resubmit", "#events"],
      archived: ["Archived", countLife("archived"), "Past or withdrawn listings", "#events"],
      organizers: ["Organizers", (CONTENT.organizers || []).length, "Profiles on the site", "#organizers"]
    };
    var pick = function (keys) { return statGrid(keys.map(function (k) { return tiles[k]; })); };
    var ordersChart = function () {
      var perDay = {};
      ordersAll.forEach(function (o) { if (o.kind === "order") { var k = dayKeyLocal(new Date(o.created)); perDay[k] = (perDay[k] || 0) + 1; } });
      var chart = dailyColumns("Orders, last 14 days", 14, function (k) { return perDay[k] || 0; }, function (v) { return String(v); });
      if (can("analytics")) chart.querySelector(".panel-head").appendChild(link("Full analytics →", "#analytics", "text-link"));
      return chart;
    };

    if (r0 === "box_office") {
      view.appendChild(pick(["revenue", "sold", "refunds", "checkin"]));
      view.appendChild(pick(["customers", "waitlist", "soon", "live"]));
      view.appendChild(ordersChart());
    } else if (r0 === "editor") {
      view.appendChild(pick(["live", "pending", "rejected", "organizers"]));
      view.appendChild(h("div", { class: "report-grid" },
        mixBoard("Listings by status", ["published", "pending", "draft", "archived"].map(function (k) { return [LIFE[k], countLife(k)]; })),
        mixBoard("Listings by kind", countRows(function (r) { return r.kind; })),
        mixBoard("Listings by city", countRows(function (r) { return r.city; }))));
    } else {
      view.appendChild(pick(["revenue", "sold", "live", "pending"]));
      view.appendChild(pick(["customers", "checkin", "refunds", "soon"]));
      view.appendChild(ordersChart());
    }

    if (sees("platform")) {
      var users = CONTENT.users || [];
      var weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      var signedIn = {};
      readActivity().forEach(function (a) { if (a.at >= weekAgo && /^Signed in/.test(a.text)) signedIn[a.who] = true; });
      var byRole = {};
      users.forEach(function (u) { byRole[u.role] = (byRole[u.role] || 0) + 1; });
      view.appendChild(h("h2", { class: "group-title", text: "Platform" }));
      view.appendChild(statGrid([
        ["Desk users", users.length, users.filter(function (u) { return u.active === false; }).length + " deactivated", "#users"],
        ["Signed in this week", Object.keys(signedIn).length, "People who used the desk", "#activity"],
        ["Admins", (byRole.super_admin || 0) + (byRole.admin || 0), (byRole.super_admin || 0) + " super admin" + ((byRole.super_admin || 0) === 1 ? "" : "s"), "#users"],
        ["Staff", (byRole.editor || 0) + (byRole.box_office || 0) + (byRole.door || 0), plural(byRole.editor || 0, "editor") + " · " + (byRole.box_office || 0) + " box office · " + (byRole.door || 0) + " door", "#users"]
      ]));
    }

    // Your own work, for every role.
    var mine = readActivity().filter(function (a) { return a.who === me.name; });
    var monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    var work = mine.filter(function (a) { return a.at >= monthAgo && activityCat(a) !== "signin"; });
    var myCats = {};
    work.forEach(function (a) { var c = activityCat(a); myCats[c] = (myCats[c] || 0) + 1; });
    var top = Object.keys(myCats).sort(function (a, b) { return myCats[b] - myCats[a]; })[0];
    var lastIn = mine.filter(function (a) { return /^Signed in/.test(a.text); })[1];
    view.appendChild(h("h2", { class: "group-title", text: "Your activity" }));
    view.appendChild(statGrid([
      ["Your actions", work.length, "In the last 30 days", "#profile"],
      ["Top area", top ? catLabel(top) : "—", top ? myCats[top] + " of your actions" : "Nothing yet"],
      ["Last sign-in", lastIn ? T.fmtDateTime(lastIn.at) : "First visit", "Before this session"],
      ["Your role", (ROLES[r0] || {}).label || "—", "What you can open in the desk", "#profile"]
    ]));
  }

  function countRows(fn) {
    var out = {};
    RECORDS.forEach(function (r) { var k = fn(r); if (k) out[k] = (out[k] || 0) + 1; });
    return Object.keys(out).map(function (k) { return [k, out[k]]; });
  }

  /* ---------------- Activity log: categorised data table ---------------- */

  var ACTIVITY_CATS = [
    ["signin", "Sign-in", /^Signed (in|out)/],
    ["checkin", "Check-in", /^(Checked in|Undid check-in)/],
    ["orders", "Orders", /^(New order|Refunded|Approved refund|Declined refund|Resent tickets|Offered a seat|Removed .* from the waitlist|Released|Added \d+ sample orders|Deleted all orders|Refund requested)/],
    ["people", "People", /(the user |^Added .*\(|^Updated .*\(|^Deactivated |^Reactivated |^Deleted the user|Changed their password|Updated their profile|Changed their preferences)/],
    ["settings", "Settings", /(settings|^Imported content|^Reset |Discarded the unpublished draft)/],
    ["content", "Content", /(page text|the venue|the organizer|the categories|the badges)/],
    ["events", "Events", /^(Created|Edited|Approved|Rejected|Put on hold|Archived|Restored|Hid|Showed|Featured|Reset the homepage feature|Duplicated|Deleted|Changed the photo)/]
  ];
  var CAT_TONE = { signin: "", checkin: "paid", orders: "refund_requested", people: "offered", settings: "declined", content: "confirmed", events: "paid", customers: "waiting" };

  function activityCat(a) {
    if (a.who === "Checkout" || a.who === "Public site") return "customers";
    for (var i = 0; i < ACTIVITY_CATS.length; i++) if (ACTIVITY_CATS[i][2].test(a.text)) return ACTIVITY_CATS[i][0];
    return /refund requested/i.test(a.text) ? "orders" : "events";
  }

  function catLabel(k) {
    if (k === "customers") return "Customers";
    var c = ACTIVITY_CATS.filter(function (x) { return x[0] === k; })[0];
    return c ? c[1] : k;
  }

  function renderActivity() {
    setHead("Desk", "Activity log", sees("team")
      ? "Who did what, and when: staff actions and what customers did on the public site."
      : "Your own actions, plus the " + (role() === "editor" ? "event and content changes" : "orders, check-ins, and customer actions") + " your role works with.");
    state.activity = state.activity || { q: "", cat: "", who: "", period: "30", source: "", sort: "time", dir: -1 };
    state.pages = state.pages || {};
    var f = state.activity;
    var all = feed(1000).map(function (a) {
      return { at: a.at, who: a.who, text: a.text, href: a.href, cat: activityCat(a), staff: a.who !== "Checkout" && a.who !== "Public site" && (CONTENT.users || []).some(function (u) { return u.name === a.who; }) };
    });

    function inPeriod(a) {
      if (!f.period) return true;
      return a.at >= new Date(Date.now() - Number(f.period) * 86400000).toISOString();
    }
    var periodRows = all.filter(inPeriod);
    var counts = {};
    periodRows.forEach(function (a) { counts[a.cat] = (counts[a.cat] || 0) + 1; });
    var peopleActive = {};
    periodRows.forEach(function (a) { if (a.staff) peopleActive[a.who] = (peopleActive[a.who] || 0) + 1; });
    var busiest = Object.keys(peopleActive).sort(function (x, y) { return peopleActive[y] - peopleActive[x]; })[0];
    var topCat = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x]; })[0];

    view.appendChild(statGrid([
      ["Entries", periodRows.length, f.period ? "In the last " + f.period + " days" : "All time"],
      sees("team")
        ? ["Staff active", Object.keys(peopleActive).length, busiest ? "Most active: " + busiest : "No staff actions"]
        : ["Your entries", periodRows.filter(function (a) { return CURRENT && a.who === CURRENT.name; }).length, "Your own actions in this view"],
      ["Customer actions", counts.customers || 0, "Orders, registrations, waitlists"],
      ["Busiest area", topCat ? catLabel(topCat) : "—", topCat ? counts[topCat] + " entries" : "Nothing yet"]
    ]));

    var cats = ["", "events", "orders", "checkin", "content", "people", "settings", "signin", "customers"].filter(function (k) {
      return !k || sees("team") || counts[k] || (ROLE_CATS[role()] || []).indexOf(k) !== -1;
    });
    view.appendChild(h("div", { class: "chip-row", role: "group", "aria-label": "Category" }, cats.map(function (k) {
      var on = f.cat === k;
      var n = k ? counts[k] || 0 : periodRows.length;
      return h("button", { type: "button", class: "chip" + (on ? " is-active" : ""), "aria-pressed": on ? "true" : "false", onclick: function () {
        f.cat = k;
        state.pages.activity = 1;
        refresh();
      } }, (k ? catLabel(k) : "All") + " ", h("span", { class: "chip-count", text: String(n) }));
    })));

    var whoOptions = [["", "Everyone"]].concat(Object.keys(all.reduce(function (o, a) { o[a.who] = 1; return o; }, {})).sort().map(function (w) { return [w, w]; }));
    view.appendChild(h("div", { class: "toolbar" },
      field("Search", h("input", { class: "search", type: "search", value: f.q, placeholder: "Event, order, person, or action", oninput: function (e) { f.q = e.target.value; state.pages.activity = 1; paint(); } })),
      field("Person", select(whoOptions, f.who, function (e) { f.who = e.target.value; state.pages.activity = 1; paint(); })),
      field("Period", select([["1", "Today"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["", "All time"]], f.period, function (e) { f.period = e.target.value; state.pages.activity = 1; refresh(); })),
      field("Source", select([["", "Staff and customers"], ["staff", "Staff only"], ["customers", "Customers only"]], f.source, function (e) { f.source = e.target.value; state.pages.activity = 1; paint(); })),
      h("div", { class: "row-actions end" }, button("Export CSV", function () { exportActivity(current()); }))));

    var holder = h("div");
    var pager = h("div", { class: "pager-bar" });
    view.appendChild(holder);
    view.appendChild(pager);

    function current() {
      var t = f.q.trim().toLowerCase();
      return all.filter(function (a) {
        if (!inPeriod(a)) return false;
        if (f.cat && a.cat !== f.cat) return false;
        if (f.who && a.who !== f.who) return false;
        if (f.source === "staff" && !a.staff) return false;
        if (f.source === "customers" && a.staff) return false;
        return !t || (a.text + " " + a.who + " " + catLabel(a.cat)).toLowerCase().indexOf(t) !== -1;
      }).sort(function (x, y) {
        var kx = f.sort === "who" ? x.who : f.sort === "cat" ? catLabel(x.cat) : x.at;
        var ky = f.sort === "who" ? y.who : f.sort === "cat" ? catLabel(y.cat) : y.at;
        if (kx < ky) return -f.dir;
        if (kx > ky) return f.dir;
        return x.at < y.at ? 1 : -1;
      });
    }

    function sortHead(key, label) {
      var on = f.sort === key;
      return h("th", { "aria-sort": on ? (f.dir === 1 ? "ascending" : "descending") : "none" },
        h("button", { type: "button", class: "th-sort" + (on ? " is-on" : ""), onclick: function () {
          if (f.sort === key) f.dir = -f.dir;
          else { f.sort = key; f.dir = key === "time" ? -1 : 1; }
          paint();
        } }, label, h("span", { class: "sort-mark", "aria-hidden": "true", text: on ? (f.dir === 1 ? " ↑" : " ↓") : " ↕" })));
    }

    function paint() {
      var list = current();
      holder.textContent = "";
      var page = paginate(list, "activity", pager, paint);
      if (!list.length) {
        holder.appendChild(empty("No activity matches these filters."));
        return;
      }
      holder.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "admin-table activity-table" },
        h("thead", {}, h("tr", {}, sortHead("time", "When"), sortHead("cat", "Category"), h("th", { text: "What happened" }), sortHead("who", "Who"))),
        h("tbody", {}, page.map(function (a) {
          return h("tr", {},
            h("td", {}, h("span", { class: "feed-time", text: T.fmtDateTime(a.at) })),
            h("td", {}, pill(catLabel(a.cat), CAT_TONE[a.cat] || "")),
            h("td", {}, a.href ? h("a", { href: a.href, text: a.text }) : h("span", { text: a.text })),
            h("td", {}, h("span", { text: a.who }), h("span", { class: "meta", text: a.staff ? "Staff" : "Customer" })));
        })))));
    }
    paint();
  }

  function exportActivity(list) {
    var rows = [["when", "category", "what", "who", "source", "link"]];
    list.forEach(function (a) { rows.push([a.at, catLabel(a.cat), a.text, a.who, a.staff ? "staff" : "customer", a.href || ""]); });
    T.download("mdv-activity.csv", csv(rows), "text/csv");
    toast("Exported " + plural(rows.length - 1, "entry", "entries") + ".");
  }

  /* ---------------- KPI cards (Material 3 elevated cards) ----------------
   * Each card gets a leading icon in a tonal badge. The tone says what kind
   * of number it is: money and sales (primary), attendance (success),
   * things to act on (warning), refunds and problems (error), people (tertiary).
   */
  var STAT_ICONS = {
    money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
    ticket: '<path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4Z"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
    refund: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"/><circle cx="8" cy="8" r="1.5"/>',
    checkin: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="m16 11 2 2 4-4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    wait: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    calendar: '<path d="M7 3v3M17 3v3M4 9h16"/><rect x="4" y="5" width="16" height="15" rx="2"/>',
    pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.8 6.6 19.5l1.2-6L3.3 9.3l6.1-.7Z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
    megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1Z"/><path d="M17 8a5 5 0 0 1 0 8"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>'
  };

  // [pattern on the label, icon, tone]
  var STAT_KINDS = [
    [/refund/i, "refund", "error"],
    [/revenue|average order|average spend|spend/i, "money", "primary"],
    [/discount/i, "tag", "primary"],
    [/tickets?( sold)?$|^tickets/i, "ticket", "primary"],
    [/orders?$/i, "receipt", "primary"],
    [/check(ed)?[- ]in/i, "checkin", "success"],
    [/invitation/i, "mail", "tertiary"],
    [/waitlist/i, "wait", "warning"],
    [/awaiting|approval/i, "pending", "warning"],
    [/repeat/i, "repeat", "tertiary"],
    [/marketing|opt-in/i, "megaphone", "tertiary"],
    [/customer|people|staff|admin|editor|box office|super/i, "people", "tertiary"],
    [/live events|next 30|events created|event/i, "calendar", "primary"],
    [/role/i, "shield", "tertiary"],
    [/entries|actions|busiest/i, "activity", "neutral"]
  ];

  function statKind(label) {
    for (var i = 0; i < STAT_KINDS.length; i++) if (STAT_KINDS[i][0].test(label)) return STAT_KINDS[i];
    return [null, "chart", "neutral"];
  }

  function statIcon(name) {
    var span = h("span", { class: "stat-icon", "aria-hidden": "true" });
    span.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (STAT_ICONS[name] || STAT_ICONS.chart) + "</svg>";
    return span;
  }

  /* Week-on-week trend for the order-based numbers: the last 7 days
   * against the 7 days before. Matched on the card's exact label. */
  var DAY_MS = 86400000;

  function weekWindows(pick) {
    var now = Date.now();
    var cur = [], prev = [];
    T.readOrders().forEach(function (o) {
      var at = new Date(pick(o) || 0).getTime();
      if (!at) return;
      var age = now - at;
      if (age >= 0 && age < 7 * DAY_MS) cur.push(o);
      else if (age >= 7 * DAY_MS && age < 14 * DAY_MS) prev.push(o);
    });
    return [cur, prev];
  }

  function isPaid(o) {
    return o.kind === "order" && T.isLive(o);
  }

  function seatsOf(o) {
    return o.lines.filter(function (l) { return l.seat; }).reduce(function (n, l) { return n + l.qty; }, 0);
  }

  var TREND_METRICS = {
    "Revenue": [function (o) { return o.created; }, function (list) { return list.filter(isPaid).reduce(function (n, o) { return n + toUSD(o.total, ocur(o)); }, 0); }, true],
    "Tickets sold": [function (o) { return o.created; }, function (list) { return list.filter(isPaid).reduce(function (n, o) { return n + seatsOf(o); }, 0); }, true],
    "Tickets": [function (o) { return o.created; }, function (list) { return list.filter(function (o) { return T.isLive(o) && o.kind !== "waitlist"; }).reduce(function (n, o) { return n + o.lines.reduce(function (m, l) { return m + l.qty; }, 0); }, 0); }, true],
    "Orders": [function (o) { return o.created; }, function (list) { return list.filter(isPaid).length; }, true],
    "Average order": [function (o) { return o.created; }, function (list) { var p = list.filter(isPaid); return p.length ? p.reduce(function (n, o) { return n + toUSD(o.total, ocur(o)); }, 0) / p.length : 0; }, true],
    "Refunds": [function (o) { return o.refundAsked; }, function (list) { return list.length; }, false],
    "Refund requests": [function (o) { return o.refundAsked; }, function (list) { return list.length; }, false],
    "Waitlist": [function (o) { return o.created; }, function (list) { return list.filter(function (o) { return o.kind === "waitlist"; }).length; }, true],
    "Customers": [function (o) { return o.created; }, function (list, all) {
      var first = {};
      T.readOrders().forEach(function (o) {
        var e = o.buyer && o.buyer.email ? o.buyer.email.toLowerCase() : "";
        if (e && (!first[e] || o.created < first[e])) first[e] = o.created;
      });
      var ids = {};
      list.forEach(function (o) { var e = o.buyer && o.buyer.email ? o.buyer.email.toLowerCase() : ""; if (e && first[e] === o.created) ids[e] = 1; });
      return Object.keys(ids).length;
    }, true]
  };

  function weekTrend(label) {
    var m = TREND_METRICS[label];
    if (!m) return null;
    var w = weekWindows(m[0]);
    var a = m[1](w[0]), b = m[1](w[1]);
    if (!a && !b) return { text: "0%", dir: "flat", good: true };
    if (!b) return { text: "New", dir: "up", good: m[2] };
    var pct = ((a - b) / b) * 100;
    var dir = pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat";
    return { text: Math.abs(pct).toFixed(pct !== 0 && Math.abs(pct) < 10 ? 1 : 0) + "%", dir: dir, good: dir === "flat" || (dir === "up") === m[2] };
  }

  // Card: [icon tile] title ⋯ / big number + trend chip / supporting line.
  function statGrid(items) {
    return h("div", { class: "stat-grid" }, items.map(function (s) {
      var kind = statKind(s[0]);
      var trend = s[4] !== undefined ? s[4] : weekTrend(s[0]);
      var menu = h("div", { class: "kpi-menu", role: "menu", hidden: true });
      var more = h("button", { type: "button", class: "kpi-more", "aria-haspopup": "menu", "aria-expanded": "false", "aria-label": "More for " + s[0], text: "⋯" });
      var card;
      more.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var open = menu.hidden;
        Array.prototype.forEach.call(document.querySelectorAll(".kpi-menu"), function (m) { m.hidden = true; });
        Array.prototype.forEach.call(document.querySelectorAll(".kpi-more"), function (b) { b.setAttribute("aria-expanded", "false"); });
        Array.prototype.forEach.call(document.querySelectorAll(".stat.kpi.menu-open"), function (c) { c.classList.remove("menu-open"); });
        if (!open) return;
        menu.textContent = "";
        if (s[3]) menu.appendChild(h("a", { role: "menuitem", href: s[3], text: "Open details" }));
        menu.appendChild(h("button", { type: "button", role: "menuitem", text: "Copy value", onclick: function () {
          menu.hidden = true;
          var txt = s[0] + ": " + s[1] + (s[2] ? " (" + s[2] + ")" : "");
          if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast("Copied “" + txt + "”.", "success"); }, function () {});
        } }));
        if (trend) menu.appendChild(h("p", { class: "meta", text: "Trend compares the last 7 days with the 7 days before." }));
        menu.hidden = false;
        more.setAttribute("aria-expanded", "true");
        card.classList.add("menu-open");
      });
      var chip = trend ? h("span", { class: "trend trend-" + trend.dir + (trend.good ? " is-good" : " is-bad"), title: "Last 7 days vs the 7 days before" },
        trend.text, h("span", { "aria-hidden": "true", text: trend.dir === "up" ? " ▲" : trend.dir === "down" ? " ▼" : "" }),
        h("span", { class: "sr-only", text: trend.dir === "up" ? " up on last week" : trend.dir === "down" ? " down on last week" : " level with last week" })) : null;
      card = h("article", { class: "stat kpi tone-" + kind[2] + (s[3] ? " is-link" : "") },
        h("div", { class: "kpi-head" }, statIcon(kind[1]), h("p", { class: "kind" }, s[3] ? h("a", { class: "kpi-cover", href: s[3], text: s[0] }) : s[0]), more, menu),
        h("div", { class: "kpi-row" }, h("p", { class: "stat-num", text: String(s[1]) }), chip),
        h("p", { class: "meta", text: s[2] }));
      return card;
    }));
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".kpi-menu")) return;
    Array.prototype.forEach.call(document.querySelectorAll(".kpi-menu:not([hidden])"), function (m) {
      m.hidden = true;
      var c = m.closest(".stat");
      if (c) c.classList.remove("menu-open");
      var b = c && c.querySelector(".kpi-more");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  });


  /* ================================================================
   * Events: list and per-event workspace
   * ================================================================ */

  /* ================================================================
   * Region, money, and paging helpers
   * ================================================================ */

  var BRAND = T.BRAND || "MDV";
  var PAGE_KEY = "mdv-desk-page-size";

  function region() {
    return ((CONTENT.site || {}).region) || {};
  }

  function cities() {
    return region().cities || [];
  }

  function cityInfo(name) {
    return cities().filter(function (c) { return c.name === name; })[0] || null;
  }

  function curOf(slug) {
    var e = EVT[slug];
    return (e && e.currency) || (e && cityInfo(e.city) || {}).currency || region().default_currency || T.CURRENCY;
  }

  function ocur(o) {
    return o.currency || curOf(o.slug);
  }

  function rateOf(cur) {
    var c = (region().currencies || []).filter(function (x) { return x.code === cur; })[0];
    return c ? Number(c.per_usd) : (T.RATES || {})[cur];
  }

  function toUSD(n, cur) {
    var r = rateOf(cur);
    return r ? (n || 0) / r : 0;
  }

  function usdMoney(n) {
    return "≈ USD " + Math.round(n || 0).toLocaleString("en-US");
  }

  function pageSize() {
    var saved = Number(localStorage.getItem(PAGE_KEY));
    return saved || Number(((CONTENT.site || {}).listings || {}).desk_rows_per_page) || 10;
  }

  // Shows one page of `list`, and renders a pager into `box`.
  // `key` keeps each list's current page while you move around the desk.
  function paginate(list, key, box, repaint) {
    state.pages = state.pages || {};
    var size = pageSize();
    var pages = Math.max(1, Math.ceil(list.length / size));
    var current = Math.min(state.pages[key] || 1, pages);
    state.pages[key] = current;
    box.textContent = "";
    var from = (current - 1) * size;
    var to = Math.min(from + size, list.length);
    if (list.length) {
      box.appendChild(h("span", { class: "meta", text: "Showing " + (from + 1) + "–" + to + " of " + list.length }));
    }
    if (pages > 1) {
      var go2 = function (n) {
        return function () {
          state.pages[key] = n;
          repaint();
          var top = view.querySelector(".table-wrap, .approval-list, .card-grid");
          if (top) top.scrollIntoView({ block: "nearest" });
        };
      };
      var nav = h("div", { class: "pager-btns", role: "group", "aria-label": "Pages" });
      nav.appendChild(h("button", { type: "button", class: "btn quiet", disabled: current === 1, onclick: go2(current - 1), "aria-label": "Previous page" }, "←"));
      for (var i = 1; i <= pages; i++) {
        if (pages > 7 && Math.abs(i - current) > 2 && i !== 1 && i !== pages) {
          if (nav.lastChild && nav.lastChild.className !== "gap") nav.appendChild(h("span", { class: "gap", text: "…" }));
          continue;
        }
        nav.appendChild(h("button", { type: "button", class: "btn " + (i === current ? "signal" : "quiet"), "aria-current": i === current ? "page" : null, onclick: go2(i), "aria-label": "Page " + i }, String(i)));
      }
      nav.appendChild(h("button", { type: "button", class: "btn quiet", disabled: current === pages, onclick: go2(current + 1), "aria-label": "Next page" }, "→"));
      box.appendChild(nav);
    }
    box.appendChild(h("label", { class: "field inline" }, h("span", { text: "Rows per page" }),
      select([["10", "10"], ["25", "25"], ["50", "50"], ["100", "100"]], String(size), function (e) {
        localStorage.setItem(PAGE_KEY, e.target.value);
        state.pages = {};
        repaint();
      })));
    return list.slice(from, to);
  }

  /* ================================================================
   * Events list: Upcoming / Past / All, filters, pages
   * ================================================================ */

  function renderEvents(route) {
    var f = state.events;
    var tab = (route && route.query && route.query.tab) || f.tab || "upcoming";
    f.tab = tab;
    setHead("Events", "All events", "Every listing, past and upcoming. Open one to manage it.");
    var counts = { upcoming: 0, past: 0, all: RECORDS.length };
    RECORDS.forEach(function (r) { counts[isUpcoming(r) ? "upcoming" : "past"] += 1; });
    view.appendChild(h("div", { class: "list-head" },
      h("div", { class: "subnav", role: "tablist", "aria-label": "When" },
        [["upcoming", "Upcoming"], ["past", "Past"], ["all", "All"]].map(function (t) {
          return h("a", { href: "#events?tab=" + t[0], class: t[0] === tab ? "is-active" : "", role: "tab", "aria-selected": t[0] === tab ? "true" : "false" }, t[1] + " · " + counts[t[0]]);
        })),
      canEdit() ? link("+ New event", "#events/new", "btn signal") : null));
    var cityNames = [];
    var kinds = [];
    RECORDS.forEach(function (r) {
      if (cityNames.indexOf(r.city) === -1) cityNames.push(r.city);
      if (kinds.indexOf(r.kind) === -1) kinds.push(r.kind);
    });
    function set(key) {
      return function (e) {
        f[key] = e.target.value;
        state.pages.events = 1;
        paintRows();
      };
    }
    state.pages = state.pages || {};
    view.appendChild(h("div", { class: "toolbar" },
      field("Search", h("input", { class: "search", type: "search", placeholder: "Title, venue, city, or organizer", value: f.q, oninput: set("q") })),
      field("Status", select([["", "Any status"], ["published", "Live"], ["pending", "Awaiting approval"], ["draft", "Rejected"], ["archived", "Archived"], ["hidden", "Hidden"]], f.life, set("life"))),
      field("Sells by", select([["", "Any"], ["site", MODE.site], ["rsvp", MODE.rsvp], ["external", MODE.external], ["closed", MODE.closed]], f.mode, set("mode"))),
      field("Kind", select([["", "All kinds"]].concat(kinds.map(function (k) { return [k, k]; })), f.kind, set("kind"))),
      field("City", select([["", "All cities"]].concat(cityNames.map(function (c) { return [c, c]; })), f.city, set("city")))));
    var body = h("tbody");
    var pager = h("div", { class: "pager-bar" });
    var none = empty(tab === "past" ? "No past events match." : "No events match these filters.", button("Clear filters", function () {
      state.events = { q: "", life: "", mode: "", kind: "", city: "", tab: tab };
      refresh();
    }));
    view.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "admin-table click-table" },
      h("thead", {}, h("tr", {}, ["Event", "Date", "Status", "Sales"].concat(sees("money") ? ["Revenue"] : []).map(function (t) { return h("th", { text: t }); }))),
      body)));
    view.appendChild(pager);
    view.appendChild(none);

    function paintRows() {
      var q = (f.q || "").trim().toLowerCase();
      var rows = RECORDS.filter(function (r) {
        var status = life(r.slug);
        if (tab === "upcoming" && !isUpcoming(r)) return false;
        if (tab === "past" && isUpcoming(r)) return false;
        if (f.life === "hidden" ? !isHidden(r.slug) : f.life && status !== f.life) return false;
        if (f.mode && mode(r.slug) !== f.mode) return false;
        if (f.kind && r.kind !== f.kind) return false;
        if (f.city && r.city !== f.city) return false;
        var org = organizerOf(r.slug);
        return !q || (r.title + " " + r.venue + " " + r.city + " " + (org ? org.name : "")).toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) {
        // Upcoming: soonest first. Past: most recent first.
        return tab === "past" ? (a.start < b.start ? 1 : -1) : (a.start < b.start ? -1 : 1);
      });
      body.textContent = "";
      paginate(rows, "events-" + tab, pager, paintRows).forEach(function (r) {
        var status = life(r.slug);
        var href = "#events/" + r.slug + "/overview";
        var s = eventStats(r.slug);
        body.appendChild(h("tr", { onclick: function (e) { if (!e.target.closest("a")) go(href); } },
          h("td", {}, h("div", { class: "ev-cell" }, thumb(r.slug),
            h("div", {}, h("a", { class: "row-link", href: href, text: r.title }), h("span", { class: "meta", text: r.kind + " · " + r.place })))),
          h("td", {}, h("span", { text: r.dates }), h("span", { class: "meta", text: whenLabel(r.start) })),
          h("td", {}, h("div", { class: "pill-row" },
            pill(LIFE[status], lifeTone(status)),
            isHidden(r.slug) ? pill("Hidden", "declined") : null,
            featuredSlug() === r.slug ? pill("Featured", "offered") : null,
            badgePills(r.slug))),
          h("td", {}, h("span", { class: "meta", text: MODE[mode(r.slug)] }),
            isUpcoming(r) ? salesCell(r) : h("span", { class: "meta", text: s.tickets ? "Attended " + s.checked + " of " + s.tickets : "Ended" })),
          sees("money") ? h("td", { text: mode(r.slug) === "site" ? money(s.revenue, curOf(r.slug)) : "—" }) : null));
      });
      none.hidden = rows.length !== 0;
    }
    paintRows();
  }

  /* ================================================================
   * Organizers
   * ================================================================ */

  function organizerOf(slug) {
    var e = EVT[slug];
    return e && e.organizer ? (CONTENT.organizers || []).filter(function (o) { return o.id === e.organizer; })[0] || null : null;
  }

  function renderOrganizers(route) {
    CONTENT.organizers = CONTENT.organizers || [];
    var id = route.parts[1] || "";
    if (id) return organizerEditor(id === "new" ? null : CONTENT.organizers.filter(function (o) { return o.id === id; })[0]);
    setHead("Events", "Organizers", "The groups behind each event. Shown on event pages.");
    if (canEdit()) view.appendChild(h("div", { class: "row-actions" }, link("+ Add organizer", "#organizers/new", "btn signal")));
    var body = h("tbody");
    var pager = h("div", { class: "pager-bar" });
    view.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "admin-table" },
      h("thead", {}, h("tr", {}, ["Organizer", "Contact", "Events", ""].map(function (x) { return h("th", { text: x }); }))), body)));
    view.appendChild(pager);
    function paint() {
      body.textContent = "";
      paginate(CONTENT.organizers, "organizers", pager, paint).forEach(function (o) {
        var evs = RECORDS.filter(function (r) { return EVT[r.slug].organizer === o.id; });
        var up = evs.filter(isUpcoming).length;
        body.appendChild(h("tr", {},
          h("td", {}, h("strong", { text: o.name }), h("span", { class: "meta", text: (o.type || "") + (o.city ? " · " + o.city : "") })),
          h("td", {}, h("span", { text: o.email || "—" }), h("span", { class: "meta", text: [o.phone, o.website].filter(Boolean).join(" · ") })),
          h("td", { text: evs.length + " (" + up + " upcoming)" }),
          h("td", {}, canEdit() ? link("Edit", "#organizers/" + o.id, "btn quiet") : null)));
      });
    }
    paint();
  }

  function organizerEditor(o) {
    var isNew = !o;
    var d = o ? clone(o) : { id: "", name: "", type: "Community", city: (cities()[0] || {}).name || "", website: "", email: "", phone: "", about: "" };
    setHead("Events", isNew ? "New organizer" : d.name, "Organizer details appear on each of their event pages.");
    view.appendChild(link("← Organizers", "#organizers", "back-link"));
    var errors = errorBox();
    view.appendChild(h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var p = [];
      d.name = String(d.name || "").trim();
      if (!d.name) p.push("Add the organizer’s name.");
      if (d.website && !/^https:\/\//.test(d.website)) p.push("The website must start with https://.");
      if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) p.push("Check the email address.");
      if (isNew) {
        d.id = slugify(d.name);
        if (CONTENT.organizers.some(function (x) { return x.id === d.id; })) p.push("An organizer with that name already exists.");
      }
      showErrors(errors, p);
      if (p.length) return;
      if (isNew) CONTENT.organizers.push(d);
      else CONTENT.organizers[CONTENT.organizers.indexOf(o)] = d;
      logActivity((isNew ? "Added the organizer " : "Edited the organizer ") + d.name, "#organizers");
      saveContent("Saved " + d.name + ".", function () { go("#organizers"); });
    } },
      errors,
      block("o-basics", "Organizer", null, [
        row2([fieldNote("Name", textInput(d.name, function (v) { d.name = v; }), null, true),
          fieldNote("Type", select([["Community", "Community"], ["Company", "Company"], ["Nonprofit", "Nonprofit"], ["Research lab", "Research lab"], ["Training", "Training"], ["Government", "Government"], ["University", "University"]], d.type, function (e) { d.type = e.target.value; }))]),
        row2([fieldNote("City", select(cities().map(function (c) { return [c.name, c.name + ", " + c.country]; }), d.city, function (e) { d.city = e.target.value; })),
          fieldNote("Website", textInput(d.website, function (v) { d.website = v.trim(); }, { type: "url", placeholder: "https://" }))]),
        row2([fieldNote("Email", textInput(d.email, function (v) { d.email = v.trim(); }, { type: "email" })),
          fieldNote("Phone", textInput(d.phone, function (v) { d.phone = v; }, { type: "tel" }))]),
        fieldNote("About", textArea(d.about, function (v) { d.about = v; }, { rows: "3" }), "One or two sentences for event pages.")
      ]),
      editorBar(null, function () { go("#organizers"); },
        !isNew && isAdmin() ? button("Delete organizer", function () {
          var used = CONTENT.events.filter(function (ev) { return ev.organizer === o.id; }).length;
          if (used) { toast("Move its " + plural(used, "event") + " to another organizer first."); return; }
          if (!window.confirm("Delete " + o.name + "?")) return;
          CONTENT.organizers = CONTENT.organizers.filter(function (x) { return x !== o; });
          logActivity("Deleted the organizer " + o.name, "#organizers");
          saveContent("Deleted " + o.name + ".", function () { go("#organizers"); });
        }, "quiet danger") : null)));
  }

  function lifecycleActions(slug, compact) {
    if (!canEdit()) return h("p", { class: "fine", text: "Editors and admins can change the status." });
    var status = life(slug);
    var acts = [];
    if (status === "pending" || status === "draft") {
      acts.push(button("Approve and publish", function () { setLife(slug, "published"); }, "signal"));
    }
    if (status === "pending") {
      acts.push(button("Reject", function () {
        askReason("Reject " + BY[slug].title + "?", "What needs to change before it can go live", "Reject listing", function (reason) {
          setLife(slug, "draft", reason);
        });
      }));
    }
    if (status === "draft") acts.push(button("Move back to waiting", function () { setLife(slug, "pending"); }));
    if (status === "published") {
      acts.push(button("Put on hold", function () { setLife(slug, "pending"); }));
      if (!compact || !isUpcoming(BY[slug])) acts.push(button("Archive", function () { setLife(slug, "archived"); }));
    }
    if (status === "archived") acts.push(button("Restore", function () { setLife(slug, "published"); }, "signal"));
    return h("div", { class: "row-actions" }, acts);
  }

  function factsList(pairs) {
    return h("dl", { class: "kv" }, pairs.filter(function (p) {
      return p[1];
    }).map(function (p) {
      return h("div", {}, h("dt", { text: p[0] }), h("dd", {}, p[1]));
    }));
  }

  function eventOverview(r) {
    var slug = r.slug;
    var status = life(slug);
    var reason = lifeReason(slug);
    var s = eventStats(slug);
    var m = mode(slug);

    var statusBody = [
      h("p", {}, pill(LIFE[status], lifeTone(status))),
      reason ? h("p", { class: "meta", text: "Reason: " + reason }) : null,
      h("p", { class: "meta", text: {
        published: "Visible on the public site.",
        pending: "Not on the public lists until it is approved.",
        draft: "Sent back to the organizer.",
        archived: "Kept as a record. Shown under Earlier if that setting is on."
      }[status] }),
      lifecycleActions(slug),
      canEdit() ? h("hr") : null,
      canEdit() ? h("label", { class: "switch" },
        h("input", { type: "checkbox", checked: !isHidden(slug), onchange: function (e) { setHidden(slug, !e.target.checked); } }),
        " Show on the public lists") : null,
      canEdit() ? h("div", { class: "row-actions" },
        featuredSlug() === slug
          ? button("Remove homepage feature", function () { setFeatured(""); })
          : button("Feature on the homepage", function () { setFeatured(slug); })) : null
    ];

    var snapshot;
    if (m === "site") {
      snapshot = [
        h("div", { class: "mini-stats" },
          mini("Sold", s.sold), mini("Seats left", s.left), sees("money") ? mini("Revenue", money(s.revenue, curOf(slug))) : null, mini("Checked in", s.checked + " / " + s.tickets)),
        bar(s.pct, s.left === 0 ? "good" : s.left <= 5 ? "warn" : ""),
        h("p", { class: "meta", text: s.pct + "% sold" + (s.refunded ? " · " + plural(s.refunded, "refund") : "") }),
        h("div", { class: "row-actions" }, can("orders") ? link("Orders", "#orders?event=" + slug) : null, link("Guest list", "#events/" + slug + "/attendees"))
      ];
    } else if (m === "rsvp") {
      snapshot = [
        h("div", { class: "mini-stats" }, mini("Confirmed", s.sold), mini("Checked in", s.checked + " / " + s.tickets)),
        h("div", { class: "row-actions" }, link("Guest list", "#events/" + slug + "/attendees"))
      ];
    } else if (m === "external") {
      snapshot = [
        h("p", { text: "Tickets are sold on " + r.provider + ". " + BRAND + " links out and does not see these sales." }),
        r.ticket ? h("p", {}, h("a", { href: r.ticket, target: "_blank", rel: "noopener", text: r.ticket })) : null,
        s.waiting ? h("div", { class: "row-actions" }, link(plural(s.waiting, "person", "people") + " on the waitlist", "#orders?kind=waitlist&event=" + slug)) : null
      ];
    } else {
      snapshot = [h("p", { text: "Sales are closed. The page stays up as a record of the event." })];
    }

    view.appendChild(h("div", { class: "ws-grid" },
      panel("Details", [
        h("p", { text: r.summary }),
        factsList([
          ["When", r.dates + " (" + whenLabel(r.start) + ")"],
          ["Venue", r.venue],
          ["Address", h("a", { href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(r.address), target: "_blank", rel: "noopener", text: r.address })],
          ["Kind", r.kind],
          ["Sells by", MODE[m]],
          ["Seller", r.provider],
          ["Price", r.price],
          ["Seats", seatLine(r)],
          ["Invited", r.invited],
          ["Language", r.language]
        ])
      ]),
      h("div", { class: "ws-side" },
        panel("Status and visibility", statusBody),
        panel("Sales", snapshot))));
  }

  function mini(label, value) {
    return h("div", { class: "mini" }, h("span", { text: label }), h("strong", { text: String(value) }));
  }

  function eventTickets(r) {
    var cat = ticketing(r.slug);
    var m = mode(r.slug);
    if (m === "site") {
      var sold = T.soldByType(r.slug);
      var rows = cat.types.map(function (t) {
        var left = T.typeLeft(cat, t);
        var n = sold[t.id] || 0;
        return h("tr", {},
          h("td", {}, h("strong", { text: t.label }), h("span", { class: "meta", text: (t.seat ? "Seat" : "Add-on") + (t.note ? " · " + t.note : "") })),
          h("td", { text: money(t.price, curOf(r.slug)) }),
          h("td", { text: String(n) }),
          h("td", { text: t.seat || typeof t.limit === "number" ? String(left) : "—" }),
          h("td", { text: money(n * t.price, curOf(r.slug)) }),
          h("td", {}, left === 0 ? pill("Sold out", "declined") : pill("On sale", "paid")));
      });
      var s = eventStats(r.slug);
      view.appendChild(panel("Ticket types", [
        h("div", { class: "table-wrap" }, h("table", { class: "admin-table" },
          h("thead", {}, h("tr", {}, ["Type", "Price", "Sold", "Left", "Gross", "Status"].map(function (x) { return h("th", { text: x }); }))),
          h("tbody", {}, rows))),
        factsList([
          ["Seat pool", s.left + " left · " + s.sold + " sold"],
          ["Max per order", cat.max + " seats"],
          ["Currency", curOf(r.slug)],
          ["Booking fee", (T.FEE_PERCENT || 0) + "% of the order"],
          ["Promo codes", Object.keys(T.PROMOS).map(function (k) { return k + " (" + Math.round(T.PROMOS[k] * 100) + "% off)"; }).join(", ")],
          ["Buyer questions", (cat.questions || []).map(function (q) { return q.label; }).join("; ") || "None"]
        ]),
        h("p", { class: "fine", text: "Prototype: ticket types and prices are set in render_site.py (TICKETING). In the live desk they are edited here." })
      ]));
      return;
    }
    if (m === "rsvp") {
      var st = eventStats(r.slug);
      view.appendChild(panel("Invitation", [
        factsList([
          ["Invitation code", h("code", { text: cat.invite })],
          ["Confirmed", String(st.sold)],
          ["Invited", r.invited],
          ["Price", "Free"]
        ]),
        h("p", { class: "fine", text: "Guests confirm on the event page with the code printed on the invitation." })
      ]));
      return;
    }
    var w = eventStats(r.slug).waiting;
    view.appendChild(panel(m === "external" ? "Sold by the organizer" : "Sales closed", [
      factsList([
        ["Seller", r.provider],
        ["Ticket link", r.ticket ? h("a", { href: r.ticket, target: "_blank", rel: "noopener", text: r.ticket }) : "None"],
        ["Price", r.price],
        ["Seat line", r.seats],
        ["Waitlist", cat && cat.waitlist ? plural(w, "person", "people") + " waiting" : "Off"]
      ]),
      canEdit() ? h("p", { class: "fine" }, "To sell this event here, open ", h("a", { href: "#events/" + r.slug + "/edit", text: "Edit" }), " → Tickets and choose " + BRAND + " checkout.") : null
    ]));
  }

  function attendeesOf(slug) {
    var rows = [];
    T.readOrders().forEach(function (o) {
      if (o.slug !== slug || o.kind === "waitlist") return;
      o.tickets.forEach(function (t) {
        rows.push({ o: o, t: t });
      });
    });
    return rows;
  }

  function setChecked(code, on) {
    var list = T.readOrders();
    var hit = null;
    list.forEach(function (o) {
      o.tickets.forEach(function (t) {
        if (t.code === code) {
          t.checkedIn = on ? nowISO() : null;
          hit = t;
        }
      });
    });
    T.writeOrders(list);
    if (hit) logActivity((on ? "Checked in " : "Undid check-in for ") + hit.holder + " (" + code + ")");
    return hit;
  }

  function guestTable(slug, q, compact) {
    q = (q || "").trim().toLowerCase();
    var rows = attendeesOf(slug).filter(function (x) {
      return !q || (x.t.holder + " " + x.t.code + " " + x.o.buyer.email + " " + x.o.id).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) {
      return a.t.holder.localeCompare(b.t.holder);
    });
    if (!rows.length) return empty(q ? "Nobody matches." : "No guests yet.");
    return h("div", { class: "table-wrap" }, h("table", { class: "admin-table" },
      h("thead", {}, h("tr", {}, (compact ? ["Guest", "Ticket", "Door"] : ["Guest", "Ticket", "Code", "Order", "Door"]).map(function (x) { return h("th", { text: x }); }))),
      h("tbody", {}, rows.map(function (x) {
        var live = T.isLive(x.o);
        var door = !live
          ? pill(T.statusLabel(x.o.status), "declined")
          : x.t.checkedIn
            ? h("div", { class: "row-actions" }, pill("In " + new Date(x.t.checkedIn).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), "paid"), button("Undo", function () { setChecked(x.t.code, false); refresh(); }))
            : button("Check in", function () { setChecked(x.t.code, true); toast("Checked in " + x.t.holder + "."); refresh(); }, "signal");
        var cells = [
          h("td", {}, h("strong", { text: x.t.holder }), h("span", { class: "meta", text: x.o.buyer.email })),
          h("td", { text: x.t.label })
        ];
        if (!compact) {
          cells.push(h("td", {}, h("code", { text: x.t.code })));
          cells.push(h("td", {}, h("a", { href: "#orders/" + x.o.id, text: x.o.id })));
        }
        cells.push(h("td", {}, door));
        return h("tr", { class: live ? "" : "is-void" }, cells);
      }))));
  }

  function exportGuests(slug) {
    var rows = [["name", "ticket", "code", "order", "buyer_email", "buyer_phone", "status", "checked_in"]];
    attendeesOf(slug).forEach(function (x) {
      rows.push([x.t.holder, x.t.label, x.t.code, x.o.id, x.o.buyer.email, x.o.buyer.phone, x.o.status, x.t.checkedIn || ""]);
    });
    T.download(slug + "-guests.csv", csv(rows), "text/csv");
    toast("Exported " + plural(rows.length - 1, "guest") + ".");
  }

  function eventAttendees(r) {
    var m = mode(r.slug);
    if (m !== "site" && m !== "rsvp") {
      view.appendChild(panel("Attendees", empty(m === "external"
        ? "The guest list is held by " + r.provider + ". Ask them for the door list, or sell this event here."
        : "Sales are closed and no guest list is held here.")));
      return;
    }
    var s = eventStats(r.slug);
    var holder = h("div");
    var search = h("input", { class: "search", type: "search", placeholder: "Name, email, code, or order", value: state.attendeeQ, oninput: function (e) {
      state.attendeeQ = e.target.value;
      holder.textContent = "";
      holder.appendChild(guestTable(r.slug, state.attendeeQ));
    } });
    holder.appendChild(guestTable(r.slug, state.attendeeQ));
    view.appendChild(panel("Guest list", [
      h("div", { class: "toolbar slim" },
        field("Search", search),
        h("div", { class: "row-actions" }, button("Export CSV", function () { exportGuests(r.slug); }), link("Open door mode", "#checkin?event=" + r.slug, "btn signal"))),
      h("p", { class: "meta", text: s.checked + " of " + plural(s.tickets, "guest") + " checked in" }),
      bar(s.tickets ? Math.round((100 * s.checked) / s.tickets) : 0, "good"),
      holder
    ]));
  }

  function listBlock(title, items) {
    if (!items || !items.length) return null;
    return [h("h3", { text: title }), h("ul", { class: "plain-list" }, items.map(function (i) { return h("li", { text: i }); }))];
  }

  function eventProgramme(r) {
    view.appendChild(h("div", { class: "ws-grid" },
      panel("Schedule", h("ol", { class: "timeline" }, r.schedule.map(function (line) {
        var bits = line.split(" — ");
        return h("li", {}, h("span", { class: "feed-time", text: bits[0] }), h("span", { text: bits.slice(1).join(" — ") }));
      }))),
      h("div", { class: "ws-side" },
        panel("What’s on", listBlock("Offers", r.offers)),
        r.people && r.people.length ? panel("People", listBlock("On the day", r.people)) : null)));
  }

  function eventContent(r) {
    view.appendChild(panel("Public page text", [
      h("p", { class: "fine", text: "This is what the public page says. Prototype: edit it in render_site.py and run the build. In the live desk this tab is the editor, with a preview before publishing." }),
      h("h3", { text: "Summary" }), h("p", { text: r.summary }),
      h("h3", { text: "Who it’s for" }), h("p", { text: r.audience }),
      h("h3", { text: "Directions" }), h("p", { text: r.directions }),
      listBlock("Included", r.included),
      listBlock("Good to know", r.facts),
      listBlock("Practical notes", r.notes),
      listBlock("Questions", r.faq),
      h("div", { class: "row-actions" }, h("a", { class: "btn signal", href: "events/" + r.slug + ".html", target: "_blank", rel: "noopener" }, "Preview public page ↗"))
    ]));
  }

  /* ================================================================
   * Approvals
   * ================================================================ */

  function renderApprovals(route) {
    var tab = route.query.tab || "pending";
    setHead("Events", "Approvals", "New and changed listings wait here until someone approves them.");
    var tabs = [["pending", "Waiting"], ["draft", "Rejected"], ["published", "Live"], ["archived", "Archived"]];
    view.appendChild(h("div", { class: "subnav", role: "tablist" }, tabs.map(function (t) {
      var n = RECORDS.filter(function (r) { return life(r.slug) === t[0]; }).length;
      return h("a", { href: "#approvals?tab=" + t[0], class: t[0] === tab ? "is-active" : "", role: "tab", "aria-selected": t[0] === tab ? "true" : "false" }, t[1] + " · " + n);
    })));
    var list = RECORDS.filter(function (r) {
      return life(r.slug) === tab;
    }).sort(function (a, b) {
      return a.start < b.start ? -1 : 1;
    });
    if (!list.length) {
      view.appendChild(empty(tab === "pending" ? "Nothing is waiting for approval." : "Nothing here."));
      return;
    }
    view.appendChild(h("div", { class: "approval-list" }, list.map(function (r) {
      var reason = lifeReason(r.slug);
      return h("article", { class: "approval-card" },
        h("img", { src: "images/opt/" + r.slug + "-640.webp", alt: "", loading: "lazy" }),
        h("div", { class: "approval-body" },
          h("p", { class: "kind", text: r.kind + " · " + r.dates + " · " + whenLabel(r.start) }),
          h("h2", {}, h("a", { href: "#events/" + r.slug + "/overview", text: r.title })),
          h("p", { class: "clamp", text: r.summary }),
          h("p", { class: "meta", text: r.place + " · " + MODE[mode(r.slug)] + " · " + r.price }),
          reason ? h("p", { class: "reason", text: "Reason: " + reason }) : null,
          h("div", { class: "row-actions" },
            lifecycleActions(r.slug, true),
            h("a", { class: "btn quiet", href: "events/" + r.slug + ".html", target: "_blank", rel: "noopener" }, "Preview ↗"))));
    })));
  }

  /* ================================================================
   * Orders
   * ================================================================ */

  function orderAction(o, action) {
    var done = {
      refund: function () {
        if (!window.confirm("Refund " + money(o.total, ocur(o)) + " to " + o.buyer.name + "? Their tickets stop working.")) return false;
        T.updateOrder(o.id, function (x) { x.status = "refunded"; x.refunded = nowISO(); });
        logActivity("Refunded " + o.id + " · " + money(o.total, ocur(o)), "#orders/" + o.id);
        toast(o.id + " refunded. The seats are back on sale.");
      },
      approveRefund: function () {
        T.updateOrder(o.id, function (x) { x.status = "refunded"; x.refunded = nowISO(); });
        logActivity("Approved refund on " + o.id + " · " + money(o.total - (o.fee || 0), ocur(o)), "#orders/" + o.id);
        toast("Refund approved. " + money(o.total - (o.fee || 0), ocur(o)) + " goes back to the buyer.");
      },
      declineRefund: function () {
        T.updateOrder(o.id, function (x) { x.status = "paid"; x.refundDeclined = nowISO(); });
        logActivity("Declined refund on " + o.id, "#orders/" + o.id);
        toast("Refund declined. The buyer gets an email with the reason (simulated).");
      },
      resend: function () {
        logActivity("Resent tickets for " + o.id + " to " + o.buyer.email, "#orders/" + o.id);
        toast("Tickets resent to " + o.buyer.email + " (simulated).");
      },
      releaseRsvp: function () {
        T.updateOrder(o.id, function (x) { x.status = "declined"; });
        logActivity("Released " + o.buyer.name + "’s invitation to " + o.title, "#orders/" + o.id);
        toast(o.buyer.name + "’s place was released.");
      },
      offer: function () {
        T.updateOrder(o.id, function (x) { x.status = "offered"; x.offered = nowISO(); });
        logActivity("Offered a seat to " + o.buyer.name + " (" + o.title + ")", "#orders/" + o.id);
        toast("Offer emailed to " + o.buyer.email + " with a 24-hour link (simulated).");
      },
      removeWait: function () {
        T.updateOrder(o.id, function (x) { x.status = "cancelled"; });
        logActivity("Removed " + o.buyer.name + " from the waitlist for " + o.title, "#orders/" + o.id);
        toast(o.buyer.name + " removed from the waitlist.");
      }
    }[action]();
    if (done === false) return;
    if (parseRoute().parts[0] === "orders") history.replaceState(null, "", "#orders");
    closeDialog();
    refresh();
  }

  function orderButtons(o) {
    var b = [];
    if (o.kind === "order" && o.status === "paid") {
      b.push(button("Refund", function () { orderAction(o, "refund"); }));
      b.push(button("Resend tickets", function () { orderAction(o, "resend"); }));
    }
    if (o.status === "refund_requested") {
      b.push(button("Approve refund", function () { orderAction(o, "approveRefund"); }, "signal"));
      b.push(button("Decline", function () { orderAction(o, "declineRefund"); }));
    }
    if (o.kind === "rsvp" && (o.status === "confirmed" || o.status === "pending")) {
      b.push(button("Release place", function () { orderAction(o, "releaseRsvp"); }));
    }
    if (o.kind === "waitlist" && o.status === "waiting") {
      b.push(button("Offer a seat", function () { orderAction(o, "offer"); }, "signal"));
      b.push(button("Remove", function () { orderAction(o, "removeWait"); }));
    }
    return b;
  }

  function kindLabel(o) {
    return o.kind === "order" ? "Order" : o.kind === "rsvp" ? "Invitation" : "Waitlist";
  }

  function statusTone(s) {
    return s;
  }

  function renderOrders(route) {
    var f = state.orders;
    ["event", "kind", "status", "q"].forEach(function (k) {
      if (route.query[k] !== undefined) f[k] = route.query[k];
    });
    setHead("Ticketing", "Orders", "Orders, invitations, refund requests, and the waitlist.");
    var all = T.readOrders();
    function count(test) {
      return all.filter(test).length;
    }
    var chips = [
      ["All", { kind: "", status: "" }, all.length],
      ["Refund requests", { kind: "", status: "refund_requested" }, count(function (o) { return o.status === "refund_requested"; })],
      ["Paid", { kind: "order", status: "paid" }, count(function (o) { return o.status === "paid"; })],
      ["Invitations", { kind: "rsvp", status: "" }, count(function (o) { return o.kind === "rsvp"; })],
      ["Waitlist", { kind: "waitlist", status: "" }, count(function (o) { return o.kind === "waitlist"; })]
    ];
    var chipRow = h("div", { class: "chip-row", role: "group", "aria-label": "Quick filters" }, chips.map(function (c) {
      var on = f.kind === c[1].kind && f.status === c[1].status;
      return h("button", { type: "button", class: "chip" + (on ? " is-active" : ""), "aria-pressed": on ? "true" : "false", onclick: function () {
        f.kind = c[1].kind;
        f.status = c[1].status;
        history.replaceState(null, "", "#orders");
        refresh();
      } }, c[0] + " ", h("span", { class: "chip-count", text: String(c[2]) }));
    }));
    view.appendChild(chipRow);

    function set(key) {
      return function (e) {
        f[key] = e.target.value;
        paint();
      };
    }
    view.appendChild(h("div", { class: "toolbar" },
      field("Search", h("input", { class: "search", type: "search", placeholder: "Order, name, email, or ticket code", value: f.q, oninput: set("q") })),
      field("Event", select([["", "All events"]].concat(RECORDS.map(function (r) { return [r.slug, r.title]; })), f.event, set("event"))),
      field("Type", select([["", "All types"], ["order", "Orders"], ["rsvp", "Invitations"], ["waitlist", "Waitlist"]], f.kind, set("kind"))),
      field("Status", select([["", "Any status"], ["paid", "Paid"], ["refund_requested", "Refund requested"], ["refunded", "Refunded"], ["confirmed", "Confirmed"], ["declined", "Declined"], ["cancelled", "Cancelled"], ["waiting", "Waiting"], ["offered", "Seat offered"]], f.status, set("status"))),
      h("div", { class: "row-actions end" }, button("Export CSV", exportOrders))));

    var countLine = h("p", { class: "meta count-line" });
    var body = h("tbody");
    var none = all.length
      ? empty("No orders match these filters.")
      : empty("No orders yet. Buy a ticket on Night Market Walk or Reef Dawn, or add sample orders.", button("Add sample orders", addSamples, "signal"));
    view.appendChild(countLine);
    view.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "admin-table click-table orders-table" },
      h("thead", {}, h("tr", {}, ["Order", "Event", "Buyer", "Items", "Total", "Status", ""].map(function (x) { return h("th", { text: x }); }))),
      body)));
    view.appendChild(none);

    function paint() {
      var q = f.q.trim().toLowerCase();
      var list = T.readOrders().filter(function (o) {
        if (f.event && o.slug !== f.event) return false;
        if (f.kind && o.kind !== f.kind) return false;
        if (f.status && o.status !== f.status) return false;
        if (!q) return true;
        return [o.id, o.buyer.name, o.buyer.email, o.title].concat(o.tickets.map(function (t) { return t.code + " " + t.holder; })).join(" ").toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) {
        return a.created < b.created ? 1 : -1;
      });
      body.textContent = "";
      list.forEach(function (o) {
        var used = o.tickets.filter(function (t) { return t.checkedIn; }).length;
        body.appendChild(h("tr", { onclick: function (e) { if (!e.target.closest("button, a")) go("#orders/" + o.id); } },
          h("td", {}, h("a", { class: "row-link", href: "#orders/" + o.id, text: o.id }), h("span", { class: "meta", text: T.fmtDateTime(o.created) })),
          h("td", {}, h("span", { text: o.title }), h("span", { class: "meta", text: kindLabel(o) })),
          h("td", {}, h("span", { text: o.buyer.name }), h("span", { class: "meta", text: o.buyer.email })),
          h("td", {}, h("span", { text: o.lines.map(function (l) { return l.qty + " × " + l.label; }).join(", ") }),
            o.tickets.length ? h("span", { class: "meta", text: used + "/" + o.tickets.length + " checked in" }) : null),
          h("td", {}, o.total ? money(o.total, ocur(o)) : "—", o.promo ? h("span", { class: "meta", text: o.promo }) : null),
          h("td", {}, pill(T.statusLabel(o.status), statusTone(o.status))),
          h("td", {}, h("div", { class: "row-actions" }, orderButtons(o)))));
      });
      countLine.textContent = plural(list.length, "record") + (list.length !== all.length ? " of " + all.length : "");
      none.hidden = list.length !== 0;
    }
    paint();

    if (route.parts[1]) {
      var hit = all.filter(function (o) { return o.id === route.parts[1]; })[0];
      if (hit) showOrder(hit);
    }
  }

  function showOrder(o) {
    var r = BY[o.slug] || { title: o.title, dates: "" };
    var timeline = [["Created", o.created], ["Refund requested", o.refundAsked], ["Refund declined", o.refundDeclined], ["Refunded", o.refunded], ["Seat offered", o.offered]]
      .filter(function (x) { return x[1]; })
      .map(function (x) { return h("li", {}, h("span", { class: "feed-time", text: T.fmtDateTime(x[1]) }), h("span", { text: x[0] })); });
    var answers = Object.keys(o.answers || {}).filter(function (k) { return o.answers[k]; });
    openDialog([
      h("div", { class: "dialog-head" },
        h("div", {}, h("p", { class: "kind", text: kindLabel(o) + " · " + o.id }), h("h2", { text: r.title }), h("p", { class: "meta", text: r.dates })),
        h("button", { type: "button", class: "btn quiet", onclick: closeDialog, "aria-label": "Close" }, "Close")),
      h("p", {}, pill(T.statusLabel(o.status), statusTone(o.status))),
      factsList([
        ["Buyer", o.buyer.name],
        ["Email", h("a", { href: "mailto:" + o.buyer.email, text: o.buyer.email })],
        ["Phone", o.buyer.phone],
        ["Payment", o.kind === "order" ? (o.method === "mobile" ? "Mobile money" : "Card") + " · " + (o.payment || "") : ""],
        ["Marketing", o.kind === "order" ? (o.news ? "Opted in" : "No") : ""]
      ]),
      o.kind === "order" ? h("table", { class: "admin-table lines" }, h("tbody", {},
        o.lines.map(function (l) { return h("tr", {}, h("td", { text: l.qty + " × " + l.label }), h("td", { text: money(l.qty * l.price, ocur(o)) })); }),
        h("tr", {}, h("td", { text: "Discount" + (o.promo ? " (" + o.promo + ")" : "") }), h("td", { text: o.discount ? "− " + money(o.discount, ocur(o)) : "—" })),
        h("tr", {}, h("td", { text: "Booking fee" }), h("td", { text: money(o.fee, ocur(o)) })),
        h("tr", { class: "total" }, h("td", { text: "Total" }), h("td", { text: money(o.total, ocur(o)) })))) : null,
      answers.length ? [h("h3", { text: "Buyer notes" }), h("ul", { class: "plain-list" }, answers.map(function (k) { return h("li", { text: o.answers[k] }); }))] : null,
      o.tickets.length ? [h("h3", { text: "Tickets" }), h("ul", { class: "plain-list tickets-mini" }, o.tickets.map(function (t) {
        return h("li", {}, h("strong", { text: t.holder }), " · " + t.label + " · ", h("code", { text: t.code }),
          t.checkedIn ? h("span", { class: "meta", text: " · in at " + T.fmtDateTime(t.checkedIn) }) : null);
      }))] : null,
      h("h3", { text: "History" }),
      h("ul", { class: "feed" }, timeline),
      h("div", { class: "admin-actions" }, orderButtons(o))
    ]);
  }

  function exportOrders() {
    var rows = [["order", "created", "event", "type", "status", "buyer", "email", "phone", "items", "currency", "total", "promo", "ticket_codes", "checked_in"]];
    T.readOrders().forEach(function (o) {
      rows.push([o.id, o.created, o.title, o.kind, o.status, o.buyer.name, o.buyer.email, o.buyer.phone,
        o.lines.map(function (l) { return l.qty + "x " + l.label; }).join("; "), ocur(o), o.total, o.promo || "",
        o.tickets.map(function (t) { return t.code; }).join(" "),
        o.tickets.filter(function (t) { return t.checkedIn; }).length]);
    });
    T.download("mdv-orders.csv", csv(rows), "text/csv");
    toast("Exported " + plural(rows.length - 1, "record") + ".");
  }

  function addSamples() {
    // Fictional buyers with East African phone numbers, spread over three weeks.
    var people = [
      ["Wanjiku Kamau", "+254 712 000 101"], ["Brian Otieno", "+254 722 000 102"], ["Aisha Nakato", "+256 772 000 103"],
      ["Joseph Mwakyusa", "+255 754 000 104"], ["Claudine Uwase", "+250 788 000 105"], ["Hana Bekele", "+251 911 000 106"],
      ["Kevin Mutua", "+254 733 000 107"], ["Esther Namubiru", "+256 701 000 108"], ["Dawit Alemu", "+251 912 000 109"],
      ["Neema Massawe", "+255 765 000 110"], ["Patrick Habimana", "+250 783 000 111"], ["Faith Chebet", "+254 740 000 112"]
    ];
    var plan = [
      ["pipelines-with-python", { standard: 2 }, "paid", 19, "mobile"],
      ["pipelines-with-python", { student: 1, "laptop-hire": 1 }, "paid", 15, "mobile"],
      ["sql-for-analysts-addis", { standard: 2 }, "paid", 12, "card"],
      ["pipelines-with-python", { standard: 1 }, "refund_requested", 10, "card"],
      ["intro-data-visualisation-online", { standard: 1 }, "paid", 8, "mobile"],
      ["sql-for-analysts-addis", { standard: 1 }, "refunded", 7, "mobile"],
      ["intro-data-visualisation-online", { standard: 2 }, "paid", 5, "card"],
      ["kampala-ml-meetup-rainfall", null, "confirmed", 4, ""],
      ["dar-open-data-hackathon", null, "confirmed", 3, ""],
      ["pipelines-with-python", { standard: 1 }, "paid", 2, "mobile"],
      ["responsible-ai-policy-forum", null, "waiting", 1, ""],
      ["responsible-ai-policy-forum", null, "waiting", 0, ""]
    ];
    var added = 0;
    plan.forEach(function (p, i) {
      var ev = ticketing(p[0]);
      if (!ev) return;
      var who = people[i % people.length];
      var created = new Date(Date.now() - p[3] * 86400000 - (i % 5) * 3600000).toISOString();
      var base = { id: T.orderId(), slug: ev.slug, title: ev.title, status: p[2], created: created, currency: curOf(ev.slug), news: i % 3 === 0,
        buyer: { name: who[0], email: who[0].toLowerCase().replace(/\s+/g, ".") + "@example.com", phone: who[1] }, answers: {} };
      if (p[2] === "refund_requested") base.refundAsked = new Date(Date.now() - 3600000).toISOString();
      if (ev.mode === "site") {
        var fits = Object.keys(p[1]).every(function (k) { return p[1][k] <= T.typeLeft(ev, T.typeBy(ev, k)); });
        if (!fits) return;
        var price = T.priceOf(ev, p[1], "");
        var tickets = [];
        price.lines.forEach(function (l) {
          if (!l.seat) return;
          for (var k = 0; k < l.qty; k += 1) {
            tickets.push({ code: T.ticketCode(), holder: k === 0 ? who[0] : who[0].split(" ")[0] + " guest " + k, type: l.type, label: l.label, checkedIn: null });
          }
        });
        base.kind = "order";
        base.lines = price.lines;
        base.subtotal = price.sub;
        base.discount = 0;
        base.fee = price.fee;
        base.total = price.total;
        base.method = p[4] || "card";
        base.payment = "test_sample";
        base.tickets = tickets;
        if (p[2] === "refunded") base.refunded = created;
      } else if (ev.mode === "rsvp") {
        base.kind = "rsvp";
        base.lines = [{ type: "invite", label: "Invitation", qty: 1, price: 0, seat: true }];
        base.total = 0;
        base.tickets = [{ code: T.ticketCode(), holder: who[0], type: "invite", label: "Invitation", checkedIn: null }];
      } else {
        base.kind = "waitlist";
        base.lines = [{ type: "waitlist", label: "Seats wanted", qty: 1 + (i % 2), price: 0, seat: true }];
        base.total = 0;
        base.tickets = [];
      }
      var list = T.readOrders(); // re-read so stock checks see earlier samples
      list.push(base);
      T.writeOrders(list);
      added += 1;
    });
    logActivity("Added " + added + " sample orders", "#orders");
    toast("Added " + plural(added, "sample order") + ".");
    refresh();
  }

  /* ================================================================
   * Door check-in
   * ================================================================ */

  function doorEvents() {
    return RECORDS.filter(function (r) {
      var m = mode(r.slug);
      return m === "site" || m === "rsvp";
    }).sort(function (a, b) {
      return a.start < b.start ? -1 : 1;
    });
  }

  function checkInCode(slug, code) {
    code = code.trim().toUpperCase();
    var list = T.readOrders();
    var found = null;
    list.forEach(function (o) {
      o.tickets.forEach(function (t) {
        if (t.code === code) found = { o: o, t: t };
      });
    });
    if (!found) return ["bad", "No ticket with code " + code + ". Check the letters, or look the guest up by name below."];
    if (found.o.slug !== slug) return ["bad", "Wrong event. This ticket is for " + found.o.title + "."];
    if (!T.isLive(found.o)) return ["bad", "Do not admit. This ticket was " + T.statusLabel(found.o.status).toLowerCase() + "."];
    if (found.t.checkedIn) return ["warn", "Already used at " + T.fmtDateTime(found.t.checkedIn) + " by " + found.t.holder + "."];
    setChecked(code, true);
    return ["ok", "Admit " + found.t.holder + " · " + found.t.label];
  }

  function renderCheckin(route) {
    var events = doorEvents();
    if (route.query.event) state.door = route.query.event;
    if (!state.door || !BY[state.door]) {
      var soon = events.filter(function (r) { return daysUntil(r.start) >= 0; })[0];
      state.door = (soon || events[0] || {}).slug || "";
    }
    setHead("Ticketing", "Door check-in", "Scan or type the ticket code. Every code works once.");
    if (!events.length) {
      view.appendChild(empty("No event sells here or takes registrations, so there is no door list."));
      return;
    }
    var r = BY[state.door];
    var s = eventStats(state.door);
    var input = h("input", { class: "search door-input", name: "code", placeholder: (BRAND.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5) || "TIX") + "-XXXX-XXXX", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", "aria-label": "Ticket code" });
    var result = h("p", { class: "checkin-result", "aria-live": "assertive" });
    var form = h("form", { class: "door-form", onsubmit: function (e) {
      e.preventDefault();
      if (!input.value.trim()) return;
      var res = checkInCode(state.door, input.value);
      lastDoor = res;
      refresh();
      var again = view.querySelector(".door-input");
      if (again) again.focus();
    } }, input, h("button", { class: "btn signal", type: "submit" }, "Check in"));
    if (lastDoor) {
      result.className = "checkin-result is-" + lastDoor[0];
      result.textContent = lastDoor[1];
    }

    var guests = h("div");
    var search = h("input", { class: "search", type: "search", placeholder: "Find a guest by name or email", value: state.doorQ, oninput: function (e) {
      state.doorQ = e.target.value;
      guests.textContent = "";
      guests.appendChild(guestTable(state.door, state.doorQ, true));
    } });
    guests.appendChild(guestTable(state.door, state.doorQ, true));

    view.appendChild(h("div", { class: "door-grid" },
      panel("Door", [
        field("Event", select(events.map(function (e) { return [e.slug, e.title + " · " + e.dates]; }), state.door, function (e) {
          state.door = e.target.value;
          lastDoor = null;
          history.replaceState(null, "", "#checkin");
          refresh();
        })),
        form,
        result,
        h("p", { class: "fine", text: "Live version: the door phone scans the QR code with its camera, works offline, and syncs when it reconnects." })
      ]),
      panel("Arrivals", [
        h("p", { class: "stat-num big", text: s.checked + " / " + s.tickets }),
        bar(s.tickets ? Math.round((100 * s.checked) / s.tickets) : 0, "good"),
        h("p", { class: "meta", text: r.title + " · " + whenLabel(r.start) })
      ])));
    view.appendChild(panel("Guest list", [field("Search", search), guests]));
    setTimeout(function () { input.focus(); }, 0);
  }

  var lastDoor = null;

  /* ================================================================
   * Reports
   * ================================================================ */

  function mixBoard(title, rows) {
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat([1]));
    return panel(title, h("div", { class: "mix" }, rows.map(function (r) {
      return h("div", { class: "mix-row" },
        h("span", { text: r[0] }),
        h("span", { class: "mix-track", "aria-hidden": "true" }, h("span", { style: "width:" + Math.round((100 * r[1]) / max) + "%" })),
        h("strong", { text: String(r[1]) }),
        r[2] ? h("span", { class: "meta", text: r[2] }) : null);
    })));
  }

  function renderReports() {
    if (!sees("money")) {
      setHead("Content", "Reports", "The shape of the programme. Sales figures are for box office and admins.");
      view.appendChild(h("div", { class: "report-grid" },
        mixBoard("Listings by status", countRows(function (r) { return LIFE[life(r.slug)]; })),
        mixBoard("Listings by how they sell", countRows(function (r) { return MODE[mode(r.slug)]; })),
        mixBoard("Listings by kind", countRows(function (r) { return r.kind; })),
        mixBoard("Listings by city", countRows(function (r) { return r.city; })),
        mixBoard("Listings by organizer", countRows(function (r) { var o = organizerOf(r.slug); return o ? o.name : "No organizer"; }))));
      return;
    }
    setHead("Sales", "Reports", "Sales, refunds, and the shape of the programme. Totals across currencies are in approximate US dollars.");
    var orders = T.readOrders();
    var paid = orders.filter(function (o) { return o.kind === "order" && T.isLive(o); });
    var refunded = orders.filter(function (o) { return o.status === "refunded"; });
    var revenue = paid.reduce(function (n, o) { return n + toUSD(o.total, ocur(o)); }, 0);
    var sold = paid.reduce(function (n, o) { return n + o.lines.filter(function (l) { return l.seat; }).reduce(function (m, l) { return m + l.qty; }, 0); }, 0);
    var fees = paid.reduce(function (n, o) { return n + toUSD(o.fee || 0, ocur(o)); }, 0);
    var discounts = paid.reduce(function (n, o) { return n + toUSD(o.discount || 0, ocur(o)); }, 0);
    var tickets = 0;
    var checked = 0;
    orders.forEach(function (o) {
      if (!T.isLive(o)) return;
      tickets += o.tickets.length;
      checked += o.tickets.filter(function (t) { return t.checkedIn; }).length;
    });

    view.appendChild(statGrid([
      ["Revenue", usdMoney(revenue), usdMoney(fees) + " of it booking fees"],
      ["Tickets sold", sold, plural(paid.length, "order")],
      ["Average order", usdMoney(paid.length ? revenue / paid.length : 0), "Per paid order"],
      ["Refunds", refunded.length, usdMoney(refunded.reduce(function (n, o) { return n + toUSD(o.total - (o.fee || 0), ocur(o)); }, 0)) + " returned"],
      ["Discounts", usdMoney(discounts), plural(paid.filter(function (o) { return o.promo; }).length, "order") + " used a code"],
      ["Checked in", checked + " / " + tickets, tickets ? Math.round((100 * checked) / tickets) + "% of valid tickets" : "No tickets yet"],
      ["Invitations", orders.filter(function (o) { return o.kind === "rsvp" && T.isLive(o); }).length, "Confirmed places"],
      ["Waitlist", orders.filter(function (o) { return o.kind === "waitlist" && o.status === "waiting"; }).length, "People waiting"]
    ]));

    var rows = RECORDS.filter(function (r) {
      var m = mode(r.slug);
      return m === "site" || m === "rsvp";
    }).map(function (r) {
      var s = eventStats(r.slug);
      var m = mode(r.slug);
      return h("tr", { onclick: function () { go("#events/" + r.slug + "/overview"); } },
        h("td", {}, h("a", { class: "row-link", href: "#events/" + r.slug + "/overview", text: r.title }), h("span", { class: "meta", text: r.dates })),
        h("td", { text: MODE[m] }),
        h("td", { text: m === "rsvp" ? s.sold + " confirmed" : String(s.sold) }),
        h("td", {}, m === "site" ? h("div", { class: "sales-cell" }, h("span", { text: s.pct + "%" }), bar(s.pct)) : "—"),
        h("td", { text: m === "site" ? money(s.revenue, curOf(r.slug)) : "—" }),
        h("td", { text: m === "site" ? String(s.refunded) : "—" }),
        h("td", { text: s.tickets ? s.checked + " / " + s.tickets : "—" }));
    });
    view.appendChild(panel("By event", h("div", { class: "table-wrap" }, h("table", { class: "admin-table click-table" },
      h("thead", {}, h("tr", {}, ["Event", "Sells by", "Sold", "Sell-through", "Revenue", "Refunds", "Checked in"].map(function (x) { return h("th", { text: x }); }))),
      h("tbody", {}, rows)))));

    var byType = {};
    paid.forEach(function (o) {
      o.lines.forEach(function (l) {
        var key = o.title + " · " + l.label;
        byType[key] = byType[key] || { qty: 0, gross: 0, cur: ocur(o) };
        byType[key].qty += l.qty;
        byType[key].gross += l.qty * l.price;
      });
    });
    var typeRows = Object.keys(byType).sort().map(function (k) {
      return h("tr", {}, h("td", { text: k }), h("td", { text: String(byType[k].qty) }), h("td", { text: money(byType[k].gross, byType[k].cur) }));
    });
    var methods = { card: 0, mobile: 0 };
    paid.forEach(function (o) { methods[o.method === "mobile" ? "mobile" : "card"] += 1; });

    function countBy(fn) {
      var out = {};
      RECORDS.forEach(function (r) {
        var k = fn(r);
        out[k] = (out[k] || 0) + 1;
      });
      return Object.keys(out).map(function (k) { return [k, out[k]]; });
    }

    view.appendChild(h("div", { class: "report-grid" },
      panel("By ticket type", typeRows.length
        ? h("div", { class: "table-wrap" }, h("table", { class: "admin-table" }, h("thead", {}, h("tr", {}, ["Ticket", "Sold", "Gross"].map(function (x) { return h("th", { text: x }); }))), h("tbody", {}, typeRows)))
        : empty("No paid orders yet."), "span-2"),
      mixBoard("Payment method", [["Card", methods.card], ["Mobile money", methods.mobile]]),
      mixBoard("Listings by status", countBy(function (r) { return LIFE[life(r.slug)]; })),
      mixBoard("Listings by how they sell", countBy(function (r) { return MODE[mode(r.slug)]; })),
      mixBoard("Listings by kind", countBy(function (r) { return r.kind; })),
      mixBoard("Listings by city", countBy(function (r) { return r.city; }))));
  }

  /* ================================================================
   * Venues & categories
   * ================================================================ */

  /* ================================================================
   * Roles
   * ================================================================ */

  var ROLES = {
    super_admin: { label: "Super admin", note: "Owns the platform: everything, including admins, branding, region, and importing or replacing all content.", routes: "*" },
    admin: { label: "Admin", note: "Runs the site: events, sales, content, users (except super admins), and settings.", routes: "*" },
    editor: { label: "Editor", note: "Creates and edits events, organizers, venues, categories, badges, and page text. Approves listings. Sees reports.", routes: ["home", "events", "approvals", "organizers", "venues", "taxonomy", "content", "analytics", "reports", "activity"] },
    box_office: { label: "Box office", note: "Orders, refunds, customers, door check-in, and reports. Can view events.", routes: ["home", "events", "orders", "checkin", "customers", "analytics", "reports", "activity"] },
    door: { label: "Door staff", note: "Door check-in only.", routes: ["checkin"] }
  };
  var ROLE_ORDER = ["super_admin", "admin", "editor", "box_office", "door"];
  var CURRENT = null;

  function role() {
    return CURRENT ? CURRENT.role : "";
  }

  function can(route) {
    if (route === "profile") return !!CURRENT;
    var r = ROLES[role()];
    return !!r && (r.routes === "*" || r.routes.indexOf(route) !== -1);
  }

  function isSuper() {
    return role() === "super_admin";
  }

  function isAdmin() {
    return role() === "admin" || role() === "super_admin";
  }

  function canEdit() {
    return isAdmin() || role() === "editor";
  }

  /*
   * What each role may see on dashboards, analytics, reports, and feeds.
   *   money    - revenue, orders, customers, refunds (box office, admins)
   *   content  - listings, approvals, organizers (editors, admins)
   *   team     - other desk users' activity (admins)
   *   platform - users, roles, and site health (super admins)
   */
  function sees(what) {
    var r = role();
    if (r === "super_admin") return true;
    if (r === "admin") return what !== "platform";
    if (r === "editor") return what === "content";
    if (r === "box_office") return what === "money";
    return false;
  }

  function routeOf(href) {
    return String(href || "").replace(/^#/, "").split(/[\/?]/)[0] || "home";
  }

  // Activity a role may read beyond its own entries.
  var ROLE_CATS = { editor: ["events", "content"], box_office: ["orders", "checkin", "customers"], door: ["checkin"] };

  function canSeeEntry(a) {
    if (sees("team")) return true;
    if (CURRENT && a.who === CURRENT.name) return true;
    return (ROLE_CATS[role()] || []).indexOf(activityCat(a)) !== -1;
  }

  // Admins manage everyone except super admins; super admins manage everyone.
  function canManage(u) {
    if (isSuper()) return true;
    return isAdmin() && u.role !== "super_admin";
  }

  function assignableRoles() {
    return ROLE_ORDER.filter(function (r) { return isSuper() || r !== "super_admin"; });
  }

  function homeRoute() {
    return can("home") ? "home" : "checkin";
  }

  function applyRole() {
    var nav = desk.querySelector(".side-nav");
    Array.prototype.forEach.call(nav.querySelectorAll("[data-route]"), function (a) {
      a.hidden = !can(a.getAttribute("data-route"));
    });
    Array.prototype.forEach.call(nav.querySelectorAll(".side-label"), function (label) {
      var any = false;
      for (var n = label.nextElementSibling; n && !n.classList.contains("side-label"); n = n.nextElementSibling) {
        if (!n.hidden) any = true;
      }
      label.hidden = !any;
      if (!label.hasAttribute("data-label")) label.setAttribute("data-label", label.textContent);
      label.textContent = label.getAttribute("data-label") === "Sales" && !sees("money") ? "Insights" : label.getAttribute("data-label");
    });
    var add = desk.querySelector("[data-new-event]");
    if (add) add.hidden = !canEdit();
    Array.prototype.forEach.call(desk.querySelectorAll("[data-portal-user]"), function (node) {
      node.textContent = CURRENT ? CURRENT.name : "";
    });
    Array.prototype.forEach.call(desk.querySelectorAll("[data-portal-role]"), function (node) {
      node.textContent = CURRENT && ROLES[CURRENT.role] ? ROLES[CURRENT.role].label + (CURRENT.title ? " · " + CURRENT.title : "") : "";
    });
    var brand = desk.querySelector(".side-brand .logo");
    if (brand) brand.textContent = BRAND;
  }

  function initials(name) {
    return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("");
  }

  function lastSignIn(u) {
    var hit = readActivity().filter(function (a) { return a.who === u.name && /^Signed in/.test(a.text); })[0];
    return hit ? T.fmtDateTime(hit.at) : "Not in this browser";
  }

  /* ================================================================
   * Users & roles: people with profiles
   * ================================================================ */

  // Users & roles: a sortable, searchable data table (cards are one click away).
  function renderUsers() {
    setHead("System", "Users & roles", "Everyone who can sign in to the desk, their details, and what each role can do.");
    var users = CONTENT.users || [];
    var byRole = {};
    users.forEach(function (u) { byRole[u.role] = (byRole[u.role] || 0) + 1; });
    view.appendChild(statGrid(ROLE_ORDER.slice(0, 4).map(function (r) {
      return [{ super_admin: "Super admins", admin: "Admins", editor: "Editors", box_office: "Box office staff" }[r], byRole[r] || 0,
        r === "super_admin" ? "Platform owners" : r === "admin" ? "Run the site" : r === "editor" ? "Write and approve" : "Sales and support"];
    })));
    state.users = state.users || { q: "", role: "", status: "", sort: "role", dir: 1, view: "table" };
    state.pages = state.pages || {};
    var f = state.users;

    var viewToggle = h("div", { class: "view-toggle", role: "group", "aria-label": "View" },
      [["table", "Table"], ["cards", "Cards"]].map(function (v) {
        return h("button", { type: "button", class: f.view === v[0] ? "is-active" : "", "aria-pressed": f.view === v[0] ? "true" : "false", onclick: function () { f.view = v[0]; refresh(); } }, v[1]);
      }));
    view.appendChild(h("div", { class: "toolbar" },
      field("Search", h("input", { class: "search", type: "search", value: f.q, placeholder: "Name, email, phone, title, or organization", oninput: function (e) { f.q = e.target.value; state.pages.users = 1; paint(); } })),
      field("Role", select([["", "All roles"]].concat(ROLE_ORDER.map(function (r) { return [r, ROLES[r].label]; })), f.role, function (e) { f.role = e.target.value; state.pages.users = 1; paint(); })),
      field("Status", select([["", "Everyone"], ["active", "Active"], ["off", "Deactivated"]], f.status, function (e) { f.status = e.target.value; state.pages.users = 1; paint(); })),
      h("div", { class: "row-actions end" }, viewToggle, button("Export CSV", exportUsers), button("+ Add person", function () { userDialog(null); }, "signal"))));

    var COLS = [
      ["name", "Person"], ["username", "Username"], ["role", "Role"], ["email", "Contact"], ["country", "Country"], ["status", "Status"], ["last", "Last sign-in"], ["", ""]
    ];
    var holder = h("div");
    var pager = h("div", { class: "pager-bar" });
    view.appendChild(holder);
    view.appendChild(pager);

    function sortKey(u, key) {
      if (key === "role") return ROLE_ORDER.indexOf(u.role);
      if (key === "status") return u.active === false ? 1 : 0;
      if (key === "last") return lastSignInAt(u) || "";
      return String(u[key] || "").toLowerCase();
    }

    function paint() {
      var t = f.q.trim().toLowerCase();
      var list = users.filter(function (u) {
        if (f.role && u.role !== f.role) return false;
        if (f.status === "active" && u.active === false) return false;
        if (f.status === "off" && u.active !== false) return false;
        return !t || [u.name, u.email, u.phone, u.title, u.organization, u.country, u.username].join(" ").toLowerCase().indexOf(t) !== -1;
      }).sort(function (a, b) {
        var x = sortKey(a, f.sort);
        var y = sortKey(b, f.sort);
        if (x < y) return -f.dir;
        if (x > y) return f.dir;
        return a.name.localeCompare(b.name);
      });
      holder.textContent = "";
      var page = paginate(list, "users", pager, paint);
      if (!list.length) {
        holder.appendChild(empty("Nobody matches these filters."));
        return;
      }
      if (f.view === "cards") {
        holder.appendChild(h("div", { class: "people-grid" }, page.map(personCard)));
        return;
      }
      var head = h("tr", {}, COLS.map(function (c) {
        if (!c[0]) return h("th", { text: "" });
        var on = f.sort === c[0];
        return h("th", { "aria-sort": on ? (f.dir === 1 ? "ascending" : "descending") : "none" },
          h("button", { type: "button", class: "th-sort" + (on ? " is-on" : ""), onclick: function () {
            if (f.sort === c[0]) f.dir = -f.dir;
            else { f.sort = c[0]; f.dir = 1; }
            paint();
          } }, c[1], h("span", { class: "sort-mark", "aria-hidden": "true", text: on ? (f.dir === 1 ? " ↑" : " ↓") : " ↕" })));
      }));
      holder.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "admin-table click-table users-table" },
        h("thead", {}, head),
        h("tbody", {}, page.map(function (u) {
          var me = CURRENT && u.id === CURRENT.id;
          var manage = canManage(u);
          return h("tr", { class: u.active === false ? "is-void" : "", onclick: function (e) { if (!e.target.closest("a, button")) (manage ? userDialog(u) : userView(u)); } },
            h("td", {}, h("div", { class: "ev-cell" },
              h("span", { class: avatarClass(u), "aria-hidden": "true", text: initials(u.name) }),
              h("div", {}, h("strong", { text: u.name + (me ? " (you)" : "") }), h("span", { class: "meta", text: [u.title, u.organization].filter(Boolean).join(" · ") || "—" })))),
            h("td", {}, h("code", { text: u.username })),
            h("td", {}, pill(ROLES[u.role] ? ROLES[u.role].label : u.role, u.role === "super_admin" ? "offered" : u.role === "admin" ? "paid" : "")),
            h("td", {}, h("a", { href: "mailto:" + u.email, text: u.email }), u.phone ? h("span", { class: "meta" }, h("a", { href: "tel:" + String(u.phone).replace(/\s/g, ""), text: u.phone })) : null),
            h("td", { text: u.country || "—" }),
            h("td", {}, u.active === false ? pill("Deactivated", "declined") : pill("Active", "paid")),
            h("td", {}, h("span", { class: "meta", text: lastSignIn(u) })),
            h("td", {}, h("div", { class: "row-actions" },
              manage ? button("Edit", function () { userDialog(u); }) : button("View", function () { userView(u); }),
              manage && !me ? button(u.active === false ? "Reactivate" : "Deactivate", function () { toggleUser(u); }) : null,
              manage && !me ? button("Delete", function () { deleteUser(u); }, "quiet danger") : null)));
        })))));
    }

    function personCard(u) {
      var me = CURRENT && u.id === CURRENT.id;
      var manage = canManage(u);
      return h("article", { class: "person-card" + (u.active === false ? " is-off" : "") },
        h("div", { class: "person-head" },
          h("span", { class: avatarClass(u), "aria-hidden": "true", text: initials(u.name) }),
          h("div", {}, h("h3", { text: u.name + (me ? " (you)" : "") }), h("p", { class: "meta", text: [u.title, u.organization].filter(Boolean).join(" · ") || "—" }))),
        h("div", { class: "pill-row" }, pill(ROLES[u.role] ? ROLES[u.role].label : u.role, u.role === "super_admin" ? "offered" : u.role === "admin" ? "paid" : ""), u.active === false ? pill("Deactivated", "declined") : pill("Active", "paid")),
        h("dl", { class: "kv compact" },
          h("div", {}, h("dt", { text: "Email" }), h("dd", {}, h("a", { href: "mailto:" + u.email, text: u.email }))),
          h("div", {}, h("dt", { text: "Phone" }), h("dd", { text: u.phone || "—" })),
          h("div", {}, h("dt", { text: "Last sign-in" }), h("dd", { text: lastSignIn(u) }))),
        h("div", { class: "row-actions" }, manage ? button("Edit", function () { userDialog(u); }) : button("View", function () { userView(u); })));
    }

    paint();
    view.appendChild(panel("What each role can do", h("dl", { class: "kv" }, ROLE_ORDER.map(function (k) {
      return h("div", {}, h("dt", { text: ROLES[k].label }), h("dd", { text: ROLES[k].note }));
    }))));
    view.appendChild(h("p", { class: "fine", text: "Prototype: passwords are stored as salted SHA-256 hashes inside content.json, and sign-in is checked in the browser. A live site needs server-side accounts with a slow password hash (Argon2 or bcrypt), rate limits, and two-factor sign-in for admins." }));
  }

  function lastSignInAt(u) {
    var hit = readActivity().filter(function (a) { return a.who === u.name && /^Signed in/.test(a.text); })[0];
    return hit ? hit.at : "";
  }

  function userView(u) {
    openDialog([
      h("div", { class: "dialog-head" },
        h("div", { class: "ev-cell" }, h("span", { class: avatarClass(u) + " avatar-lg", "aria-hidden": "true", text: initials(u.name) }),
          h("div", {}, h("h2", { text: u.name }), h("p", { class: "meta", text: [u.title, u.organization].filter(Boolean).join(" · ") }))),
        button("Close", closeDialog)),
      h("div", { class: "pill-row" }, pill(ROLES[u.role].label), u.active === false ? pill("Deactivated", "declined") : pill("Active", "paid")),
      u.bio ? h("p", { text: u.bio }) : null,
      factsList([["Username", u.username], ["Email", u.email], ["Phone", u.phone], ["Country", u.country], ["Added", u.created], ["Last sign-in", lastSignIn(u)]]),
      h("p", { class: "fine", text: "Only a super admin can change this account." })
    ]);
  }

  function exportUsers() {
    var rows = [["name", "username", "role", "title", "organization", "email", "phone", "country", "status", "added", "last_sign_in_this_browser"]];
    (CONTENT.users || []).forEach(function (u) {
      rows.push([u.name, u.username, ROLES[u.role] ? ROLES[u.role].label : u.role, u.title || "", u.organization || "", u.email, u.phone || "", u.country || "", u.active === false ? "deactivated" : "active", u.created || "", lastSignInAt(u)]);
    });
    T.download("mdv-users.csv", csv(rows), "text/csv");
    toast("Exported " + plural(rows.length - 1, "person", "people") + ". Passwords are not included.");
  }

  function activeAdmins(except) {
    return (CONTENT.users || []).filter(function (u) { return (u.role === "admin" || u.role === "super_admin") && u.active !== false && u !== except; }).length;
  }

  function activeSupers(except) {
    return (CONTENT.users || []).filter(function (u) { return u.role === "super_admin" && u.active !== false && u !== except; }).length;
  }

  function toggleUser(u) {
    if (!canManage(u)) return;
    if (u.active !== false && ((u.role === "super_admin" && !activeSupers(u)) || !activeAdmins(u))) {
      toast("Keep at least one active super admin and one active admin.");
      return;
    }
    u.active = u.active === false;
    logActivity((u.active ? "Reactivated " : "Deactivated ") + u.name, "#users");
    saveContent(u.name + (u.active ? " can sign in again." : " can no longer sign in."));
  }

  function deleteUser(u) {
    if (!canManage(u)) return;
    if ((u.role === "super_admin" && !activeSupers(u)) || ((u.role === "admin" || u.role === "super_admin") && !activeAdmins(u))) {
      toast("Keep at least one active super admin and one active admin.");
      return;
    }
    if (!window.confirm("Delete " + u.name + "’s account?")) return;
    CONTENT.users = CONTENT.users.filter(function (x) { return x !== u; });
    logActivity("Deleted the user " + u.name, "#users");
    saveContent("Deleted " + u.name + ".");
  }

  function userDialog(u) {
    var isNew = !u;
    var d = u ? clone(u) : { id: "", username: "", name: "", email: "", role: "editor", active: true, title: "", organization: "", phone: "", country: "", notes: "" };
    var pw = { value: "" };
    var errors = errorBox();
    var countries = cities().map(function (c) { return c.country; }).filter(function (c, i, all) { return all.indexOf(c) === i; });
    if (d.country && countries.indexOf(d.country) === -1) countries.push(d.country);
    var form = h("form", { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var p = [];
      d.username = String(d.username || "").trim().toLowerCase();
      if (!String(d.name || "").trim()) p.push("Add a name.");
      if (!/^[a-z0-9._-]{3,30}$/.test(d.username)) p.push("Username: 3–30 lowercase letters, numbers, dots, hyphens.");
      if ((CONTENT.users || []).some(function (x) { return x !== u && x.username === d.username; })) p.push("That username is taken.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || "")) p.push("Add a valid email.");
      if (isNew && pw.value.length < 8) p.push("Set a password of at least 8 characters.");
      if (!isNew && pw.value && pw.value.length < 8) p.push("New passwords need at least 8 characters.");
      if (assignableRoles().indexOf(d.role) === -1) p.push("You cannot give someone that role.");
      if (u && u.role === "super_admin" && d.role !== "super_admin" && !activeSupers(u)) p.push("Keep at least one active super admin.");
      if (u && (u.role === "admin" || u.role === "super_admin") && d.role !== "admin" && d.role !== "super_admin" && !activeAdmins(u)) p.push("Keep at least one active admin.");
      showErrors(errors, p);
      if (p.length) return;
      var finish = function (hash) {
        if (hash) d.password = hash;
        if (isNew) {
          d.id = d.username;
          d.created = new Date().toISOString().slice(0, 10);
          d.created_by = CURRENT ? CURRENT.name : "";
          CONTENT.users.push(d);
        } else {
          Object.keys(d).forEach(function (k) { u[k] = d[k]; });
          if (CURRENT && CURRENT.id === u.id) CURRENT = u;
        }
        closeDialog();
        logActivity((isNew ? "Added " : "Updated ") + d.name + " (" + ROLES[d.role].label + ")", "#users");
        saveContent((isNew ? "Added " : "Updated ") + d.name + ".");
        applyRole();
      };
      if (pw.value) passwordHash(d.username, pw.value).then(finish);
      else finish(null);
    } },
      h("p", { class: "kind", text: isNew ? "New person" : "Edit person" }),
      h("h2", { text: isNew ? "Add someone to the desk" : d.name }),
      errors,
      row2([fieldNote("Name", textInput(d.name, function (v) { d.name = v; }), null, true),
        fieldNote("Username", textInput(d.username, function (v) { d.username = v; }, { autocomplete: "off", spellcheck: "false" }), null, true)]),
      row2([fieldNote("Job title", textInput(d.title, function (v) { d.title = v; }, { placeholder: "Content editor" })),
        fieldNote("Organization", textInput(d.organization, function (v) { d.organization = v; }))]),
      row2([fieldNote("Email", textInput(d.email, function (v) { d.email = v.trim(); }, { type: "email" }), null, true),
        fieldNote("Phone", textInput(d.phone, function (v) { d.phone = v; }, { type: "tel", placeholder: "+254 7XX XXX XXX" }))]),
      row2([fieldNote("Country", select([["", "—"]].concat(countries.map(function (c) { return [c, c]; })), d.country || "", function (e) { d.country = e.target.value; })),
        fieldNote("Role", select(assignableRoles().map(function (k) { return [k, ROLES[k].label]; }), d.role, function (e) { d.role = e.target.value; roleNote.textContent = ROLES[d.role].note; }))]),
      h("p", { class: "fine role-note", text: ROLES[d.role] ? ROLES[d.role].note : "" }),
      fieldNote("Notes", textArea(d.notes, function (v) { d.notes = v; }, { rows: "2" }), "Visible to admins only."),
      fieldNote(isNew ? "Password" : "New password", h("input", { class: "search", type: "password", autocomplete: "new-password", oninput: function (e) { pw.value = e.target.value; } }),
        isNew ? "At least 8 characters. Share it privately; they can change it after signing in." : "Leave empty to keep the current password."),
      isNew ? null : h("p", { class: "fine", text: "Added " + (d.created || "—") + (d.created_by ? " by " + d.created_by : "") + ". Last sign-in: " + lastSignIn(u) + "." }),
      h("div", { class: "admin-actions" }, h("button", { class: "btn signal", type: "submit" }, isNew ? "Add person" : "Save"), button("Cancel", closeDialog)));
    var roleNote = form.querySelector(".role-note");
    openDialog(form);
  }

  /* ================================================================
   * Form building blocks
   * ================================================================ */

  function slugify(text) {
    return String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  function textInput(value, onchange, attrs) {
    var props = { class: "search", type: "text", value: value === null || value === undefined ? "" : value };
    Object.keys(attrs || {}).forEach(function (k) { props[k] = attrs[k]; });
    props.oninput = function (e) { onchange(e.target.value); };
    return h("input", props);
  }

  function numberInput(value, onchange, attrs) {
    var props = { class: "search", type: "number", inputmode: "numeric", value: value === null || value === undefined ? "" : value };
    Object.keys(attrs || {}).forEach(function (k) { props[k] = attrs[k]; });
    props.oninput = function (e) { onchange(e.target.value === "" ? null : Number(e.target.value)); };
    return h("input", props);
  }

  function textArea(value, onchange, attrs) {
    var props = { class: "search", rows: "3" };
    Object.keys(attrs || {}).forEach(function (k) { props[k] = attrs[k]; });
    props.oninput = function (e) { onchange(e.target.value); };
    var node = h("textarea", props);
    node.value = value || "";
    return node;
  }

  /* ================================================================
   * Rich-text editor
   * Edits look like the page; what is saved is a small, safe Markdown
   * subset that render_site.py turns into HTML: paragraphs, **bold**,
   * *italic*, [links](url), "- " bullets, "1. " numbered lists.
   * Anything else (styles, scripts, fonts, images) is dropped, including
   * from pasted content.
   * ================================================================ */

  // Web, email, phone, in-page, or a page on this site (query and #anchor allowed).
  var SAFE_HREF = /^(https?:\/\/|mailto:|tel:|#|\/(?!\/)|[a-zA-Z0-9_.-][a-zA-Z0-9_.\/-]*(\?[\w=&%.,+:-]*)?(#[\w-]+)?$)/;

  function escHtml(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function mdInlineToHtml(t) {
    var out = escHtml(t);
    out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^\w*])\*(?!\s)(.+?)(?!\s)\*(?![\w*])/g, "$1<em>$2</em>");
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      var raw = url.replace(/&amp;/g, "&");
      return SAFE_HREF.test(raw) ? '<a href="' + url + '">' + label + "</a>" : label;
    });
    return out;
  }

  function mdToHtml(md, inline) {
    var text = String(md || "").trim();
    if (!text) return inline ? "" : "<p><br></p>";
    if (inline) return mdInlineToHtml(text.replace(/\s*\n\s*/g, " "));
    return text.split(/\n\s*\n/).map(function (chunk) {
      var lines = chunk.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
      if (lines.length && lines.every(function (l) { return /^- /.test(l); })) {
        return "<ul>" + lines.map(function (l) { return "<li>" + mdInlineToHtml(l.slice(2)) + "</li>"; }).join("") + "</ul>";
      }
      if (lines.length && lines.every(function (l) { return /^\d+[.)] /.test(l); })) {
        return "<ol>" + lines.map(function (l) { return "<li>" + mdInlineToHtml(l.replace(/^\d+[.)] /, "")) + "</li>"; }).join("") + "</ol>";
      }
      return "<p>" + mdInlineToHtml(lines.join(" ")) + "</p>";
    }).join("");
  }

  // Walk any HTML (from the editor or a paste) and keep only what we support.
  function htmlToMd(root, inline) {
    function inner(node) {
      var s = "";
      node.childNodes.forEach(function (c) { s += walkInline(c); });
      return s;
    }
    function walkInline(node) {
      if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
      if (node.nodeType !== 1) return "";
      var tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "template") return "";
      if (tag === "br") return " ";
      var weight = node.style && (node.style.fontWeight === "bold" || Number(node.style.fontWeight) >= 600);
      var slant = node.style && node.style.fontStyle === "italic";
      var body = inner(node);
      if (!body.trim()) return body;
      if (tag === "a") {
        var href = node.getAttribute("href") || "";
        return SAFE_HREF.test(href) ? "[" + body.trim() + "](" + href + ")" : body;
      }
      var lead = body.match(/^\s*/)[0];
      var trail = body.match(/\s*$/)[0];
      var core = body.trim();
      if (tag === "strong" || tag === "b" || weight) return lead + "**" + core.replace(/\*\*/g, "") + "**" + trail;
      if (tag === "em" || tag === "i" || slant) return lead + "*" + core.replace(/(^\*|\*$)/g, "") + "*" + trail;
      return body;
    }
    var blocks = [];
    var line = "";
    function flush() {
      if (line.trim()) blocks.push(line.trim());
      line = "";
    }
    function walkBlock(node) {
      if (node.nodeType !== 1) {
        line += walkInline(node);
        return;
      }
      var tag = node.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        flush();
        var items = [];
        var n = 0;
        node.querySelectorAll(":scope > li").forEach(function (li) {
          var t = inner(li).trim();
          if (t) items.push((tag === "ol" ? (++n) + ". " : "- ") + t);
        });
        if (items.length) blocks.push(items.join("\n"));
        return;
      }
      if (/^(p|div|h[1-6]|blockquote|section|article|li|tr)$/.test(tag)) {
        flush();
        node.childNodes.forEach(walkBlock);
        flush();
        return;
      }
      line += walkInline(node);
    }
    root.childNodes.forEach(walkBlock);
    flush();
    var out = inline ? blocks.join(" ").replace(/\n/g, " ") : blocks.join("\n\n");
    return out.replace(/[ \t]+/g, " ").replace(/\*\*\s*\*\*/g, "").trim();
  }

  function richText(value, onchange, opts) {
    opts = opts || {};
    var inline = !!opts.inline;
    var label = opts.label || "Text";
    var md = value || "";
    var area = h("div", { class: "rte-area" + (inline ? " is-inline" : ""), contenteditable: "true", role: "textbox", "aria-multiline": inline ? "false" : "true", "aria-label": label, spellcheck: "true" });
    area.innerHTML = mdToHtml(md, inline);
    var source = h("textarea", { class: "search rte-source", rows: inline ? "2" : "6", hidden: true, "aria-label": label + " (source)" });
    var linkBar = h("div", { class: "rte-linkbar", hidden: true });
    var savedRange = null;

    function sync() {
      md = htmlToMd(area, inline);
      onchange(md);
    }

    function cmd(name, arg) {
      area.focus();
      document.execCommand(name, false, arg || null);
      sync();
      paintState();
    }

    function btn(text, title, action, key) {
      return h("button", { type: "button", class: "rte-btn", title: title, "aria-label": title, "data-cmd": key || "", onmousedown: function (e) { e.preventDefault(); }, onclick: action }, text);
    }

    var tools = [
      btn("B", "Bold (Ctrl+B)", function () { cmd("bold"); }, "bold"),
      btn("I", "Italic (Ctrl+I)", function () { cmd("italic"); }, "italic"),
      h("span", { class: "rte-sep", "aria-hidden": "true" }),
      btn("Link", "Add a link (Ctrl+K)", openLink, "link"),
      btn("Unlink", "Remove link", function () { cmd("unlink"); })
    ];
    if (!inline) {
      tools.push(h("span", { class: "rte-sep", "aria-hidden": "true" }));
      tools.push(btn("• List", "Bulleted list", function () { cmd("insertUnorderedList"); }, "insertUnorderedList"));
      tools.push(btn("1. List", "Numbered list", function () { cmd("insertOrderedList"); }, "insertOrderedList"));
    }
    tools.push(h("span", { class: "rte-sep", "aria-hidden": "true" }));
    tools.push(btn("Clear", "Clear formatting", function () { cmd("removeFormat"); cmd("unlink"); }));
    var sourceBtn = btn("Source", "Edit the source text", toggleSource, "source");
    tools.push(h("span", { class: "rte-spacer" }), sourceBtn);
    var bar = h("div", { class: "rte-toolbar", role: "toolbar", "aria-label": label + " formatting" }, tools);

    function paintState() {
      bar.querySelectorAll("[data-cmd]").forEach(function (b) {
        var c = b.getAttribute("data-cmd");
        if (!c || c === "link" || c === "source") return;
        var on = false;
        try { on = document.queryCommandState(c); } catch (e) {}
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function openLink() {
      var sel = window.getSelection();
      if (!sel.rangeCount || !area.contains(sel.anchorNode)) {
        area.focus();
        return;
      }
      savedRange = sel.getRangeAt(0).cloneRange();
      if (savedRange.collapsed) {
        toast("Select the words to turn into a link first.");
        return;
      }
      linkBar.textContent = "";
      var input = h("input", { class: "search", type: "url", placeholder: "https://… or help.html#refunds", "aria-label": "Link address" });
      var err = h("span", { class: "fine rte-err" });
      function apply() {
        var url = input.value.trim();
        if (!SAFE_HREF.test(url)) {
          err.textContent = "Use a web address (https://…), an email (mailto:…), or a page on this site.";
          return;
        }
        linkBar.hidden = true;
        // Focus first, then restore the words that were selected: focusing
        // the editor afterwards would move the caret and lose them.
        area.focus();
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(savedRange);
        document.execCommand("createLink", false, url);
        sync();
        paintState();
      }
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); apply(); }
        if (e.key === "Escape") { linkBar.hidden = true; area.focus(); }
      });
      linkBar.appendChild(input);
      linkBar.appendChild(button("Add link", apply, "signal"));
      linkBar.appendChild(button("Cancel", function () { linkBar.hidden = true; area.focus(); }));
      linkBar.appendChild(err);
      linkBar.hidden = false;
      input.focus();
    }

    function toggleSource() {
      var showing = !source.hidden;
      if (showing) {
        md = source.value;
        area.innerHTML = mdToHtml(md, inline);
        onchange(md);
      } else {
        source.value = md;
      }
      source.hidden = showing;
      area.hidden = !showing;
      sourceBtn.classList.toggle("is-on", !showing);
      sourceBtn.setAttribute("aria-pressed", !showing ? "true" : "false");
      bar.querySelectorAll(".rte-btn").forEach(function (b) { if (b !== sourceBtn) b.disabled = !showing; });
      (showing ? area : source).focus();
    }

    source.addEventListener("input", function () {
      md = source.value;
      onchange(md);
    });
    area.addEventListener("input", sync);
    area.addEventListener("keyup", paintState);
    area.addEventListener("mouseup", paintState);
    area.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openLink();
      }
      if (inline && e.key === "Enter") e.preventDefault(); // one paragraph only
    });
    area.addEventListener("paste", function (e) {
      e.preventDefault();
      var html = e.clipboardData.getData("text/html");
      var text = e.clipboardData.getData("text/plain");
      var cleanMd;
      if (html) {
        // Parsed in an inert document: nothing in it runs.
        var doc = new DOMParser().parseFromString(html, "text/html");
        cleanMd = htmlToMd(doc.body, inline);
      } else {
        cleanMd = inline ? text.replace(/\s*\n\s*/g, " ") : text;
      }
      var frag = mdToHtml(cleanMd, inline || cleanMd.indexOf("\n\n") === -1 && !/^(- |\d+[.)] )/m.test(cleanMd));
      document.execCommand("insertHTML", false, frag.replace(/^<p>|<\/p>$/g, ""));
      sync();
    });

    return h("div", { class: "rte" }, bar, linkBar, area, source);
  }

  function check(label, checked, onchange, hint) {
    return h("label", { class: "switch" },
      h("input", { type: "checkbox", checked: !!checked, onchange: function (e) { onchange(e.target.checked); } }),
      h("span", {}, " " + label, hint ? h("span", { class: "fine block", text: hint }) : null));
  }

  function block(id, title, hint, children) {
    return h("fieldset", { class: "form-block", id: id },
      h("legend", { text: title }),
      hint ? h("p", { class: "fine", text: hint }) : null,
      children);
  }

  function row2(children) {
    return h("div", { class: "form-grid" }, children);
  }

  function fieldNote(label, control, note, required) {
    return h("label", { class: "field" },
      h("span", {}, label, required ? h("abbr", { title: "required", class: "req" }, " *") : null),
      control,
      note ? h("span", { class: "fine", text: note }) : null);
  }

  var MD_HINT = "Use the toolbar for bold, italic, links, and lists, or the usual shortcuts (Ctrl+B, Ctrl+I, Ctrl+K). Pasted text keeps only that formatting.";

  // Editable list of rows. Items are arrays (tuples) or objects; cols say how.
  function repeater(list, cols, opts) {
    opts = opts || {};
    var box = h("div", { class: "repeater" });
    function blank() {
      if (opts.make) return opts.make();
      return opts.objects ? {} : cols.map(function () { return ""; });
    }
    function paint(focusLast) {
      box.textContent = "";
      if (!list.length) box.appendChild(h("p", { class: "fine", text: opts.empty || "Nothing here yet." }));
      list.forEach(function (item, i) {
        var row = h("div", { class: "rep-row" });
        cols.forEach(function (c) {
          var v = item[c.key];
          var set = function (val) {
            item[c.key] = val;
            if (opts.onchange) opts.onchange();
          };
          var ctl;
          if (c.type === "richtext") ctl = richText(v, set, { inline: c.inline, label: c.label });
          else if (c.type === "textarea") ctl = textArea(v, set, { rows: c.rows || "2", placeholder: c.placeholder || "", "aria-label": c.label });
          else if (c.type === "checkbox") ctl = check(c.label, v, set);
          else if (c.type === "select") ctl = select(c.options, v === undefined || v === null ? "" : v, function (e) { set(e.target.value); }, c.label);
          else if (c.type === "number") ctl = numberInput(v, set, { placeholder: c.placeholder || "", "aria-label": c.label, min: c.min });
          else ctl = textInput(v, set, { placeholder: c.placeholder || "", "aria-label": c.label });
          row.appendChild(h("div", { class: "rep-cell" + (c.type === "checkbox" ? " is-check" : ""), style: c.grow ? "flex:" + c.grow + " 1 160px" : null },
            c.type === "checkbox" ? null : h("span", { class: "rep-label", text: c.label }), ctl));
        });
        row.appendChild(h("div", { class: "rep-tools" },
          h("button", { type: "button", class: "icon-btn", "aria-label": "Move up", disabled: i === 0, onclick: function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); paint(); } }, "↑"),
          h("button", { type: "button", class: "icon-btn", "aria-label": "Move down", disabled: i === list.length - 1, onclick: function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); paint(); } }, "↓"),
          h("button", { type: "button", class: "icon-btn danger", "aria-label": "Remove row", onclick: function () { list.splice(i, 1); paint(); if (opts.onchange) opts.onchange(); } }, "✕")));
        box.appendChild(row);
      });
      box.appendChild(button("+ " + (opts.add || "Add"), function () {
        list.push(blank());
        paint(true);
      }));
      if (focusLast) {
        var rows = box.querySelectorAll(".rep-row");
        var first = rows.length && rows[rows.length - 1].querySelector("input, textarea, select");
        if (first) first.focus();
      }
    }
    paint();
    return box;
  }

  function offsetOf(city) {
    var c = cityInfo(city);
    return (c && c.utc_offset) || "+03:00";
  }

  function toLocalInput(iso) {
    return iso ? String(iso).slice(0, 16) : "";
  }

  function fromLocalInput(v, offset) {
    return v ? v + ":00" + (offset || "+03:00") : "";
  }

  function errorBox() {
    return h("div", { class: "form-errors", role: "alert", tabindex: "-1", hidden: true });
  }

  function showErrors(box, problems) {
    box.textContent = "";
    box.hidden = !problems.length;
    if (!problems.length) return;
    box.appendChild(h("strong", { text: problems.length === 1 ? "Fix this before saving:" : "Fix these " + problems.length + " things before saving:" }));
    box.appendChild(h("ul", {}, problems.map(function (p) { return h("li", { text: p }); })));
    box.focus();
    box.scrollIntoView({ block: "center" });
  }

  function editorBar(saveLabel, onCancel, extra) {
    return h("div", { class: "editor-bar" },
      h("button", { type: "submit", class: "btn signal" }, saveLabel || (SERVER ? "Save and publish" : "Save draft")),
      button("Cancel", onCancel),
      extra || null,
      h("span", { class: "fine", text: SERVER ? "Saving rebuilds the public site." : "Not connected to serve.py: saves stay in this browser as a draft." }));
  }

  /* ================================================================
   * Event editor
   * ================================================================ */

  function blankEvent() {
    var start = new Date(Date.now() + 21 * 86400000);
    var key = start.getFullYear() + "-" + ("0" + (start.getMonth() + 1)).slice(-2) + "-" + ("0" + start.getDate()).slice(-2);
    var v = (CONTENT.venues || []).filter(function (x) { return x.name !== "Online"; })[0] || { name: "", city: (cities()[0] || {}).name || "", address: "", directions: "" };
    var off = offsetOf(v.city);
    return {
      slug: "", title: "", kind: ((CONTENT.kinds || [])[0] || {}).name || "Workshop", summary: "", offer_line: "",
      start: key + "T09:00:00" + off, end: key + "T17:00:00" + off, lifecycle: "pending", listed: true, featured: false,
      badges: [], venue: v.name, city: v.city, address: v.address, directions: v.directions, arrival: "",
      place_heading: "Place and directions", capacity: 40, seats: "", state: "On sale", price: "", provider: "", ticket: "",
      mode: "external", pool: 0, max_per_order: 6, types: [], questions: [], waitlist: false, invite_code: "",
      offers_heading: "What’s on", offers: [], schedule: [], people_heading: "", people: [],
      audience: "", language: "English", included: [], notes: [], facts: [], faq: [],
      format: "In person", online_url: "", level: "All levels", organizer: "", currency: (cityInfo(v.city) || {}).currency || region().default_currency || ""
    };
  }

  function validateEvent(d, originalSlug) {
    var p = [];
    if (!String(d.title || "").trim()) p.push("Add a title.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug || "")) p.push("The web address (slug) can use lowercase letters, numbers, and hyphens only.");
    else if (d.slug !== originalSlug && EVT[d.slug]) p.push("Another event already uses the address “" + d.slug + "”.");
    if (!d.kind) p.push("Choose a kind.");
    if (String(d.summary || "").trim().length < 20) p.push("Write a summary of at least a sentence.");
    var start = Date.parse(d.start);
    var end = Date.parse(d.end);
    if (isNaN(start)) p.push("Set a start date and time.");
    if (isNaN(end)) p.push("Set an end date and time.");
    if (!isNaN(start) && !isNaN(end) && end < start) p.push("The event ends before it starts.");
    if (!String(d.venue || "").trim()) p.push("Choose or enter a venue.");
    if (!String(d.city || "").trim()) p.push("Enter the city.");
    else if (!cityInfo(d.city)) p.push("Choose a city from the list (add new cities under Site settings → Region).");
    if ((d.format === "Online" || d.format === "Hybrid") && !/^https:\/\//.test(d.online_url || "")) p.push("Online and hybrid events need a joining link starting with https://.");
    if (d.start && d.city && cityInfo(d.city) && d.start.slice(-6) !== offsetOf(d.city)) p.push("The times do not match " + d.city + "’s time zone. Re-enter the start and end.");
    if (!(Number(d.capacity) >= 0)) p.push("Capacity must be 0 or more.");
    if (d.mode === "external" && (d.state === "On sale" || d.state === "Limited")) {
      if (!/^https:\/\//.test(d.ticket || "")) p.push("An event on sale on the organizer’s site needs a ticket link starting with https://.");
      if (!String(d.provider || "").trim()) p.push("Name the ticket seller (for example, Harbor Tickets).");
    }

    if (d.mode === "site") {
      var seats = (d.types || []).filter(function (t) { return t.seat; });
      if (!seats.length) p.push("Add at least one ticket type that uses a seat.");
      var ids = {};
      (d.types || []).forEach(function (t) {
        if (!t.label) p.push("Every ticket type needs a name.");
        if (!(Number(t.price) >= 0)) p.push("Ticket “" + (t.label || "?") + "” needs a price of 0 or more.");
        if (ids[t.id]) p.push("Two ticket types share the code “" + t.id + "”.");
        ids[t.id] = true;
      });
      if (!(Number(d.pool) >= 0)) p.push("Seats on sale must be 0 or more.");
    }
    return p;
  }

  function eventEditor(original, isNew) {
    var d = clone(original);
    var included = (d.included || []).map(function (s) { return [s]; });
    var notes = (d.notes || []).map(function (s) { return [s]; });
    ["offers", "schedule", "people", "faq", "facts", "types", "questions", "badges"].forEach(function (k) { d[k] = d[k] || []; });
    var slugTouched = !isNew;
    var errors = errorBox();

    // --- basics
    var slugInput = textInput(d.slug, function (v) { d.slug = v.trim(); slugTouched = true; }, { placeholder: "night-market-walk", disabled: !isNew, spellcheck: "false" });
    var count = h("span", { class: "fine", text: (d.summary || "").length + " / 600" });
    var basics = block("ed-basics", "Basics", null, [
      fieldNote("Title", textInput(d.title, function (v) {
        d.title = v;
        if (!slugTouched) {
          d.slug = slugify(v);
          slugInput.value = d.slug;
        }
      }, { maxlength: "90", required: true }), null, true),
      row2([
        fieldNote("Web address", slugInput, isNew ? "events/" + "…" + ".html. Set once; it cannot change after the event is created." : "events/" + d.slug + ".html (fixed)", true),
        fieldNote("Kind", select((CONTENT.kinds || []).map(function (k) { return [k.name, k.name]; }), d.kind, function (e) { d.kind = e.target.value; }), null, true)
      ]),
      fieldNote("Summary", h("div", {}, textArea(d.summary, function (v) { d.summary = v; count.textContent = v.length + " / 600"; }, { rows: "4", maxlength: "600" }), count), "Two or three sentences. The first one is used on the homepage and in search results.", true),
      fieldNote("Card line", textInput(d.offer_line, function (v) { d.offer_line = v; }, { maxlength: "80", placeholder: "Guided route, five tastings, a local host" }), "One short line shown on event cards."),
      row2([
        fieldNote("Format", select([["In person", "In person"], ["Online", "Online"], ["Hybrid", "Hybrid"]], d.format || "In person", function (e) {
          d.format = e.target.value;
          if (d.format === "Online") { d.venue = "Online"; d.address = "Online"; }
          paintWhere();
        })),
        fieldNote("Level", select([["All levels", "All levels"], ["Beginner", "Beginner"], ["Intermediate", "Intermediate"], ["Advanced", "Advanced"]], d.level || "All levels", function (e) { d.level = e.target.value; }))
      ]),
      fieldNote("Organizer", select([["", "— None —"]].concat((CONTENT.organizers || []).map(function (o) { return [o.id, o.name + (o.city ? " · " + o.city : "")]; })), d.organizer || "", function (e) { d.organizer = e.target.value; }),
        null),
      h("p", { class: "fine" }, "Add or edit organizers under ", h("a", { href: "#organizers", text: "Organizers" }), "."),
      h("div", { class: "field" }, h("span", { text: "Badges" }),
        h("div", { class: "check-grid" }, (CONTENT.badges || []).map(function (b) {
          return check(b.label, d.badges.indexOf(b.id) !== -1, function (on) {
            d.badges = d.badges.filter(function (x) { return x !== b.id; });
            if (on) d.badges.push(b.id);
          });
        })),
        h("span", { class: "fine" }, "Manage badges in ", h("a", { href: "#taxonomy/badges", text: "Categories & badges" }), ".")),
      check("Feature on the homepage", d.featured, function (v) { d.featured = v; }, "Only one event is featured at a time.")
    ]);

    // --- date and place
    var whereBox = h("div");
    function restamp() {
      // Keep the wall-clock time, switch the offset to the city's time zone.
      var off = offsetOf(d.city);
      if (d.start) d.start = d.start.slice(0, 19) + off;
      if (d.end) d.end = d.end.slice(0, 19) + off;
      var c = cityInfo(d.city);
      if (c && c.currency && !d.currencyTouched) d.currency = c.currency;
    }
    function paintWhere() {
      whereBox.textContent = "";
      var venues = (CONTENT.venues || []).filter(function (v) { return v.name !== "Online"; });
      var known = venues.some(function (v) { return v.name === d.venue; });
      var c = cityInfo(d.city);
      whereBox.appendChild(row2([
        fieldNote("Starts", h("input", { class: "search", type: "datetime-local", value: toLocalInput(d.start), oninput: function (e) { d.start = fromLocalInput(e.target.value, offsetOf(d.city)); } }), null, true),
        fieldNote("Ends", h("input", { class: "search", type: "datetime-local", value: toLocalInput(d.end), oninput: function (e) { d.end = fromLocalInput(e.target.value, offsetOf(d.city)); } }), null, true)
      ]));
      whereBox.appendChild(h("p", { class: "fine", text: c ? "Times are " + d.city + " time (" + (c.tz_label ? c.tz_label + ", " : "") + "UTC" + c.utc_offset + ")." : "Choose a city to set the time zone." }));
      var citySel = select([["", "Choose a city"]].concat(cities().map(function (x) { return [x.name, x.name + ", " + x.country]; })), d.city || "", function (e) {
        d.city = e.target.value;
        restamp();
        paintWhere();
      }, "City");
      if (d.format === "Online") {
        whereBox.appendChild(row2([
          fieldNote("City for the time zone", citySel, null, true),
          fieldNote("Joining link", textInput(d.online_url, function (v) { d.online_url = v.trim(); }, { type: "url", placeholder: "https://" }), "Shown only to ticket holders, in My tickets.", true)
        ]));
        d.venue = "Online";
        d.address = "Online";
        return;
      }
      var venueSel = select(venues.map(function (v) { return [v.name, v.name + " · " + v.city]; }).concat([["__other", "Somewhere else…"]]), known ? d.venue : "__other", function (e) {
        if (e.target.value === "__other") {
          d.venue = "";
        } else {
          var v = venues.filter(function (x) { return x.name === e.target.value; })[0];
          d.venue = v.name;
          d.city = v.city;
          d.address = v.address;
          d.directions = v.directions || d.directions;
          restamp();
        }
        paintWhere();
      }, "Venue");
      whereBox.appendChild(fieldNote("Venue", venueSel, known ? null : "Not in the venue list. Add it under Venues to reuse it and give it an access section.", true));
      if (!known) {
        whereBox.appendChild(row2([
          fieldNote("Venue name", textInput(d.venue, function (v) { d.venue = v; }), null, true),
          fieldNote("City", citySel, null, true)
        ]));
      }
      if (d.format === "Hybrid") {
        whereBox.appendChild(fieldNote("Joining link", textInput(d.online_url, function (v) { d.online_url = v.trim(); }, { type: "url", placeholder: "https://" }), "Shown only to ticket holders.", true));
      }
      whereBox.appendChild(fieldNote("Address", textInput(d.address, function (v) { d.address = v; })));
      whereBox.appendChild(fieldNote("Directions", textArea(d.directions, function (v) { d.directions = v; }, { rows: "2" }), "How to find the entrance."));
      whereBox.appendChild(fieldNote("Arrival", textArea(d.arrival, function (v) { d.arrival = v; }, { rows: "2" }), "When to arrive and what happens at the door. Shown under Getting there."));
    }
    paintWhere();
    var where = block("ed-where", "Date and place", "Times are local to the event’s city.", whereBox);

    // --- tickets
    var ticketBox = h("div");
    function paintTickets() {
      ticketBox.textContent = "";
      ticketBox.appendChild(h("div", { class: "seg", role: "radiogroup", "aria-label": "How it sells" },
        [["site", BRAND + " checkout"], ["external", "Organizer’s site"], ["rsvp", "Register / invite"], ["closed", "Sales closed"]].map(function (m) {
          return h("label", { class: "seg-opt" + (d.mode === m[0] ? " is-on" : "") },
            h("input", { type: "radio", name: "ed-mode", value: m[0], checked: d.mode === m[0], onchange: function () {
              d.mode = m[0];
              if (m[0] === "rsvp") d.state = d.invite_code ? "Invite only" : "Registration open";
              if (m[0] === "closed") d.state = "Sales closed";
              if ((m[0] === "site" || m[0] === "external") && (d.state === "Invite only" || d.state === "Sales closed")) d.state = "On sale";
              paintTickets();
            } }), m[1]);
        })));
      ticketBox.appendChild(row2([
        fieldNote("Status shown to visitors", select([["On sale", "On sale"], ["Limited", "Limited"], ["Sold out", "Sold out"], ["Registration open", "Registration open"], ["Invite only", "Invite only"], ["Sales closed", "Sales closed"]], d.state, function (e) { d.state = e.target.value; })),
        fieldNote("Capacity", numberInput(d.capacity, function (v) { d.capacity = v; }, { min: "0" }), "Total people. Shown as “Capacity”.")
      ]));
      ticketBox.appendChild(fieldNote("Currency", select((region().currencies || []).map(function (c) { return [c.code, c.code + " · " + c.name]; }), d.currency || curOf(d.slug), function (e) { d.currency = e.target.value; d.currencyTouched = true; }),
        "Prices on this event are in this currency. Defaults to the city’s."));
      ticketBox.appendChild(row2([
        fieldNote("Price line", textInput(d.price, function (v) { d.price = v; }, { placeholder: "From MVR 450" }), "Leave empty if there is no public price."),
        fieldNote("Seats line", textInput(d.seats, function (v) { d.seats = v; }, { placeholder: "86 seats left" }), "Events sold here count seats live.")
      ]));
      if (d.mode === "external") {
        ticketBox.appendChild(row2([
          fieldNote("Ticket seller", textInput(d.provider, function (v) { d.provider = v; }, { placeholder: "Harbor Tickets" })),
          fieldNote("Ticket link", textInput(d.ticket, function (v) { d.ticket = v.trim(); }, { type: "url", placeholder: "https://" }))
        ]));
        ticketBox.appendChild(check("Run a waitlist when sold out", d.waitlist, function (v) { d.waitlist = v; }));
      }
      if (d.mode === "rsvp") {
        ticketBox.appendChild(fieldNote("Invitation code", textInput(d.invite_code, function (v) { d.invite_code = v.trim().toUpperCase(); }, { placeholder: "Leave empty for open registration" }), "With a code, only invited guests can register. Without one, anyone can register free."));
      }
      if (d.mode === "site") {
        d.provider = BRAND;
        ticketBox.appendChild(row2([
          fieldNote("Seats on sale", numberInput(d.pool, function (v) { d.pool = v; }, { min: "0" }), "Seats still available when this is published."),
          fieldNote("Most seats per order", numberInput(d.max_per_order, function (v) { d.max_per_order = v; }, { min: "1" }))
        ]));
        ticketBox.appendChild(h("h3", { class: "sub", text: "Ticket types" }));
        ticketBox.appendChild(repeater(d.types, [
          { key: "label", label: "Name", grow: 2, placeholder: "Adult" },
          { key: "price", label: "Price (MVR)", type: "number", min: "0" },
          { key: "note", label: "Note", grow: 2, placeholder: "What it includes" },
          { key: "limit", label: "Limit", type: "number", min: "0", placeholder: "none" },
          { key: "seat", label: "Uses a seat", type: "checkbox" }
        ], { objects: true, add: "Add ticket type", empty: "No ticket types yet.", make: function () { return { id: "", label: "", price: 0, note: "", seat: true }; } }));
        ticketBox.appendChild(h("h3", { class: "sub", text: "Questions at checkout" }));
        ticketBox.appendChild(repeater(d.questions, [{ key: "label", label: "Question", grow: 3, placeholder: "Dietary needs" }],
          { objects: true, add: "Add question", empty: "No questions.", make: function () { return { id: "", label: "" }; } }));
      }
    }
    paintTickets();
    var tickets = block("ed-tickets", "Tickets", null, ticketBox);

    // --- programme
    var programme = block("ed-programme", "Programme", null, [
      fieldNote("Heading for the offer list", textInput(d.offers_heading, function (v) { d.offers_heading = v; })),
      repeater(d.offers, [
        { key: 0, label: "Label", placeholder: "Track" },
        { key: 1, label: "Title", grow: 2, placeholder: "Ports" },
        { key: 2, label: "Description", grow: 3, placeholder: "One line" }
      ], { add: "Add item", empty: "Nothing listed yet." }),
      h("h3", { class: "sub", text: "Schedule" }),
      repeater(d.schedule, [
        { key: 0, label: "When", placeholder: "Fri 4 Dec · 09:00" },
        { key: 1, label: "Title", grow: 2 },
        { key: 2, label: "Description", grow: 3 }
      ], { add: "Add schedule item", empty: "No schedule yet." }),
      fieldNote("Heading for people", textInput(d.people_heading, function (v) { d.people_heading = v; }, { placeholder: "Speakers, Host, Instructor…" })),
      repeater(d.people, [
        { key: 0, label: "Role or name", grow: 2 },
        { key: 1, label: "What they do", grow: 3 }
      ], { add: "Add person", empty: "No people listed." })
    ]);

    // --- page text
    var page = block("ed-page", "Page text", null, [
      fieldNote("Who it’s for", textArea(d.audience, function (v) { d.audience = v; }, { rows: "2" })),
      fieldNote("Language", textInput(d.language, function (v) { d.language = v; })),
      h("h3", { class: "sub", text: "Included" }),
      repeater(included, [{ key: 0, label: "Included", grow: 1 }], { add: "Add line" }),
      h("h3", { class: "sub", text: "Good to know" }),
      repeater(d.facts, [{ key: 0, label: "Label", placeholder: "Length" }, { key: 1, label: "Value", grow: 3 }], { add: "Add fact" }),
      h("h3", { class: "sub", text: "Practical notes" }),
      repeater(notes, [{ key: 0, label: "Note", grow: 1 }], { add: "Add note" }),
      h("h3", { class: "sub", text: "Questions" }),
      repeater(d.faq, [{ key: 0, label: "Question", grow: 2 }, { key: 1, label: "Answer", grow: 3, type: "textarea" }], { add: "Add question" })
    ]);

    // --- photo
    var photo = block("ed-photo", "Photo", "Landscape works best, at least 1600 pixels wide. It is cropped to 3:2.", isNew
      ? h("p", { class: "fine", text: "Save the event first, then add its photo." })
      : photoUploader(d.slug));

    // --- status
    var status = block("ed-status", "Status", null, [
      row2([
        fieldNote("Publishing status", select([["pending", "Awaiting approval"], ["published", "Live"], ["draft", "Rejected"], ["archived", "Archived"]], d.lifecycle, function (e) { d.lifecycle = e.target.value; }),
          "Live events appear on the site. Awaiting approval stays off the lists."),
        h("div", { class: "field" }, h("span", { text: "Lists" }), check("Show on the public lists", d.listed !== false, function (v) { d.listed = v; }))
      ])
    ]);

    var sections = [["ed-basics", "Basics"], ["ed-where", "Date and place"], ["ed-tickets", "Tickets"], ["ed-programme", "Programme"], ["ed-page", "Page text"], ["ed-photo", "Photo"], ["ed-status", "Status"]];
    var form = h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      save();
    } },
      h("nav", { class: "editor-nav", "aria-label": "Form sections" }, sections.map(function (s) {
        return h("a", { href: "#" + location.hash.slice(1), "data-jump": s[0], onclick: function (e) {
          e.preventDefault();
          var target = document.getElementById(s[0]);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        } }, s[1]);
      })),
      errors, basics, where, tickets, programme, page, photo, status,
      editorBar(isNew ? (SERVER ? "Create and publish" : "Create draft") : null, function () {
        go(isNew ? "#events" : "#events/" + original.slug + "/overview");
      }));
    view.appendChild(form);

    function cleanRows(list) {
      return list.map(function (r) {
        return r.map(function (x) { return String(x === null || x === undefined ? "" : x).trim(); });
      }).filter(function (r) {
        return r.some(Boolean);
      });
    }

    // Build a cleaned copy. The form keeps editing d and its lists, so a
    // failed validation never detaches the rows from what gets saved.
    function save() {
      var out = clone(d);
      delete out.currencyTouched;
      out.title = String(d.title || "").trim();
      out.included = included.map(function (x) { return String(x[0] || "").trim(); }).filter(Boolean);
      out.notes = notes.map(function (x) { return String(x[0] || "").trim(); }).filter(Boolean);
      ["offers", "schedule", "people", "faq", "facts"].forEach(function (k) { out[k] = cleanRows(d[k]); });
      out.types = d.types.filter(function (t) { return String(t.label || "").trim(); }).map(function (t) {
        var row = { id: t.id || slugify(t.label), label: String(t.label).trim(), price: Number(t.price) || 0, note: String(t.note || "").trim(), seat: !!t.seat };
        if (t.limit !== null && t.limit !== undefined && t.limit !== "") row.limit = Number(t.limit);
        return row;
      });
      out.questions = d.questions.filter(function (q) { return String(q.label || "").trim(); }).map(function (q) {
        return { id: q.id || slugify(q.label).slice(0, 20), label: String(q.label).trim() };
      });
      out.capacity = Number(d.capacity) || 0;
      out.pool = Number(d.pool) || 0;
      out.max_per_order = Number(d.max_per_order) || 6;
      ["price", "provider", "ticket"].forEach(function (k) { if (!out[k]) out[k] = null; });
      var problems = validateEvent(out, isNew ? null : original.slug);
      showErrors(errors, problems);
      if (problems.length) return;
      if (out.featured) CONTENT.events.forEach(function (e) { e.featured = false; });
      if (isNew) {
        CONTENT.events.push(out);
      } else {
        var i = CONTENT.events.indexOf(EVT[original.slug]);
        CONTENT.events[i] = out;
      }
      logActivity((isNew ? "Created " : "Edited ") + out.title, "#events/" + out.slug + "/overview");
      saveContent((isNew ? "Created " : "Saved ") + out.title + ".", function () {
        go("#events/" + out.slug + "/overview");
      });
    }
  }

  function photoUploader(slug) {
    var img = h("img", { class: "photo-preview", alt: "", src: "images/opt/" + slug + "-640.webp?t=" + Date.now(), onerror: function () { this.hidden = true; } });
    var status = h("p", { class: "fine", "aria-live": "polite" });
    var input = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", disabled: !SERVER, onchange: function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) {
        status.textContent = "That file is over 6 MB. Export a smaller JPEG.";
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        status.textContent = "Uploading and rebuilding…";
        fetch("api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-MDV-Desk": "1" },
          body: JSON.stringify({ slug: slug, data: String(reader.result).split(",")[1] })
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (j.ok) {
            status.textContent = "Photo updated.";
            img.hidden = false;
            img.src = "images/opt/" + slug + "-640.webp?t=" + Date.now();
            logActivity("Changed the photo for " + (EVT[slug] ? EVT[slug].title : slug), "#events/" + slug + "/overview");
          } else {
            status.textContent = j.error || "Upload failed.";
          }
        }).catch(function () {
          status.textContent = "Upload failed: the publishing server did not answer.";
        });
      };
      reader.readAsDataURL(file);
    } });
    return h("div", { class: "photo-field" }, img, h("label", { class: "field" }, h("span", { text: "Replace photo" }), input),
      SERVER ? null : h("p", { class: "fine", text: "Photo uploads need serve.py running." }), status);
  }

  function duplicateEvent(slug) {
    var copy = clone(EVT[slug]);
    var base = slug + "-copy";
    var n = 2;
    copy.slug = base;
    while (EVT[copy.slug]) copy.slug = base + "-" + n++;
    copy.title = copy.title + " (copy)";
    copy.lifecycle = "pending";
    copy.featured = false;
    delete copy.review;
    CONTENT.events.push(copy);
    logActivity("Duplicated " + EVT[slug].title, "#events/" + copy.slug + "/edit");
    saveContent("Made a copy of " + EVT[slug].title + ".", function () {
      go("#events/" + copy.slug + "/edit");
    });
  }

  function deleteEvent(slug) {
    var e = EVT[slug];
    var orders = T.readOrders().filter(function (o) { return o.slug === slug && T.isLive(o); }).length;
    var msg = "Delete “" + e.title + "”? Its public page is removed." + (orders ? "\n\n" + orders + " live order(s) or invitation(s) point to it. Consider archiving instead." : "");
    if (!window.confirm(msg)) return;
    CONTENT.events = CONTENT.events.filter(function (x) { return x.slug !== slug; });
    logActivity("Deleted " + e.title, "#events");
    saveContent("Deleted " + e.title + ".", function () {
      go("#events");
    });
  }

  /* ================================================================
   * Event routes: list, new, workspace (with Edit)
   * ================================================================ */

  function renderEventsRoute(route) {
    var slug = route.parts[1];
    if (slug === "new") {
      if (!canEdit()) return go("#events");
      setHead("Events", "New event", "Fill in what visitors need. New events wait for approval before they go live.");
      view.appendChild(link("← All events", "#events", "back-link"));
      eventEditor(blankEvent(), true);
      return;
    }
    if (slug && BY[slug]) renderEvent(slug, route.parts[2] || "overview");
    else renderEvents(route);
  }

  function badgePills(slug) {
    var defs = {};
    (CONTENT.badges || []).forEach(function (b) { defs[b.id] = b; });
    return ((EVT[slug] || {}).badges || []).filter(function (id) { return defs[id]; }).map(function (id) {
      return h("span", { class: "badge tone-" + (defs[id].tone || "neutral"), text: defs[id].label });
    });
  }

  function eventTabs() {
    var tabs = [["overview", "Overview"], ["tickets", "Tickets"], ["attendees", "Attendees"], ["programme", "Programme"], ["content", "Page content"]];
    if (canEdit()) tabs.push(["edit", "Edit"]);
    return tabs;
  }

  function renderEvent(slug, tab) {
    var r = BY[slug];
    var status = life(slug);
    if (tab === "edit" && !canEdit()) tab = "overview";
    setHead("Event", r.title, r.kind + " · " + r.dates + " · " + r.place);
    view.appendChild(h("div", { class: "ws-head" },
      link("← All events", "#events", "back-link"),
      h("div", { class: "ws-id" },
        h("img", { class: "ws-photo", src: "images/opt/" + slug + "-640.webp", alt: "", onerror: function () { this.style.visibility = "hidden"; } }),
        h("div", {},
          h("div", { class: "pill-row" },
            pill(LIFE[status], lifeTone(status)),
            pill(MODE[mode(slug)]),
            isHidden(slug) ? pill("Hidden", "declined") : null,
            featuredSlug() === slug ? pill("Featured", "offered") : null,
            badgePills(slug)),
          h("p", { class: "meta", text: whenLabel(r.start) + " · Capacity " + (Number(EVT[slug].capacity) || 0) + " · " + seatLine(r) }))),
      h("div", { class: "row-actions" },
        canEdit() && tab !== "edit" ? link("Edit", "#events/" + slug + "/edit", "btn signal") : null,
        canEdit() ? button("Duplicate", function () { duplicateEvent(slug); }) : null,
        isAdmin() ? button("Delete", function () { deleteEvent(slug); }, "quiet danger") : null,
        h("a", { class: "btn quiet", href: "events/" + slug + ".html", target: "_blank", rel: "noopener" }, "Public page ↗"))));
    view.appendChild(h("div", { class: "subnav", role: "tablist", "aria-label": "Event" },
      eventTabs().map(function (t) {
        return h("a", { class: t[0] === tab ? "is-active" : "", href: "#events/" + slug + "/" + t[0], role: "tab", "aria-selected": t[0] === tab ? "true" : "false" }, t[1]);
      })));
    if (tab === "edit") {
      eventEditor(EVT[slug], false);
      return;
    }
    ({ overview: eventOverview, tickets: eventTickets, attendees: eventAttendees, programme: eventProgramme, content: eventContent }[tab] || eventOverview)(r);
  }

  /* ================================================================
   * Customers (built from orders)
   * ================================================================ */

  function customers() {
    var by = {};
    T.readOrders().forEach(function (o) {
      var key = (o.buyer.email || "").toLowerCase();
      if (!key) return;
      var c = by[key] = by[key] || { name: o.buyer.name, email: key, phone: "", orders: 0, tickets: 0, spend: 0, refunds: 0, events: {}, last: "", news: false, waitlist: 0 };
      if (o.buyer.phone) c.phone = o.buyer.phone;
      if (o.created > c.last) {
        c.last = o.created;
        c.name = o.buyer.name;
      }
      if (o.news) c.news = true;
      if (o.kind === "waitlist") {
        c.waitlist += 1;
        return;
      }
      c.orders += 1;
      c.events[o.title] = true;
      if (o.status === "refunded") c.refunds += 1;
      if (T.isLive(o)) {
        c.tickets += o.tickets.length;
        c.spend += toUSD(o.total || 0, ocur(o));
      }
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.last < b.last ? 1 : -1; });
  }

  function renderCustomers() {
    setHead("Sales", "Customers", "Everyone who bought, confirmed an invitation, or joined a waitlist.");
    var all = customers();
    var q = { text: "" };
    var body = h("tbody");
    var count = h("p", { class: "meta count-line" });
    view.appendChild(statGrid([
      ["Customers", all.length, "Unique emails"],
      ["Repeat buyers", all.filter(function (c) { return c.orders > 1; }).length, "More than one order"],
      ["Marketing opt-in", all.filter(function (c) { return c.news; }).length, "Asked for event emails"],
      ["Average spend", usdMoney(all.length ? all.reduce(function (n, c) { return n + c.spend; }, 0) / all.length : 0), "Per customer, all currencies"]
    ]));
    view.appendChild(h("div", { class: "toolbar slim" },
      field("Search", h("input", { class: "search", type: "search", placeholder: "Name, email, or phone", oninput: function (e) { q.text = e.target.value; paint(); } })),
      h("div", { class: "row-actions end" }, button("Export CSV", function () {
        var rows = [["name", "email", "phone", "orders", "tickets", "spend_usd_approx", "refunds", "waitlists", "events", "last_activity", "marketing_opt_in"]];
        all.forEach(function (c) {
          rows.push([c.name, c.email, c.phone, c.orders, c.tickets, Math.round(c.spend), c.refunds, c.waitlist, Object.keys(c.events).join("; "), c.last, c.news ? "yes" : "no"]);
        });
        T.download("mdv-customers.csv", csv(rows), "text/csv");
        toast("Exported " + plural(all.length, "customer") + ".");
      }))));
    view.appendChild(count);
    view.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "admin-table click-table" },
      h("thead", {}, h("tr", {}, ["Customer", "Orders", "Tickets", "Spend", "Events", "Last activity", ""].map(function (x) { return h("th", { text: x }); }))),
      body)));
    var none = empty("No customers yet. They appear here after a checkout, an invitation, or a waitlist sign-up.");
    view.appendChild(none);
    function paint() {
      var t = q.text.trim().toLowerCase();
      var list = all.filter(function (c) { return !t || (c.name + " " + c.email + " " + c.phone).toLowerCase().indexOf(t) !== -1; });
      body.textContent = "";
      list.forEach(function (c) {
        var href = "#orders?q=" + encodeURIComponent(c.email);
        body.appendChild(h("tr", { onclick: function (e) { if (!e.target.closest("a")) go(href); } },
          h("td", {}, h("a", { class: "row-link", href: href, text: c.name }), h("span", { class: "meta", text: c.email + (c.phone ? " · " + c.phone : "") })),
          h("td", { text: String(c.orders) + (c.refunds ? " (" + c.refunds + " refunded)" : "") }),
          h("td", { text: String(c.tickets) }),
          h("td", { text: usdMoney(c.spend) }),
          h("td", {}, h("span", { class: "meta", text: Object.keys(c.events).join(", ") || (c.waitlist ? "Waitlist only" : "—") })),
          h("td", { text: c.last ? T.fmtDateTime(c.last) : "—" }),
          h("td", {}, c.news ? pill("Opted in", "paid") : null)));
      });
      count.textContent = plural(list.length, "customer");
      none.hidden = all.length !== 0;
    }
    paint();
  }

  /* ================================================================
   * Users and roles
   * ================================================================ */

  function accountDialog() {
    var pw = { now: "", next: "", again: "" };
    var errors = errorBox();
    openDialog(h("form", { novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      passwordHash(CURRENT.username, pw.now).then(function (hash) {
        var p = [];
        if (hash !== CURRENT.password) p.push("Your current password is not right.");
        if (pw.next.length < 8) p.push("The new password needs at least 8 characters.");
        if (pw.next !== pw.again) p.push("The two new passwords do not match.");
        showErrors(errors, p);
        if (p.length) return;
        passwordHash(CURRENT.username, pw.next).then(function (next) {
          CURRENT.password = next;
          closeDialog();
          logActivity("Changed their password");
          saveContent("Password changed.");
        });
      });
    } },
      h("p", { class: "kind", text: "Your account" }),
      h("h2", { text: CURRENT.name }),
      h("p", { class: "meta", text: CURRENT.email + " · " + ROLES[CURRENT.role].label }),
      errors,
      fieldNote("Current password", h("input", { class: "search", type: "password", autocomplete: "current-password", oninput: function (e) { pw.now = e.target.value; } })),
      fieldNote("New password", h("input", { class: "search", type: "password", autocomplete: "new-password", oninput: function (e) { pw.next = e.target.value; } })),
      fieldNote("New password again", h("input", { class: "search", type: "password", autocomplete: "new-password", oninput: function (e) { pw.again = e.target.value; } })),
      h("div", { class: "admin-actions" }, h("button", { class: "btn signal", type: "submit" }, "Change password"), button("Cancel", closeDialog))));
  }

  /* ================================================================
   * Page content (home, about, help)
   * ================================================================ */

  function renderContent(route) {
    var tab = route.parts[1] || "home";
    setHead("Content", "Pages & text", "The words on the homepage, About, and Help. Event pages are edited on each event.");
    view.appendChild(h("div", { class: "subnav", role: "tablist" },
      [["home", "Homepage"], ["about", "About"], ["help", "Help & policies"]].map(function (t) {
        return h("a", { href: "#content/" + t[0], class: t[0] === tab ? "is-active" : "", role: "tab", "aria-selected": t[0] === tab ? "true" : "false" }, t[1]);
      })));
    CONTENT.pages = CONTENT.pages || {};
    var page = clone(CONTENT.pages[tab] || {});
    var form = h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      CONTENT.pages[tab] = page;
      logActivity("Edited the " + tab + " page text", "#content/" + tab);
      saveContent("Saved the " + (tab === "home" ? "homepage" : tab + " page") + " text.");
    } });
    if (tab === "home") {
      page.steps = page.steps || [];
      page.organizer = page.organizer || {};
      form.appendChild(block("c-steps", "How tickets work", "Three short steps under the event list. " + MD_HINT,
        repeater(page.steps, [{ key: "title", label: "Title", grow: 1 }, { key: "body", label: "Text", grow: 3, type: "richtext", inline: true }], { objects: true, add: "Add step", make: function () { return { title: "", body: "" }; } })));
      form.appendChild(block("c-org", "Organizer call-out", null, [
        fieldNote("Small label", textInput(page.organizer.kicker, function (v) { page.organizer.kicker = v; })),
        fieldNote("Heading", textInput(page.organizer.heading, function (v) { page.organizer.heading = v; })),
        fieldNote("Text", richText(page.organizer.body, function (v) { page.organizer.body = v; }, { inline: true, label: "Organizer call-out text" })),
        fieldNote("Button", textInput(page.organizer.button, function (v) { page.organizer.button = v; }))
      ]));
      form.appendChild(h("p", { class: "fine" }, "The featured event is chosen in ", h("a", { href: "#settings/homepage", text: "Site settings → Homepage" }), "."));
    } else {
      page.sections = page.sections || [];
      form.appendChild(block("c-intro", "Introduction", null, fieldNote("Lead paragraph", textArea(page.lede, function (v) { page.lede = v; }, { rows: "3" }))));
      var cols = [{ key: "heading", label: "Heading", grow: 1 }, { key: "body", label: "Text", grow: 3, type: "richtext" }];
      if (tab === "help") cols.unshift({ key: "id", label: "Link name", placeholder: "refunds" });
      form.appendChild(block("c-sections", "Sections", MD_HINT + (tab === "help" ? " The link name makes help.html#link-name work; the footer links to refunds, terms, privacy, and organizers." : ""),
        repeater(page.sections, cols, { objects: true, add: "Add section", make: function () { return { heading: "", body: "" }; } })));
      if (tab === "help") {
        page.faq = page.faq || [];
        form.appendChild(block("c-faq", "Questions", null,
          repeater(page.faq, [{ key: "q", label: "Question", grow: 2 }, { key: "a", label: "Answer", grow: 3, type: "richtext", inline: true }], { objects: true, add: "Add question", make: function () { return { q: "", a: "" }; } })));
      }
    }
    form.appendChild(editorBar(null, function () { refresh(); },
      h("a", { class: "btn quiet", href: tab === "home" ? "index.html" : tab + ".html", target: "_blank", rel: "noopener" }, "View page ↗")));
    view.appendChild(form);
  }

  /* ================================================================
   * Venues
   * ================================================================ */

  function venueTags(v) {
    var text = (v.access || []).map(function (x) { return String(x[1] || "").toLowerCase(); }).join(" ");
    return [["step-free", "Step-free"], ["ramp", "Ramp"], ["lift", "Lift"], ["accessible toilet", "Accessible toilet"], ["hearing loop", "Hearing loop"], ["quiet room", "Quiet room"], ["captions", "Captions"]]
      .filter(function (t) { return text.indexOf(t[0]) !== -1; }).map(function (t) { return t[1]; });
  }

  // Compact, searchable list: many venues on one screen, paged.
  function renderVenues(route) {
    var name = route.parts[1] || "";
    CONTENT.venues = CONTENT.venues || [];
    if (name) return venueEditor(name === "new" ? null : CONTENT.venues.filter(function (v) { return v.name === name; })[0]);
    setHead("Content", "Venues", "Places events use: directions, transport, and accessibility. Each venue has a public page.");
    state.venues = state.venues || { q: "", city: "", access: false, sort: "events" };
    state.pages = state.pages || {};
    var f = state.venues;
    var counts = {};
    CONTENT.venues.forEach(function (v) { counts[v.city || "Other"] = (counts[v.city || "Other"] || 0) + 1; });
    var chips = h("div", { class: "chip-row", role: "group", "aria-label": "City" },
      [["", "All", CONTENT.venues.length]].concat(Object.keys(counts).sort().map(function (c) { return [c, c, counts[c]]; })).map(function (c) {
        var on = f.city === c[0];
        return h("button", { type: "button", class: "chip" + (on ? " is-active" : ""), "aria-pressed": on ? "true" : "false", onclick: function () {
          f.city = c[0];
          state.pages.venues = 1;
          refresh();
        } }, c[1] + " ", h("span", { class: "chip-count", text: String(c[2]) }));
      }));
    view.appendChild(h("div", { class: "list-head" }, chips, canEdit() ? link("+ Add venue", "#venues/new", "btn signal") : null));
    view.appendChild(h("div", { class: "toolbar slim" },
      field("Search", h("input", { class: "search", type: "search", value: f.q, placeholder: "Venue, area, city, or access", oninput: function (e) { f.q = e.target.value; state.pages.venues = 1; paint(); } })),
      h("div", { class: "row-actions end" },
        h("label", { class: "switch" }, h("input", { type: "checkbox", checked: f.access, onchange: function (e) { f.access = e.target.checked; state.pages.venues = 1; paint(); } }), " Step-free only"),
        select([["events", "Most events"], ["name", "Name A–Z"], ["city", "City"]], f.sort, function (e) { f.sort = e.target.value; paint(); }, "Sort"))));
    var body = h("tbody");
    var pager = h("div", { class: "pager-bar" });
    var none = empty("No venues match.");
    view.appendChild(h("div", { class: "table-wrap" }, h("table", { class: "admin-table click-table venue-table" },
      h("thead", {}, h("tr", {}, ["Venue", "City", "Access", "Events", ""].map(function (x) { return h("th", { text: x }); }))), body)));
    view.appendChild(pager);
    view.appendChild(none);

    function paint() {
      var q = f.q.trim().toLowerCase();
      var rows = CONTENT.venues.map(function (v) {
        var evs = RECORDS.filter(function (r) { return r.venue === v.name; });
        return { v: v, tags: venueTags(v), total: evs.length, up: evs.filter(isUpcoming).length, photo: (evs.filter(isUpcoming)[0] || evs[0] || {}).slug };
      }).filter(function (x) {
        if (f.city && (x.v.city || "Other") !== f.city) return false;
        if (f.access && x.tags.indexOf("Step-free") === -1 && x.tags.indexOf("Ramp") === -1) return false;
        return !q || [x.v.name, x.v.city, x.v.address, x.v.about].concat(x.tags).join(" ").toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) {
        if (f.sort === "name") return a.v.name.localeCompare(b.v.name);
        if (f.sort === "city") return String(a.v.city).localeCompare(String(b.v.city)) || a.v.name.localeCompare(b.v.name);
        return b.up - a.up || b.total - a.total || a.v.name.localeCompare(b.v.name);
      });
      body.textContent = "";
      paginate(rows, "venues", pager, paint).forEach(function (x) {
        var href = "#venues/" + encodeURIComponent(x.v.name);
        body.appendChild(h("tr", { onclick: function (e) { if (canEdit() && !e.target.closest("a, button")) go(href); } },
          h("td", {}, h("div", { class: "ev-cell" },
            x.photo ? thumb(x.photo) : h("span", { class: "thumb venue-initial", "aria-hidden": "true", text: x.v.name.slice(0, 1) }),
            h("div", {}, canEdit() ? h("a", { class: "row-link", href: href, text: x.v.name }) : h("strong", { text: x.v.name }),
              h("span", { class: "meta", text: x.v.address || "No address yet" })))),
          h("td", { text: x.v.city || "—" }),
          h("td", {}, x.tags.length ? h("div", { class: "pill-row" }, x.tags.slice(0, 3).map(function (t) { return h("span", { class: "badge tone-good", text: t }); })) : h("span", { class: "meta", text: (x.v.access || []).length ? plural(x.v.access.length, "note") : "No access notes" })),
          h("td", {}, h("span", { text: x.up + " upcoming" }), h("span", { class: "meta", text: x.total + " in total" })),
          h("td", {}, h("div", { class: "row-actions" },
            canEdit() ? link("Edit", href, "btn quiet") : null,
            x.v.name !== "Online" && x.total ? h("a", { class: "btn quiet", href: "venues/" + slugify(x.v.name + " " + x.v.city) + ".html", target: "_blank", rel: "noopener" }, "Page ↗") : null))));
      });
      none.hidden = rows.length !== 0;
    }
    paint();
  }

  function venueEditor(v) {
    var isNew = !v;
    var d = v ? clone(v) : { name: "", city: "Malé", address: "", directions: "", about: "", transport: "", access: [] };
    d.access = d.access || [];
    setHead("Content", isNew ? "New venue" : d.name, "Shown on the venue page and in each event’s Getting there and Accessibility sections.");
    view.appendChild(link("← Venues", "#venues", "back-link"));
    var errors = errorBox();
    var form = h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var p = [];
      d.name = String(d.name || "").trim();
      if (!d.name) p.push("Add the venue name.");
      if (!String(d.city || "").trim()) p.push("Add the city.");
      if (CONTENT.venues.some(function (x) { return x !== v && x.name === d.name; })) p.push("Another venue already has that name.");
      showErrors(errors, p);
      if (p.length) return;
      d.access = d.access.filter(function (a) { return a[0] || a[1]; });
      if (isNew) CONTENT.venues.push(d);
      else {
        // Renaming a venue moves its events with it.
        CONTENT.events.forEach(function (ev) {
          if (ev.venue === v.name) {
            ev.venue = d.name;
            ev.city = d.city;
          }
        });
        CONTENT.venues[CONTENT.venues.indexOf(v)] = d;
      }
      logActivity((isNew ? "Added the venue " : "Edited the venue ") + d.name, "#venues");
      saveContent("Saved " + d.name + ".", function () { go("#venues"); });
    } },
      errors,
      block("v-basics", "Venue", null, [
        row2([fieldNote("Name", textInput(d.name, function (x) { d.name = x; }), null, true), fieldNote("City", textInput(d.city, function (x) { d.city = x; }), null, true)]),
        fieldNote("Address", textInput(d.address, function (x) { d.address = x; })),
        fieldNote("About", textArea(d.about, function (x) { d.about = x; }, { rows: "2" })),
        fieldNote("Directions", textArea(d.directions, function (x) { d.directions = x; }, { rows: "2" }), "Default directions for new events here."),
        fieldNote("Transport", textArea(d.transport, function (x) { d.transport = x; }, { rows: "2" }), "Ferry, taxi, parking, timing.")
      ]),
      block("v-access", "Accessibility", "Entrance, toilets, seating, lifts, boarding, quiet spaces. Check each detail with the venue.",
        repeater(d.access, [{ key: 0, label: "Topic", placeholder: "Entrance" }, { key: 1, label: "Detail", grow: 3, placeholder: "Step-free at the west doors." }], { add: "Add access note" })),
      editorBar(null, function () { go("#venues"); },
        !isNew && isAdmin() ? button("Delete venue", function () {
          var used = CONTENT.events.filter(function (ev) { return ev.venue === v.name; }).length;
          if (used) {
            toast("Move its " + plural(used, "event") + " to another venue first.");
            return;
          }
          if (!window.confirm("Delete " + v.name + "?")) return;
          CONTENT.venues = CONTENT.venues.filter(function (x) { return x !== v; });
          logActivity("Deleted the venue " + v.name, "#venues");
          saveContent("Deleted " + v.name + ".", function () { go("#venues"); });
        }, "quiet danger") : null));
    view.appendChild(form);
  }

  /* ================================================================
   * Categories and badges
   * ================================================================ */

  var TONES = [["neutral", "Grey"], ["info", "Blue"], ["good", "Green"], ["warn", "Amber"], ["accent", "Copper"]];

  function renderTaxonomy(route) {
    var tab = route.parts[1] === "badges" ? "badges" : "kinds";
    setHead("Content", "Categories & badges", "Kinds power the public filters. Badges highlight events on cards and pages.");
    view.appendChild(h("div", { class: "subnav", role: "tablist" },
      [["kinds", "Categories"], ["badges", "Badges"]].map(function (t) {
        return h("a", { href: "#taxonomy/" + t[0], class: t[0] === tab ? "is-active" : "", role: "tab", "aria-selected": t[0] === tab ? "true" : "false" }, t[1]);
      })));
    var errors = errorBox();
    if (tab === "kinds") {
      // Each row remembers its original name, so renames and removals are
      // tracked by identity, not by position in the list.
      var kinds = clone(CONTENT.kinds || []).map(function (k) { k._orig = k.name; return k; });
      var usage = h("div", { class: "pill-row" }, (CONTENT.kinds || []).map(function (k) {
        return pill(k.name + " · " + RECORDS.filter(function (r) { return r.kind === k.name; }).length);
      }));
      view.appendChild(h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        var clean = kinds.filter(function (k) { return String(k.name || "").trim(); });
        var names = clean.map(function (k) { return k.name.trim(); });
        var p = [];
        if (!clean.length) p.push("Keep at least one category.");
        if (names.some(function (n, i) { return names.indexOf(n) !== i; })) p.push("Two categories have the same name.");
        var renamed = {};
        clean.forEach(function (k) { if (k._orig && k._orig !== k.name.trim()) renamed[k._orig] = k.name.trim(); });
        var kept = clean.map(function (k) { return k._orig; });
        (CONTENT.kinds || []).forEach(function (k) {
          if (kept.indexOf(k.name) === -1 && CONTENT.events.some(function (ev) { return ev.kind === k.name; })) p.push("Events still use “" + k.name + "”. Rename it or move those events first.");
        });
        showErrors(errors, p);
        if (p.length) return;
        CONTENT.events.forEach(function (ev) { if (renamed[ev.kind]) ev.kind = renamed[ev.kind]; });
        CONTENT.kinds = clean.map(function (k) { return { name: k.name.trim(), plural: String(k.plural || k.name + "s").trim(), description: String(k.description || "").trim() }; });
        logActivity("Edited the categories", "#taxonomy/kinds");
        saveContent("Saved the categories.");
      } },
        errors,
        block("t-kinds", "Categories", "Shown as filter chips (plural) and as the label on each event (singular). Renaming a row moves its events.", [
          usage,
          repeater(kinds, [
            { key: "name", label: "Name", placeholder: "Workshop" },
            { key: "plural", label: "Plural", placeholder: "Workshops" },
            { key: "description", label: "Description", grow: 3 }
          ], { objects: true, add: "Add category", make: function () { return { name: "", plural: "", description: "" }; } })
        ]),
        editorBar(null, function () { refresh(); })));
      return;
    }
    var badges = clone(CONTENT.badges || []);
    var preview = h("div", { class: "pill-row" });
    function paintPreview() {
      preview.textContent = "";
      badges.forEach(function (b) {
        if (b.label) preview.appendChild(h("span", { class: "badge tone-" + (b.tone || "neutral"), text: b.label }));
      });
    }
    paintPreview();
    view.appendChild(h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var clean = badges.filter(function (b) { return String(b.label || "").trim(); }).map(function (b) {
        return { id: b.id || slugify(b.label), label: b.label.trim(), tone: b.tone || "neutral" };
      });
      var ids = clean.map(function (b) { return b.id; });
      var p = [];
      if (ids.some(function (id, i) { return ids.indexOf(id) !== i; })) p.push("Two badges have the same name.");
      showErrors(errors, p);
      if (p.length) return;
      CONTENT.badges = clean;
      CONTENT.events.forEach(function (ev) { ev.badges = (ev.badges || []).filter(function (id) { return ids.indexOf(id) !== -1; }); });
      logActivity("Edited the badges", "#taxonomy/badges");
      saveContent("Saved the badges.");
    } },
      errors,
      block("t-badges", "Badges", "Short highlights such as “Food included” or “Family friendly”. Pick them on each event’s Edit tab. Removing a badge takes it off every event.", [
        preview,
        repeater(badges, [
          { key: "label", label: "Label", grow: 2, placeholder: "Family friendly" },
          { key: "tone", label: "Colour", type: "select", options: TONES }
        ], { objects: true, add: "Add badge", onchange: paintPreview, make: function () { return { id: "", label: "", tone: "neutral" }; } }),
        h("div", { class: "kv-list" }, (CONTENT.badges || []).map(function (b) {
          var n = CONTENT.events.filter(function (ev) { return (ev.badges || []).indexOf(b.id) !== -1; }).length;
          return h("p", { class: "meta", text: b.label + ": on " + plural(n, "event") });
        }))
      ]),
      editorBar(null, function () { refresh(); })));
  }

  /* ================================================================
   * Site settings
   * ================================================================ */

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function renderSettings(route) {
    var tabs = [["general", "General"], ["branding", "Branding"], ["region", "Region"], ["checkout", "Checkout"], ["listings", "Listings & features"], ["homepage", "Homepage"], ["preview", "Browser preview"], ["data", "Data"]];
    var tab = route.parts[1] || "general";
    var superOnly = { branding: true, region: true };
    setHead("System", "Site settings", "Everything about how the public site looks and behaves. Changes publish when you save.");
    view.appendChild(h("div", { class: "subnav", role: "tablist" }, tabs.map(function (t) {
      return h("a", { href: "#settings/" + t[0], class: t[0] === tab ? "is-active" : "", role: "tab", "aria-selected": t[0] === tab ? "true" : "false" }, t[1] + (superOnly[t[0]] && !isSuper() ? " (view)" : ""));
    })));
    CONTENT.site = CONTENT.site || {};
    var cfg = clone(CONTENT.site);
    cfg.social = cfg.social || {};
    cfg.brand = cfg.brand || {};
    cfg.region = cfg.region || { currencies: [], cities: [], weekend: [6, 0] };
    cfg.checkout = cfg.checkout || {};
    cfg.listings = cfg.listings || {};
    cfg.features = cfg.features || {};
    cfg.home = cfg.home || {};
    cfg.promos = cfg.promos || [];
    var errors = errorBox();
    var locked = superOnly[tab] && !isSuper();

    function siteForm(children, check2) {
      return h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
        e.preventDefault();
        if (locked) return;
        var p = check2 ? check2() : [];
        showErrors(errors, p);
        if (p.length) return;
        CONTENT.site = cfg;
        logActivity("Changed the " + tab + " settings", "#settings/" + tab);
        saveContent("Settings saved.");
      } }, errors,
        locked ? h("p", { class: "form-errors", text: "Only a super admin can change these settings. You can view them." }) : null,
        children, locked ? null : editorBar(null, function () { refresh(); }));
    }

    if (tab === "general") {
      view.appendChild(siteForm([
        block("s-id", "Identity", null, [
          row2([fieldNote("Site name", textInput(cfg.name, function (v) { cfg.name = v; }), null, true), fieldNote("Short name (logo)", textInput(cfg.short_name, function (v) { cfg.short_name = v; }, { maxlength: "12" }), "Shown as the logo and in page titles.")]),
          fieldNote("Tagline", textInput(cfg.tagline, function (v) { cfg.tagline = v; })),
          fieldNote("Search description", textArea(cfg.description, function (v) { cfg.description = v; }, { rows: "2", maxlength: "200" }), "Used by search engines. About 150 characters."),
          fieldNote("Site address", textInput(cfg.base_url, function (v) { cfg.base_url = v.trim(); }, { type: "url", placeholder: "https://" }), "Used for links in search results, calendars, and the sitemap."),
          row2([fieldNote("Footer title", textInput(cfg.footer_title, function (v) { cfg.footer_title = v; })), fieldNote("Photo credit", textInput(cfg.photo_credit, function (v) { cfg.photo_credit = v; }))]),
          fieldNote("Footer text", textArea(cfg.footer_blurb, function (v) { cfg.footer_blurb = v; }, { rows: "3" }))
        ]),
        block("s-contact", "Contact and social", null, [
          row2([fieldNote("Email", textInput(cfg.contact_email, function (v) { cfg.contact_email = v.trim(); }, { type: "email" }), null, true), fieldNote("Phone", textInput(cfg.contact_phone, function (v) { cfg.contact_phone = v; }, { type: "tel" }))]),
          row2([fieldNote("LinkedIn", textInput(cfg.social.linkedin, function (v) { cfg.social.linkedin = v.trim(); }, { type: "url", placeholder: "https://linkedin.com/…" })), fieldNote("X", textInput(cfg.social.x, function (v) { cfg.social.x = v.trim(); }, { type: "url", placeholder: "https://x.com/…" }))]),
          row2([fieldNote("Instagram", textInput(cfg.social.instagram, function (v) { cfg.social.instagram = v.trim(); }, { type: "url" })), fieldNote("Facebook", textInput(cfg.social.facebook, function (v) { cfg.social.facebook = v.trim(); }, { type: "url" }))])
        ])
      ], function () {
        var p = [];
        if (!String(cfg.name || "").trim()) p.push("Add the site name.");
        if (!String(cfg.short_name || "").trim()) p.push("Add a short name for the logo.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.contact_email || "")) p.push("Add a valid contact email.");
        if (!/^https:\/\/[^\s/]+/.test(cfg.base_url || "")) p.push("The site address must start with https://.");
        Object.keys(cfg.social).forEach(function (k) { if (cfg.social[k] && !/^https:\/\//.test(cfg.social[k])) p.push("The " + k + " link must start with https://."); });
        return p;
      }));
      return;
    }

    if (tab === "branding") {
      var swatch = h("div", { class: "brand-preview" });
      function paintSwatch() {
        swatch.textContent = "";
        swatch.appendChild(h("span", { class: "bp-logo", style: "background:" + cfg.brand.dark + ";color:" + cfg.brand.warm, text: (cfg.short_name || "?").slice(0, 1) }));
        swatch.appendChild(h("span", { class: "bp-btn", style: "background:" + cfg.brand.dark, text: "Primary button" }));
        swatch.appendChild(h("span", { class: "bp-link", style: "color:" + cfg.brand.accent, text: "Links and labels" }));
        swatch.appendChild(h("span", { class: "bp-chip", style: "background:" + cfg.brand.warm, text: "Highlights" }));
      }
      function colour(label, key, note) {
        return fieldNote(label, h("span", { class: "colour-field" },
          h("input", { type: "color", value: cfg.brand[key] || "#000000", disabled: locked, oninput: function (e) { cfg.brand[key] = e.target.value; paintSwatch(); e.target.nextSibling.value = e.target.value; } }),
          h("input", { class: "search", value: cfg.brand[key] || "", maxlength: "7", disabled: locked, oninput: function (e) { cfg.brand[key] = e.target.value.trim(); paintSwatch(); } })), note);
      }
      paintSwatch();
      view.appendChild(siteForm([
        block("s-brand", "Colours", "Applied to the whole public site and to generated event artwork. Keep enough contrast for text.", [
          row2([colour("Dark (buttons, header text)", "dark"), colour("Accent (links, labels)", "accent")]),
          row2([colour("Warm (highlights, icons)", "warm"), h("div")]),
          swatch
        ])
      ], function () {
        var p = [];
        ["dark", "accent", "warm"].forEach(function (k) { if (!/^#[0-9a-fA-F]{6}$/.test(cfg.brand[k] || "")) p.push("Colour “" + k + "” must look like #1d5fa8."); });
        return p;
      }));
      return;
    }

    if (tab === "region") {
      var reg = cfg.region;
      reg.currencies = reg.currencies || [];
      reg.cities = reg.cities || [];
      reg.weekend = reg.weekend || [6, 0];
      view.appendChild(siteForm([
        block("s-cur", "Currencies", "Each event is priced in its city’s currency. Rates turn prices into an approximate US dollar figure for visitors and for desk totals. Update them regularly.", [
          fieldNote("Default currency", select(reg.currencies.map(function (c) { return [c.code, c.code + " · " + c.name]; }), reg.default_currency, function (e) { reg.default_currency = e.target.value; })),
          repeater(reg.currencies, [
            { key: "code", label: "Code", placeholder: "KES" },
            { key: "name", label: "Name", grow: 2, placeholder: "Kenyan shilling" },
            { key: "per_usd", label: "Per 1 USD", type: "number", min: "0" }
          ], { objects: true, add: "Add currency", make: function () { return { code: "", name: "", per_usd: 1 }; } })
        ]),
        block("s-cities", "Cities", "Cities events can be in. The time zone sets the times shown on event pages; the currency is the default for new events there.", [
          repeater(reg.cities, [
            { key: "name", label: "City", grow: 2 },
            { key: "country", label: "Country", grow: 2 },
            { key: "country_code", label: "Code", placeholder: "KE" },
            { key: "utc_offset", label: "UTC offset", placeholder: "+03:00" },
            { key: "tz_label", label: "Zone", placeholder: "EAT" },
            { key: "currency", label: "Currency", placeholder: "KES" }
          ], { objects: true, add: "Add city", make: function () { return { name: "", country: "", country_code: "", timezone: "", utc_offset: "+03:00", tz_label: "EAT", currency: reg.default_currency || "" }; } })
        ]),
        block("s-week", "Weekend", "Used by the “This weekend” filter.", h("div", { class: "check-grid" }, DAYS.map(function (name, i) {
          return check(name, reg.weekend.indexOf(i) !== -1, function (on) {
            reg.weekend = reg.weekend.filter(function (x) { return x !== i; });
            if (on) reg.weekend.push(i);
            reg.weekend.sort();
          });
        })))
      ], function () {
        var p = [];
        reg.currencies = reg.currencies.filter(function (c) { return String(c.code || "").trim(); }).map(function (c) {
          return { code: String(c.code).trim().toUpperCase(), name: String(c.name || "").trim(), per_usd: Number(c.per_usd) || 0 };
        });
        var codes = reg.currencies.map(function (c) { return c.code; });
        reg.currencies.forEach(function (c) {
          if (!/^[A-Z]{3}$/.test(c.code)) p.push("Currency codes have three letters (" + c.code + ").");
          if (!(c.per_usd > 0)) p.push("Set a rate for " + c.code + ".");
        });
        if (codes.indexOf(reg.default_currency) === -1) p.push("Choose a default currency from the list.");
        reg.cities = reg.cities.filter(function (c) { return String(c.name || "").trim(); });
        reg.cities.forEach(function (c) {
          if (!/^[+-]\d{2}:\d{2}$/.test(c.utc_offset || "")) p.push(c.name + ": the UTC offset looks like +03:00.");
          if (c.currency && codes.indexOf(c.currency) === -1) p.push(c.name + ": currency " + c.currency + " is not in the list.");
        });
        var names = reg.cities.map(function (c) { return c.name; });
        CONTENT.events.forEach(function (ev) {
          if (names.indexOf(ev.city) === -1) p.push("“" + ev.title + "” is in " + ev.city + ", which is not in the city list.");
        });
        if (!reg.weekend.length) p.push("Pick at least one weekend day.");
        return p;
      }));
      return;
    }

    if (tab === "checkout") {
      var co = cfg.checkout;
      view.appendChild(siteForm([
        block("s-pay", "Payment methods", "For events that sell here. Both are simulated in this prototype.", [
          check("Cards (Visa, Mastercard)", co.card !== false, function (v) { co.card = v; }),
          check("Mobile money", co.mobile_money !== false, function (v) { co.mobile_money = v; }),
          fieldNote("Mobile money label", textInput(co.mobile_money_label, function (v) { co.mobile_money_label = v; }, { placeholder: "M-Pesa, Airtel Money, MTN MoMo" }), "Shown next to the option at checkout.")
        ]),
        block("s-fee", "Fees and holds", null, [
          row2([fieldNote("Booking fee (% of the order)", numberInput(co.fee_percent, function (v) { co.fee_percent = v; }, { min: "0", max: "20", step: "0.5" })),
            fieldNote("Seat hold (minutes)", numberInput(co.hold_minutes, function (v) { co.hold_minutes = v; }, { min: "3", max: "30" }))])
        ]),
        block("s-promos", "Promo codes", null, repeater(cfg.promos, [
          { key: "code", label: "Code", placeholder: "DATA10" },
          { key: "percent", label: "% off tickets", type: "number", min: "1" },
          { key: "active", label: "Active", type: "checkbox" }
        ], { objects: true, add: "Add promo code", make: function () { return { code: "", percent: 10, active: true }; } }))
      ], function () {
        var p = [];
        if (co.card === false && co.mobile_money === false) p.push("Keep at least one payment method on.");
        if (!(Number(co.fee_percent) >= 0 && Number(co.fee_percent) <= 20)) p.push("The booking fee must be between 0 and 20%.");
        if (!(Number(co.hold_minutes) >= 3 && Number(co.hold_minutes) <= 30)) p.push("Hold seats for 3 to 30 minutes.");
        cfg.promos = cfg.promos.filter(function (x) { return String(x.code || "").trim(); }).map(function (x) {
          return { code: String(x.code).trim().toUpperCase(), percent: Number(x.percent) || 0, active: !!x.active };
        });
        cfg.promos.forEach(function (x) { if (!(x.percent > 0 && x.percent <= 100)) p.push("Promo " + x.code + " needs a discount between 1 and 100%."); });
        return p;
      }));
      return;
    }

    if (tab === "listings") {
      var li = cfg.listings;
      var fe = cfg.features;
      view.appendChild(siteForm([
        block("s-pages", "Pages and lists", null, [
          row2([fieldNote("Events per page (public site)", numberInput(li.events_per_page, function (v) { li.events_per_page = v; }, { min: "3", max: "60" }), "The events page shows this many, then page numbers."),
            fieldNote("Rows per page (desk default)", select([["10", "10"], ["25", "25"], ["50", "50"], ["100", "100"]], String(li.desk_rows_per_page || 10), function (e) { li.desk_rows_per_page = Number(e.target.value); }), "Each person can change it for themselves.")]),
          check("Show past events on the public events page", li.show_past_public !== false, function (v) { li.show_past_public = v; }, "Past events stay available in the desk either way.")
        ]),
        block("s-features", "Features", "Turn whole features off across the site.", [
          check("Sell tickets on this site", fe.site_checkout !== false, function (v) { fe.site_checkout = v; }, "Off: events set to sell here show “Tickets coming soon”."),
          check("Waitlists for sold-out events", fe.waitlist !== false, function (v) { fe.waitlist = v; }),
          check("Free registration and invitations", fe.rsvp !== false, function (v) { fe.rsvp = v; }),
          check("Promo codes at checkout", fe.promo_codes !== false, function (v) { fe.promo_codes = v; })
        ])
      ], function () {
        var p = [];
        if (!(Number(li.events_per_page) >= 3 && Number(li.events_per_page) <= 60)) p.push("Show between 3 and 60 events per page.");
        return p;
      }));
      return;
    }

    if (tab === "homepage") {
      var current = featuredSlug();
      var hm = cfg.home;
      view.appendChild(panel("Homepage feature", [
        h("p", { class: "meta", text: "The big block at the top of the homepage." }),
        h("div", { class: "feature-pick" }, RECORDS.filter(function (r) { return isUpcoming(r) && life(r.slug) === "published"; }).map(function (r) {
          var on = r.slug === current;
          return h("button", { type: "button", class: "feature-option" + (on ? " is-active" : ""), "aria-pressed": on ? "true" : "false", disabled: !canEdit(), onclick: function () { setFeatured(r.slug); } },
            h("img", { src: "images/opt/" + r.slug + "-640.webp", alt: "", onerror: function () { this.style.visibility = "hidden"; } }), h("strong", { text: r.title }), h("span", { class: "meta", text: r.dates + " · " + r.city }));
        }))
      ]));
      view.appendChild(siteForm([
        block("s-home", "Homepage sections", null, [
          check("Quick picks (This weekend, Free, …)", hm.show_picks !== false, function (v) { hm.show_picks = v; }),
          check("How tickets work", hm.show_steps !== false, function (v) { hm.show_steps = v; }),
          check("By place (city tiles)", hm.show_places !== false, function (v) { hm.show_places = v; }),
          check("Organizer call-out", hm.show_organizer_band !== false, function (v) { hm.show_organizer_band = v; }),
          h("p", { class: "fine" }, "The words in these sections are under ", h("a", { href: "#content/home", text: "Pages & text" }), ".")
        ])
      ]));
      return;
    }

    if (tab === "preview") {
      var config = S.readConfig();
      var form = h("form", { class: "settings-form", onsubmit: function (e) {
        e.preventDefault();
        var c = S.readConfig();
        c.showEarlier = form.showEarlier.checked;
        c.showPrices = form.showPrices.checked;
        c.showInvited = form.showInvited.checked;
        c.notice = form.notice.value.trim().slice(0, 180);
        S.writeConfig(c);
        toast("Preview switches saved in this browser.");
      } },
        panel("Browser preview", [
          h("p", { class: "fine", text: "These switches only change how the public site looks in this browser, for checking layouts. They are not published." }),
          h("label", { class: "switch" }, h("input", { type: "checkbox", name: "showEarlier", checked: config.showEarlier }), " Show past events"),
          h("label", { class: "switch" }, h("input", { type: "checkbox", name: "showPrices", checked: config.showPrices }), " Show prices on cards"),
          h("label", { class: "switch" }, h("input", { type: "checkbox", name: "showInvited", checked: config.showInvited }), " Show capacity"),
          field("Preview a notice bar", h("textarea", { class: "search", name: "notice", rows: "2", maxlength: "180" }, config.notice))
        ]),
        h("div", { class: "admin-actions" }, h("button", { class: "btn signal", type: "submit" }, "Save preview"), button("Reset preview", function () {
          localStorage.removeItem("mdv-config");
          toast("Preview reset.");
          refresh();
        })));
      view.appendChild(form);
      return;
    }

    // data
    var orders = T.readOrders();
    var importInput = h("input", { type: "file", accept: "application/json,.json", onchange: function () {
      var file = importInput.files && importInput.files[0];
      if (!file) return;
      file.text().then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (err) { toast("That file is not valid JSON."); return; }
        var missing = ["site", "events", "venues", "kinds", "badges", "pages", "users"].filter(function (k) { return !(k in data); });
        if (missing.length || !Array.isArray(data.events)) { toast("That file is not a content export (missing " + missing.join(", ") + ")."); return; }
        if (!window.confirm("Replace all site content with " + file.name + " (" + plural(data.events.length, "event") + ")?")) return;
        CONTENT = data;
        logActivity("Imported content from " + file.name, "#settings/data");
        saveContent("Imported " + file.name + ".");
      });
    } });
    view.appendChild(h("div", { class: "card-grid" },
      panel("Content", [
        h("p", { text: plural(CONTENT.events.length, "event") + ", " + plural((CONTENT.organizers || []).length, "organizer") + ", " + plural((CONTENT.venues || []).length, "venue") + ", " + plural((CONTENT.users || []).length, "person", "people") + "." }),
        h("p", { class: "meta", text: SERVER ? "Published from data/content.json. The server keeps the last 20 versions in data/backups/." : "Not connected to serve.py. Export to keep a copy, or to publish by hand." }),
        h("div", { class: "row-actions" }, button("Export content.json", exportContent),
          isSuper() ? h("label", { class: "btn quiet file-btn" }, "Import…", importInput) : h("span", { class: "fine", text: "Only a super admin can import." }))
      ]),
      panel("Orders (this browser)", [
        h("p", { text: plural(orders.length, "record") + " stored in this browser." }),
        h("div", { class: "row-actions" },
          button("Add sample orders", addSamples, "signal"),
          button("Export CSV", exportOrders),
          isAdmin() ? button("Delete all orders", function () {
            if (!window.confirm("Delete every order, invitation, and waitlist entry in this browser?")) return;
            T.writeOrders([]);
            logActivity("Deleted all orders", "#orders");
            toast("All orders deleted.");
            refresh();
          }, "quiet danger") : null)
      ]),
      panel("Activity log", [
        h("p", { text: plural(readActivity().length, "staff action") + " recorded in this browser." }),
        h("div", { class: "row-actions" }, link("Open the log", "#activity"), isAdmin() ? button("Clear the log", function () {
          localStorage.removeItem(ACTIVITY_KEY);
          toast("Activity log cleared.");
          refresh();
        }) : null)
      ])));
  }

  /* ================================================================
   * Analytics: customers, sales, events, and desk users
   * Charts are single-series (one hue); labels and values carry meaning,
   * so nothing depends on telling colours apart.
   * ================================================================ */

  var COUNTRY_BY_PREFIX = [["+254", "Kenya"], ["+256", "Uganda"], ["+255", "Tanzania"], ["+250", "Rwanda"], ["+251", "Ethiopia"], ["+257", "Burundi"], ["+211", "South Sudan"], ["+252", "Somalia"]];

  function countryOfPhone(phone) {
    var p = String(phone || "").replace(/[^\d+]/g, "");
    for (var i = 0; i < COUNTRY_BY_PREFIX.length; i++) if (p.indexOf(COUNTRY_BY_PREFIX[i][0]) === 0) return COUNTRY_BY_PREFIX[i][1];
    return p ? "Other" : "Not given";
  }

  function dayKeyLocal(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  function shortDay(key) {
    var d = new Date(key + "T12:00:00");
    return d.getDate() + " " + MONTHS[d.getMonth()];
  }

  // Ranked horizontal bars: one hue, value text at the bar end.
  function hbars(title, rows, opts) {
    opts = opts || {};
    rows = rows.filter(function (r) { return r[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, opts.limit || 6);
    var max = Math.max.apply(null, rows.map(function (r) { return r[1]; }).concat([1]));
    var body = rows.length
      ? h("ol", { class: "hbars" }, rows.map(function (r) {
        return h("li", {},
          h("span", { class: "hb-label", text: r[0], title: r[0] }),
          h("span", { class: "hb-track", "aria-hidden": "true" }, h("span", { class: "hb-fill", style: "width:" + Math.max(2, Math.round((100 * r[1]) / max)) + "%" })),
          h("span", { class: "hb-value", text: r[2] !== undefined ? r[2] : String(r[1]) }));
      }))
      : empty(opts.empty || "No data for this period yet.");
    return panel(title, [opts.note ? h("p", { class: "fine", text: opts.note }) : null, body]);
  }

  // Daily columns with hover tooltips and a table view.
  function dailyColumns(title, days, valueOf, fmt, note) {
    var keys = [];
    var today = new Date();
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      keys.push(dayKeyLocal(d));
    }
    var values = keys.map(valueOf);
    var max = Math.max.apply(null, values.concat([1]));
    var tip = h("div", { class: "col-tip", role: "status", hidden: true });
    var chart = h("div", { class: "colchart", role: "img", "aria-label": title + ". Highest: " + fmt(max) + "." },
      h("div", { class: "col-axis", "aria-hidden": "true" }, h("span", { text: fmt(max) }), h("span", { text: max >= 4 ? fmt(Math.round(max / 2)) : "" }), h("span", { text: "0" })),
      h("div", { class: "col-plot" },
        h("div", { class: "col-grid", "aria-hidden": "true" }, h("span"), h("span"), h("span")),
        h("div", { class: "col-bars" }, keys.map(function (k, i) {
          var v = values[i];
          var col = h("button", { type: "button", class: "col", "aria-label": shortDay(k) + ": " + fmt(v) },
            h("span", { class: "col-fill" + (v ? "" : " is-zero"), style: "height:" + (v ? Math.max(2, (100 * v) / max) : 0) + "%" }));
          var show = function () {
            tip.hidden = false;
            tip.textContent = shortDay(k) + " · " + fmt(v);
            tip.style.left = Math.min(88, Math.max(6, ((i + 0.5) / keys.length) * 100)) + "%";
          };
          col.addEventListener("mouseenter", show);
          col.addEventListener("focus", show);
          col.addEventListener("mouseleave", function () { tip.hidden = true; });
          col.addEventListener("blur", function () { tip.hidden = true; });
          return col;
        })),
        tip),
      h("div", { class: "col-x", "aria-hidden": "true" }, h("span", { text: shortDay(keys[0]) }), h("span", { text: shortDay(keys[Math.floor(keys.length / 2)]) }), h("span", { text: "Today" })));
    var table = h("details", { class: "data-table" }, h("summary", { text: "Show as a table" }),
      h("table", { class: "admin-table" }, h("thead", {}, h("tr", {}, h("th", { text: "Day" }), h("th", { text: title }))),
        h("tbody", {}, keys.map(function (k, i) { return h("tr", {}, h("td", { text: shortDay(k) }), h("td", { text: fmt(values[i]) })); }))));
    var total = values.reduce(function (n, v) { return n + v; }, 0);
    if (!total) return panel(title, [note ? h("p", { class: "fine", text: note }) : null, empty("Nothing in this period yet. Sales and registrations show up here as they come in.")]);
    return panel(title, [note ? h("p", { class: "fine", text: note }) : null, chart, table]);
  }

  function renderAnalytics(route) {
    state.analytics = state.analytics || { days: 30 };
    if (route.query.days) state.analytics.days = route.query.days === "all" ? "all" : Number(route.query.days) || 30;
    var days = state.analytics.days;
    setHead(sees("money") ? "Sales" : "Content", "Analytics", sees("team")
      ? "Customers, sales, events, and desk users. Money across currencies is in approximate US dollars."
      : sees("money") ? "Customers and sales for the events you sell. Money across currencies is in approximate US dollars."
      : "The shape of the programme: listings, kinds, cities, and organizers.");
    view.appendChild(h("div", { class: "subnav", role: "tablist", "aria-label": "Period" }, [[7, "7 days"], [30, "30 days"], [90, "90 days"], ["all", "All time"]].map(function (t) {
      var on = String(t[0]) === String(days);
      return h("a", { href: "#analytics?days=" + t[0], class: on ? "is-active" : "", role: "tab", "aria-selected": on ? "true" : "false" }, t[1]);
    })));
    var cutoff = days === "all" ? "" : new Date(Date.now() - days * 86400000).toISOString();
    var all = T.readOrders();
    var inP = all.filter(function (o) { return !cutoff || o.created >= cutoff; });
    var paid = inP.filter(function (o) { return o.kind === "order" && T.isLive(o); });
    var refunded = inP.filter(function (o) { return o.status === "refunded"; });
    var revenue = paid.reduce(function (n, o) { return n + toUSD(o.total, ocur(o)); }, 0);
    var tickets = 0;
    var checked = 0;
    inP.forEach(function (o) {
      if (!T.isLive(o)) return;
      tickets += o.tickets.length;
      checked += o.tickets.filter(function (t) { return t.checkedIn; }).length;
    });
    // customers: first-ever order decides "new"
    var firstSeen = {};
    all.forEach(function (o) {
      var e = (o.buyer.email || "").toLowerCase();
      if (e && (!firstSeen[e] || o.created < firstSeen[e])) firstSeen[e] = o.created;
    });
    var people = {};
    inP.forEach(function (o) {
      var e = (o.buyer.email || "").toLowerCase();
      if (!e) return;
      var c = people[e] = people[e] || { name: o.buyer.name, phone: o.buyer.phone, orders: 0, spend: 0, news: false };
      if (o.kind === "order") c.orders += 1;
      if (o.news) c.news = true;
      if (o.kind === "order" && T.isLive(o)) c.spend += toUSD(o.total, ocur(o));
      if (o.buyer.phone) c.phone = o.buyer.phone;
    });
    var emails = Object.keys(people);
    var newCustomers = emails.filter(function (e) { return !cutoff || firstSeen[e] >= cutoff; }).length;
    var repeat = emails.filter(function (e) { return people[e].orders > 1; }).length;
    var optIn = emails.filter(function (e) { return people[e].news; }).length;
    var pct = function (a, b) { return b ? Math.round((100 * a) / b) + "%" : "—"; };

    if (!sees("money")) {
      var lifeN = function (k) { return RECORDS.filter(function (r) { return life(r.slug) === k; }).length; };
      view.appendChild(statGrid([
        ["Live events", lifeN("published"), RECORDS.filter(function (r) { return life(r.slug) === "published" && isUpcoming(r); }).length + " still upcoming"],
        ["Awaiting approval", lifeN("pending"), "In the review queue"],
        ["Rejected", lifeN("draft"), "Need changes before they go live"],
        ["Organizers", (CONTENT.organizers || []).length, "Profiles on the site"]
      ]));
    }
    if (sees("money")) view.appendChild(statGrid([
      ["Customers", emails.length, newCustomers + " new in this period"],
      ["Repeat buyers", pct(repeat, emails.length), repeat + " with more than one order"],
      ["Orders", paid.length, plural(refunded.length, "refund") + " · " + pct(refunded.length, paid.length + refunded.length) + " refund rate"],
      ["Revenue", usdMoney(revenue), "Average order " + usdMoney(paid.length ? revenue / paid.length : 0)],
      ["Tickets", tickets, "Live tickets and registrations"],
      ["Check-in rate", pct(checked, tickets), checked + " of " + tickets + " arrived"],
      ["Marketing opt-in", pct(optIn, emails.length), optIn + " asked for event emails"],
      ["Waitlist", inP.filter(function (o) { return o.kind === "waitlist" && o.status === "waiting"; }).length, "People waiting for a seat"]
    ]));

    var chartDays = days === "all" ? 30 : Math.min(days, 30);
    var byDay = {};
    var revDay = {};
    all.forEach(function (o) {
      if (o.kind !== "order") return;
      var k = dayKeyLocal(new Date(o.created));
      byDay[k] = (byDay[k] || 0) + 1;
      if (T.isLive(o)) revDay[k] = (revDay[k] || 0) + toUSD(o.total, ocur(o));
    });
    if (sees("money")) view.appendChild(h("div", { class: "report-grid wide" },
      dailyColumns("Orders per day", chartDays, function (k) { return byDay[k] || 0; }, function (v) { return String(Math.round(v)); }, "Last " + chartDays + " days."),
      dailyColumns("Revenue per day (≈ USD)", chartDays, function (k) { return Math.round(revDay[k] || 0); }, function (v) { return "USD " + Math.round(v).toLocaleString("en-US"); }, "Paid orders, all currencies converted.")));

    // where sales come from
    var byEvent = {};
    var byCity = {};
    var byCountry = {};
    var byMethod = {};
    var byType = {};
    paid.forEach(function (o) {
      var r = BY[o.slug];
      byEvent[o.title] = (byEvent[o.title] || 0) + toUSD(o.total, ocur(o));
      var city = r ? r.city : "Unknown";
      var seats = o.lines.filter(function (l) { return l.seat; }).reduce(function (n, l) { return n + l.qty; }, 0);
      byCity[city] = (byCity[city] || 0) + seats;
      byMethod[o.method === "mobile" ? "Mobile money" : "Card"] = (byMethod[o.method === "mobile" ? "Mobile money" : "Card"] || 0) + 1;
      o.lines.forEach(function (l) { byType[l.label] = (byType[l.label] || 0) + l.qty; });
    });
    emails.forEach(function (e) {
      var c = countryOfPhone(people[e].phone);
      byCountry[c] = (byCountry[c] || 0) + 1;
    });
    var toRows = function (obj, fmt) { return Object.keys(obj).map(function (k) { return [k, obj[k], fmt ? fmt(obj[k]) : undefined]; }); };
    if (sees("money")) view.appendChild(h("h2", { class: "group-title", text: "Sales and customers" }));
    if (sees("money")) view.appendChild(h("div", { class: "report-grid" },
      hbars("Revenue by event", toRows(byEvent, function (v) { return usdMoney(v); })),
      hbars("Tickets by city", toRows(byCity)),
      hbars("Customers by country", toRows(byCountry), { note: "From the phone number’s country code." }),
      hbars("Payment method", toRows(byMethod)),
      hbars("Ticket types", toRows(byType)),
      hbars("Top customers", emails.map(function (e) { return [people[e].name, people[e].spend, usdMoney(people[e].spend)]; }), { limit: 5 })));

    // the programme
    var count = function (fn) {
      var out = {};
      RECORDS.forEach(function (r) { var k = fn(r); if (k) out[k] = (out[k] || 0) + 1; });
      return toRows(out);
    };
    var sell = RECORDS.filter(function (r) { return mode(r.slug) === "site" && isUpcoming(r); }).map(function (r) {
      var s = eventStats(r.slug);
      return [r.title, s.pct || 0.1, (s.pct || 0) + "% · " + s.sold + " sold"];
    });
    view.appendChild(h("h2", { class: "group-title", text: "Events" }));
    view.appendChild(h("div", { class: "report-grid" },
      hbars("Sell-through, events sold here", sell, { note: "Share of seats sold so far.", empty: "No upcoming events sell here." }),
      hbars("Events by city", count(function (r) { return r.city; })),
      hbars("Events by kind", count(function (r) { return r.kind; })),
      hbars("Events by format", count(function (r) { return (EVT[r.slug] || {}).format || "In person"; })),
      hbars("Upcoming vs past", [["Upcoming", RECORDS.filter(isUpcoming).length], ["Past", RECORDS.filter(function (r) { return !isUpcoming(r); }).length]]),
      hbars("Events by organizer", count(function (r) { var o = organizerOf(r.slug); return o ? o.name : "No organizer"; }))));

    // desk users: admins only
    if (!sees("team")) return;
    var log = readActivity().filter(function (a) { return !cutoff || a.at >= cutoff; });
    var staff = (CONTENT.users || []).map(function (u) {
      var mine = log.filter(function (a) { return a.who === u.name; });
      return { u: u, n: mine.length, last: mine[0] };
    }).sort(function (a, b) { return b.n - a.n; });
    var roles = {};
    (CONTENT.users || []).forEach(function (u) { var k = ROLES[u.role] ? ROLES[u.role].label : u.role; roles[k] = (roles[k] || 0) + 1; });
    view.appendChild(h("h2", { class: "group-title", text: "Desk users" }));
    view.appendChild(h("div", { class: "report-grid" },
      hbars("Actions by person", staff.map(function (x) { return [x.u.name, x.n]; }), { note: "Saved changes, approvals, refunds, check-ins, and sign-ins recorded in this browser.", empty: "No desk activity in this period." }),
      hbars("People by role", toRows(roles)),
      panel("Latest action per person", h("ul", { class: "feed" }, staff.map(function (x) {
        return h("li", {}, h("span", { class: "feed-time", text: x.last ? T.fmtDateTime(x.last.at) : "—" }),
          h("span", {}, h("strong", { text: x.u.name }), " · " + (x.last ? x.last.text : "No activity in this period")),
          h("span", { class: "meta", text: (ROLES[x.u.role] || {}).label + (x.u.active === false ? " · deactivated" : "") }));
      })))));
  }

  /* ================================================================
   * My profile
   * ================================================================ */

  var AVATAR_TONES = [["", "By role"], ["blue", "Blue"], ["green", "Green"], ["amber", "Amber"], ["copper", "Copper"], ["violet", "Violet"], ["slate", "Slate"]];

  function avatarClass(u) {
    return "avatar " + (u.avatar_tone ? "tone-" + u.avatar_tone : "tone-" + u.role);
  }

  function startRoute() {
    var p = (CURRENT && CURRENT.prefs) || {};
    return p.start && can(p.start) ? p.start : homeRoute();
  }

  function renderProfile() {
    var me = CURRENT;
    setHead("Account", "My profile", "Your details, preferences, password, and recent work.");
    var mine = readActivity().filter(function (a) { return a.who === me.name; });
    var month = mine.filter(function (a) { return a.at >= new Date(Date.now() - 30 * 86400000).toISOString(); });
    var created = mine.filter(function (a) { return /^Created /.test(a.text); }).length;
    var approvals = mine.filter(function (a) { return /^Approved /.test(a.text); }).length;

    view.appendChild(h("section", { class: "profile-hero" },
      h("span", { class: avatarClass(me) + " avatar-lg", "aria-hidden": "true", text: initials(me.name) }),
      h("div", { class: "profile-id" },
        h("h2", { text: me.name }),
        h("p", { class: "meta", text: [me.title, me.organization].filter(Boolean).join(" · ") || "Add your job title and organization below." }),
        h("div", { class: "pill-row" }, pill(ROLES[me.role].label, me.role === "super_admin" ? "offered" : "paid"), pill("@" + me.username)),
        me.bio ? h("p", { class: "profile-bio", text: me.bio }) : null),
      h("dl", { class: "kv compact profile-facts" },
        h("div", {}, h("dt", { text: "Email" }), h("dd", { text: me.email })),
        h("div", {}, h("dt", { text: "Phone" }), h("dd", { text: me.phone || "—" })),
        h("div", {}, h("dt", { text: "Country" }), h("dd", { text: me.country || "—" })),
        h("div", {}, h("dt", { text: "Member since" }), h("dd", { text: me.created || "—" })),
        h("div", {}, h("dt", { text: "Last sign-in" }), h("dd", { text: lastSignIn(me) })))));

    view.appendChild(statGrid([
      ["Actions, 30 days", month.length, "Saved changes and decisions"],
      ["Events created", created, "All time, this browser"],
      ["Approvals", approvals, "Listings you approved"],
      ["Role", ROLES[me.role].label, ROLES[me.role].note.split(".")[0] + "."]
    ]));

    // --- details
    var d = { name: me.name, title: me.title || "", organization: me.organization || "", email: me.email, phone: me.phone || "", country: me.country || "", bio: me.bio || "", avatar_tone: me.avatar_tone || "" };
    var errors = errorBox();
    var countries = cities().map(function (c) { return c.country; }).filter(function (c, i, all) { return all.indexOf(c) === i; });
    if (d.country && countries.indexOf(d.country) === -1) countries.push(d.country);
    var preview = h("span", { class: avatarClass({ role: me.role, avatar_tone: d.avatar_tone }) + " avatar-lg", "aria-hidden": "true", text: initials(d.name) });
    var details = h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      var p = [];
      if (!String(d.name).trim()) p.push("Add your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || "")) p.push("Add a valid email.");
      if ((CONTENT.users || []).some(function (x) { return x !== me && String(x.email).toLowerCase() === String(d.email).toLowerCase(); })) p.push("Another account uses that email.");
      showErrors(errors, p);
      if (p.length) return;
      var oldName = me.name;
      Object.keys(d).forEach(function (k) { me[k] = typeof d[k] === "string" ? d[k].trim() : d[k]; });
      logActivity("Updated their profile" + (oldName !== me.name ? " (was " + oldName + ")" : ""), "#profile");
      applyRole();
      saveContent("Profile saved.");
    } },
      errors,
      block("p-details", "Profile details", "Shown to other desk users on Users & roles.", [
        row2([fieldNote("Name", textInput(d.name, function (v) { d.name = v; preview.textContent = initials(v); }), null, true),
          fieldNote("Job title", textInput(d.title, function (v) { d.title = v; }))]),
        row2([fieldNote("Organization", textInput(d.organization, function (v) { d.organization = v; })),
          fieldNote("Country", select([["", "—"]].concat(countries.map(function (c) { return [c, c]; })), d.country, function (e) { d.country = e.target.value; }))]),
        row2([fieldNote("Email", textInput(d.email, function (v) { d.email = v.trim(); }, { type: "email" }), "Also works as your sign-in name.", true),
          fieldNote("Phone", textInput(d.phone, function (v) { d.phone = v; }, { type: "tel", placeholder: "+254 7XX XXX XXX" }))]),
        fieldNote("About you", textArea(d.bio, function (v) { d.bio = v; }, { rows: "3", maxlength: "280" }), "A line or two, up to 280 characters."),
        h("div", { class: "field" }, h("span", { text: "Avatar colour" }),
          h("div", { class: "tone-pick" }, preview, AVATAR_TONES.map(function (t) {
            return h("label", { class: "tone-opt" },
              h("input", { type: "radio", name: "tone", value: t[0], checked: d.avatar_tone === t[0], onchange: function () {
                d.avatar_tone = t[0];
                preview.className = avatarClass({ role: me.role, avatar_tone: t[0] }) + " avatar-lg";
              } }),
              h("span", { class: "tone-dot " + (t[0] ? "tone-" + t[0] : "tone-" + me.role), "aria-hidden": "true" }), " " + t[1]);
          })))
      ]),
      h("p", { class: "fine", text: "Username (" + me.username + ") and role are set by an admin." }),
      editorBar("Save profile", function () { refresh(); }));
    view.appendChild(details);

    // --- preferences
    me.prefs = me.prefs || {};
    var prefs = clone(me.prefs);
    prefs.notify = prefs.notify || { orders: true, refunds: true, approvals: true, weekly: false };
    var startOptions = [["", "Default"]].concat(["home", "events", "approvals", "orders", "checkin", "analytics", "reports"].filter(can).map(function (r) {
      return [r, { home: "Home", events: "All events", approvals: "Approvals", orders: "Orders", checkin: "Door check-in", analytics: "Analytics", reports: "Reports" }[r]];
    }));
    view.appendChild(h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      me.prefs = prefs;
      if (prefs.rows) localStorage.setItem(PAGE_KEY, String(prefs.rows));
      state.pages = {};
      logActivity("Changed their preferences", "#profile");
      saveContent("Preferences saved.");
    } },
      block("p-prefs", "Preferences", null, [
        row2([fieldNote("Start page after sign-in", select(startOptions, prefs.start || "", function (e) { prefs.start = e.target.value; })),
          fieldNote("Rows per page", select([["10", "10"], ["25", "25"], ["50", "50"], ["100", "100"]], String(prefs.rows || pageSize()), function (e) { prefs.rows = Number(e.target.value); }))]),
        h("div", { class: "field" }, h("span", { text: "Email me about" }),
          h("div", { class: "check-grid" },
            check("New orders", prefs.notify.orders, function (v) { prefs.notify.orders = v; }),
            check("Refund requests", prefs.notify.refunds, function (v) { prefs.notify.refunds = v; }),
            check("Listings to approve", prefs.notify.approvals, function (v) { prefs.notify.approvals = v; }),
            check("A weekly summary", prefs.notify.weekly, function (v) { prefs.notify.weekly = v; })),
          h("span", { class: "fine", text: "Saved with your account. Emails are not sent in this prototype." }))
      ]),
      editorBar("Save preferences", function () { refresh(); })));

    // --- password
    var pw = { now: "", next: "", again: "" };
    var pwErrors = errorBox();
    view.appendChild(h("form", { class: "editor", novalidate: true, onsubmit: function (e) {
      e.preventDefault();
      passwordHash(me.username, pw.now).then(function (hash) {
        var p = [];
        if (hash !== me.password) p.push("Your current password is not right.");
        if (pw.next.length < 8) p.push("The new password needs at least 8 characters.");
        if (pw.next !== pw.again) p.push("The two new passwords do not match.");
        if (pw.next && pw.next === pw.now) p.push("Choose a password you have not used here.");
        showErrors(pwErrors, p);
        if (p.length) return;
        passwordHash(me.username, pw.next).then(function (next) {
          me.password = next;
          logActivity("Changed their password", "#profile");
          saveContent("Password changed.");
        });
      });
    } },
      pwErrors,
      block("p-pass", "Password", "At least 8 characters. A short sentence is easier to remember than random symbols.", [
        fieldNote("Current password", h("input", { class: "search", type: "password", autocomplete: "current-password", oninput: function (e) { pw.now = e.target.value; } })),
        row2([fieldNote("New password", h("input", { class: "search", type: "password", autocomplete: "new-password", oninput: function (e) { pw.next = e.target.value; } })),
          fieldNote("New password again", h("input", { class: "search", type: "password", autocomplete: "new-password", oninput: function (e) { pw.again = e.target.value; } }))])
      ]),
      editorBar("Change password", function () { refresh(); })));

    // --- my activity
    view.appendChild(panel("My recent activity", [
      mine.length ? h("ul", { class: "feed" }, mine.slice(0, 10).map(function (a) {
        return h("li", {}, h("span", { class: "feed-time", text: T.fmtDateTime(a.at) }), a.href ? h("a", { href: a.href, text: a.text }) : h("span", { text: a.text }));
      })) : empty("Nothing yet."),
      h("div", { class: "row-actions" }, link("Full activity log", "#activity"), button("Sign out", function () { desk.querySelector("[data-sign-out]").click(); }))
    ]));
  }

  /* ================================================================
   * Global search
   * ================================================================ */

  var searchInput = desk.querySelector("[data-global-search]");
  var searchPop = desk.querySelector("[data-search-pop]");

  function runSearch() {
    var q = searchInput.value.trim().toLowerCase();
    searchPop.textContent = "";
    if (q.length < 2) {
      searchPop.hidden = true;
      return;
    }
    var events = RECORDS.filter(function (r) {
      return (r.title + " " + r.venue + " " + r.city + " " + r.kind).toLowerCase().indexOf(q) !== -1;
    }).slice(0, 5);
    var orders = T.readOrders().filter(function (o) {
      return [o.id, o.buyer.name, o.buyer.email].concat(o.tickets.map(function (t) { return t.code + " " + t.holder; })).join(" ").toLowerCase().indexOf(q) !== -1;
    }).slice(0, 6);
    if (!events.length && !orders.length) {
      searchPop.appendChild(h("p", { class: "meta", text: "Nothing matches “" + searchInput.value.trim() + "”." }));
    }
    if (events.length) {
      searchPop.appendChild(h("p", { class: "kind", text: "Events" }));
      events.forEach(function (r) {
        searchPop.appendChild(h("a", { class: "search-hit", href: "#events/" + r.slug + "/overview" }, h("strong", { text: r.title }), h("span", { class: "meta", text: r.dates + " · " + r.city })));
      });
    }
    if (orders.length) {
      searchPop.appendChild(h("p", { class: "kind", text: "Orders and tickets" }));
      orders.forEach(function (o) {
        searchPop.appendChild(h("a", { class: "search-hit", href: "#orders/" + o.id }, h("strong", { text: o.id + " · " + o.buyer.name }), h("span", { class: "meta", text: o.title + " · " + T.statusLabel(o.status) })));
      });
    }
    searchPop.hidden = false;
  }

  searchInput.addEventListener("input", runSearch);
  searchInput.addEventListener("focus", runSearch);
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      searchInput.value = "";
      searchPop.hidden = true;
      searchInput.blur();
    }
    if (e.key === "Enter") {
      var first = searchPop.querySelector(".search-hit");
      if (first) {
        e.preventDefault();
        go(first.getAttribute("href"));
        searchPop.hidden = true;
        searchInput.blur();
      }
    }
  });
  searchPop.addEventListener("click", function (e) {
    var hit = e.target.closest(".search-hit");
    if (hit) {
      searchPop.hidden = true;
      searchInput.value = "";
      if (location.hash === hit.getAttribute("href")) {
        e.preventDefault();
        render();
      }
    }
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".desk-search")) searchPop.hidden = true;
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !desk.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !dialog.open) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  /* ================================================================
   * Menu (phones), sign-in, live updates
   * ================================================================ */

  function setMenu(open) {
    desk.classList.toggle("is-menu", !!open);
    desk.querySelector("[data-menu-open]").setAttribute("aria-expanded", open ? "true" : "false");
  }

  desk.querySelector("[data-menu-open]").addEventListener("click", function () { setMenu(true); });
  desk.querySelector("[data-menu-close]").addEventListener("click", function () { setMenu(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setMenu(false);
  });

  // Another tab (the public site, a second door phone) changed the data.
  window.addEventListener("storage", function (e) {
    if (desk.hidden || dialog.open) return;
    if ([T.KEY, "mdv-config", ACTIVITY_KEY, DRAFT_KEY, NOTICE_KEY].indexOf(e.key) === -1) return;
    if (e.key === T.KEY) watchIncoming();
    paintBell();
    var active = document.activeElement;
    if (active && view.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
      paintBadges(); // don't yank the field someone is typing in
      return;
    }
    refresh();
  });

  /* ================================================================
   * Passwords (must match password_hash() in render_site.py)
   * ================================================================ */

  // Small SHA-256 for browsers without crypto.subtle (for example file:// in some browsers).
  function sha256(text) {
    function rotr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var maxWord = Math.pow(2, 32);
    var bytes = unescape(encodeURIComponent(text));
    var bitLength = bytes.length * 8;
    var hash = [];
    var k = [];
    var primes = 0;
    var composite = {};
    var i;
    var j;
    for (var candidate = 2; primes < 64; candidate++) {
      if (!composite[candidate]) {
        for (i = 0; i < 313; i += candidate) composite[i] = candidate;
        hash[primes] = (Math.pow(candidate, 0.5) * maxWord) | 0;
        k[primes++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    bytes += "\x80";
    while (bytes.length % 64 - 56) bytes += "\x00";
    var words = [];
    for (i = 0; i < bytes.length; i++) {
      j = bytes.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = (bitLength / maxWord) | 0;
    words[words.length] = bitLength;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16);
      var old = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15];
        var w2 = w[i - 2];
        var a = hash[0];
        var e = hash[4];
        var t1 = hash[7] + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + k[i] +
          (w[i] = i < 16 ? w[i] : (w[i - 16] + (rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    var out = "";
    for (i = 0; i < 8; i++) {
      for (j = 3; j + 1; j--) {
        var b = (hash[i] >> (j * 8)) & 255;
        out += (b < 16 ? "0" : "") + b.toString(16);
      }
    }
    return out;
  }

  function passwordHash(username, password) {
    var text = "mdv:" + String(username).toLowerCase() + ":" + password;
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      }).catch(function () {
        return sha256(text);
      });
    }
    return Promise.resolve(sha256(text));
  }

  /* ================================================================
   * Sign-in and start-up
   * ================================================================ */

  function findUser(id) {
    return (CONTENT.users || []).filter(function (u) { return u.id === id && u.active !== false; })[0] || null;
  }

  function showDesk(u) {
    CURRENT = u;
    gate.hidden = true;
    desk.hidden = false;
    document.body.classList.add("desk-open");
    applyRole();
    paintPublish();
    setupTopActions();
    paintAcctBtn();
    watchIncoming(true);
    paintBell();
    lastRoute = location.hash;
    render();
  }

  var form = document.getElementById("portal-form");
  var formError = form.querySelector(".form-error");

  // Accounts used recently on this browser: one tap fills the username.
  function paintRecent() {
    var old = gate.querySelector(".recent-accts");
    if (old) old.remove();
    var list = recentAccounts();
    if (!list.length) return;
    var box = h("div", { class: "recent-accts" }, h("p", { class: "kind", text: "Recent accounts on this browser" }),
      h("div", { class: "recent-row" }, list.map(function (u) {
        return h("button", { type: "button", class: "recent-acct", onclick: function () {
          form.username.value = u.username;
          form.password.focus();
        } }, h("span", { class: avatarClass(u) + " avatar-sm", "aria-hidden": "true", text: initials(u.name) }),
          h("span", {}, h("strong", { text: u.name }), h("span", { class: "meta", text: ROLES[u.role] ? ROLES[u.role].label : "" })));
      })));
    form.parentNode.insertBefore(box, form);
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = form.username.value.trim().toLowerCase();
    var pw = form.password.value;
    var u = (CONTENT.users || []).filter(function (x) {
      return x.username === name || String(x.email || "").toLowerCase() === name;
    })[0];
    var fail = function (msg) {
      formError.hidden = false;
      formError.textContent = msg;
    };
    if (!u) return fail("That username and password do not match.");
    if (u.active === false) return fail("This account is deactivated. Ask an admin to reactivate it.");
    passwordHash(u.username, pw).then(function (hash) {
      if (hash !== u.password) return fail("That username and password do not match.");
      sessionStorage.setItem(SESSION_KEY, u.id);
      formError.hidden = true;
      form.reset();
      CURRENT = u; // so the sign-in is recorded under their name
      sessionStorage.removeItem(VIEW_AS_KEY);
      logActivity("Signed in (" + ROLES[u.role].label + ")");
      rememberAccount(u);
      var start = startRoute();
      if (!location.hash || location.hash === "#home" || location.hash === "#") history.replaceState(null, "", "#" + start);
      showDesk(u);
      toast("Welcome back, " + u.name.split(" ")[0] + ". Signed in as " + ROLES[u.role].label + ".", "success");
    });
  });

  desk.querySelector("[data-sign-out]").addEventListener("click", function () {
    logActivity("Signed out");
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(DISMISS_KEY);
    sessionStorage.removeItem(VIEW_AS_KEY);
    closeBell();
    closeAcct();
    CURRENT = null;
    document.body.classList.remove("desk-open");
    setMenu(false);
    closeDialog();
    desk.hidden = true;
    gate.hidden = false;
    form.reset();
    paintRecent();
    history.replaceState(null, "", location.pathname);
  });

  var accountBtn = desk.querySelector("[data-account]");
  if (accountBtn) accountBtn.addEventListener("click", function () { go("#profile"); });

  var newBtn = desk.querySelector("[data-new-event]");
  if (newBtn) newBtn.addEventListener("click", function () { go("#events/new"); });

  function boot() {
    var http = location.protocol === "http:" || location.protocol === "https:";
    var ping = http
      ? fetch("api/health", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      : Promise.resolve(null);
    ping.then(function (res) {
      SERVER = !!(res && res.publishing);
      if (SERVER && !readDraft()) {
        return fetch("api/content", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (d) {
          CONTENT = d;
          PUBLISHED_AT = d.updated || "";
          reindex();
        }).catch(function () {});
      }
    }).then(function () {
      var u = findUser(sessionStorage.getItem(SESSION_KEY));
      if (u) showDesk(u);
      else {
        paintPublish();
        paintRecent();
      }
    });
  }

  boot();
})();
