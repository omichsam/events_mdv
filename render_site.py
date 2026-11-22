# -*- coding: utf-8 -*-
"""Write the static multipage site. Run once from the project root."""
import html
import json
import re
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent

# Everything shown on the site comes from data/content.json (see load_content()).
# data/seed.json is the starting point when content.json does not exist yet.
EVENTS = []


def esc(value):
    return html.escape(str(value), quote=True)


def map_url(address):
    return "https://www.google.com/maps/search/?api=1&query=" + quote(address)


# ---------------------------------------------------------------- images
# The originals in images/ are 1600px wide and up to 900 KB. The build writes
# cropped 3:2 copies at two widths, as WebP with a JPEG fallback, into
# images/opt/. Pages use <picture> + srcset so a phone fetches the small one.
IMAGE_WIDTHS = (640, 1200)
IMAGE_RATIO = 1.5


def build_images():
    try:
        from PIL import Image, ImageOps
    except ImportError:
        print("Pillow is not installed: skipping image optimisation (pip install pillow)")
        return
    out = ROOT / "images" / "opt"
    out.mkdir(exist_ok=True)
    made = 0
    for event in EVENTS:
        src = ROOT / "images" / ("%s.jpg" % event["slug"])
        if not src.exists():
            continue
        image = None
        for width in IMAGE_WIDTHS:
            for fmt in ("webp", "jpg"):
                dst = out / ("%s-%d.%s" % (event["slug"], width, fmt))
                if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
                    continue
                if image is None:
                    image = Image.open(src).convert("RGB")
                size = (width, round(width / IMAGE_RATIO))
                frame = ImageOps.fit(image, size, method=Image.LANCZOS, centering=(0.5, 0.45))
                if fmt == "webp":
                    frame.save(dst, "WEBP", quality=74, method=6)
                else:
                    frame.save(dst, "JPEG", quality=78, optimize=True, progressive=True)
                made += 1
    if made:
        print("wrote", made, "optimised images")


def picture(slug, prefix, alt="", sizes="(min-width: 900px) 33vw, 100vw", eager=False):
    base = "%simages/opt/%s" % (prefix, esc(slug))
    webp = ", ".join("%s-%d.webp %dw" % (base, w, w) for w in IMAGE_WIDTHS)
    jpg = ", ".join("%s-%d.jpg %dw" % (base, w, w) for w in IMAGE_WIDTHS)
    big = IMAGE_WIDTHS[-1]
    loading = 'fetchpriority="high"' if eager else 'loading="lazy"'
    return (
        '<picture><source type="image/webp" srcset="{webp}" sizes="{sizes}">'
        '<img src="{base}-{big}.jpg" srcset="{jpg}" sizes="{sizes}" width="{big}" height="{h}" alt="{alt}" decoding="async" {loading}></picture>'
    ).format(webp=webp, jpg=jpg, sizes=sizes, base=base, big=big, h=round(big / IMAGE_RATIO), alt=esc(alt), loading=loading)


ICONS = {
    "calendar": '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
    "pin": '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    "ticket": '<path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4Z"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
    "people": '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6"/>',
    "search": '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>',
    "sliders": '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    "check": '<path d="m5 12 4 4 10-10"/>',
    "qr": '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/>',
}


def icon(name):
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">%s</svg>' % ICONS[name]


# ---------------------------------------------------------------- money, venues
# Region settings, filled by load_content() from site.region in content.json.
DEFAULT_CURRENCY = "KES"
CURRENCY_RATES = {"USD": 1.0}   # units of each currency per US dollar
CITY_INFO = {}                  # city name -> country, code, time zone, currency
BRAND = "MDV"
BASE_URL = "https://example.com"


def currency_of(event):
    return event.get("currency") or CITY_INFO.get(event.get("city"), {}).get("currency") or DEFAULT_CURRENCY


def usd_value(amount, cur):
    rate = CURRENCY_RATES.get(cur)
    if amount is None or not rate:
        return None
    return amount / rate


def usd(amount, cur=None):
    """Approximate US dollars, for visitors. Charges stay in the local currency."""
    cur = cur or DEFAULT_CURRENCY
    if not amount or cur == "USD":
        return ""
    value = usd_value(amount, cur)
    if value is None:
        return ""
    return "≈ USD {:,}".format(max(1, round(value)))


def from_amount(event):
    """Lowest public price in the event currency, 0 for free, None when nothing is published."""
    if event.get("mode") == "rsvp":
        return 0
    # The published "From KES ..." line is what visitors read, so USD, sorting,
    # and the price filter all follow it.
    if event.get("price"):
        return price_amount(event)
    if event.get("mode") == "site" and event.get("types"):
        live = [t["price"] for t in event["types"] if t.get("seat") and t.get("limit", 1) != 0]
        if live:
            return min(live)
    return price_amount(event)


def tz_text(event):
    info = CITY_INFO.get(event.get("city"), {})
    offset = info.get("utc_offset") or event["start"][-6:]
    label = info.get("tz_label")
    name = "%s time" % event["city"] if event.get("format") != "Online" else "%s time" % event["city"]
    return "%s (%sUTC%s)" % (name, (label + ", ") if label else "", offset)


def organizer_of(event):
    for org in CONTENT.get("organizers", []):
        if org.get("id") == event.get("organizer"):
            return org
    return None


def capacity(event):
    return "Capacity %d" % invited_number(event)


def slugify(text):
    out = []
    for ch in text.lower():
        if ch.isalnum() and ch.isascii():
            out.append(ch)
        elif ch in "éè":
            out.append("e")
        else:
            out.append("-")
    return "-".join(part for part in "".join(out).split("-") if part)


def venue_slug(event):
    return slugify(event["venue"] + " " + event["city"])


VENUES = {}  # filled from content.json by load_content()


def venue_info(event):
    return VENUES.get(event["venue"], {"about": "", "transport": "", "access": []})


def access(event):
    """How a visitor gets in: (filter key, short label)."""
    mode = event.get("mode")
    if mode == "site":
        return "site", "Book on MDV"
    if mode == "rsvp":
        return "rsvp", "Invite only" if event.get("invite_code") else "Free · register"
    if event["state"] == "Sold out":
        return "external", "Waitlist open" if event.get("waitlist") else "Sold out"
    if event["state"] == "Sales closed" or mode == "closed":
        return "closed", "Sales closed"
    return "external", ("On %s ↗" % event["provider"]) if event.get("provider") else "Organizer’s site ↗"


def price_line(event):
    if event.get("mode") == "rsvp":
        return "Free with invitation" if event.get("invite_code") else "Free"
    return event["price"] or ""


def duration(event):
    from datetime import datetime
    start = datetime.fromisoformat(event["start"])
    end = datetime.fromisoformat(event["end"])
    days = (end.date() - start.date()).days + 1
    if days > 1:
        return "%d days, %s–%s" % (days, start.strftime("%H:%M"), end.strftime("%H:%M"))
    minutes = int((end - start).total_seconds() // 60)
    hours, rest = divmod(minutes, 60)
    length = ("%d h %d min" % (hours, rest)) if rest else ("%d hours" % hours if hours != 1 else "1 hour")
    return "%s–%s · %s" % (start.strftime("%H:%M"), end.strftime("%H:%M"), length)


def ics(event):
    from datetime import datetime, timezone
    def stamp(iso):
        return datetime.fromisoformat(iso).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    def text(value):
        return value.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MDV//Events//EN", "BEGIN:VEVENT",
        "UID:%s@%s" % (event["slug"], BASE_URL.split("//")[-1]),
        "DTSTAMP:%s" % stamp(event["start"]),
        "DTSTART:%s" % stamp(event["start"]),
        "DTEND:%s" % stamp(event["end"]),
        "SUMMARY:%s" % text(event["title"]),
        "LOCATION:%s" % text(event["address"]),
        "DESCRIPTION:%s" % text(event["offer_line"] + ". %s/events/%s.html" % (BASE_URL, event["slug"])),
        "URL:%s/events/%s.html" % (BASE_URL, event["slug"]),
        "END:VEVENT", "END:VCALENDAR",
    ]
    return "\r\n".join(lines) + "\r\n"


def ticket_control(event, extra_class="", prefix=""):
    state = event["state"]
    cls = ("btn " + extra_class).strip()
    if event.get("mode") == "site" and state in ("On sale", "Limited"):
        return '<a class="%s signal" href="%sevents/%s.html#tickets">Get tickets</a>' % (cls, prefix, esc(event["slug"]))
    if state in ("On sale", "Limited") and event["ticket"] and event.get("provider"):
        return (
            '<a class="%s signal" href="%s" target="_blank" rel="noopener noreferrer">Buy tickets on %s</a>'
            % (cls, esc(event["ticket"]), esc(event["provider"]))
        )
    if state == "Sold out":
        return '<p class="%s is-disabled">Sold out</p>' % cls
    if state == "Invite only":
        return '<p class="%s is-disabled">Invitation required</p>' % cls
    return ""


def fine_print(event):
    if event.get("mode") == "site":
        return "<p class=\"fine\">Sold by MDV. Test mode: no real payment is taken. Refunds follow the <a href=\"../help.html#refunds\">refund policy</a>.</p>"
    if event.get("mode") == "rsvp":
        if event.get("invite_code"):
            return "<p class=\"fine\">Free. The organizer sends the invitation code. MDV confirms your place by email.</p>"
        return "<p class=\"fine\">Free. Register so the organizer can plan. MDV confirms your place by email.</p>"
    if event["state"] == "Sales closed":
        return "<p class=\"fine\">Sales closed. This page stays up as a record of the event.</p>"
    if event["state"] == "Invite only":
        return "<p class=\"fine\">The organizer sends the invitation. There is no public purchase link.</p>"
    if event["provider"]:
        return "<p class=\"fine\">Sold by %s. Opens in a new tab. MDV does not take payment.</p>" % esc(event["provider"])
    return ""


def header(prefix, current):
    def cur(name):
        return ' aria-current="page"' if current == name else ""

    return """<header class="mast" data-mast>
  <div class="wrap mast-inner">
    <a class="logo" href="{p}index.html" aria-label="MDV home">MDV</a>
    <nav aria-label="Main">
      <a href="{p}events.html"{events}>What’s on</a>
      <a href="{p}venues.html"{venues}>Venues</a>
      <a href="{p}help.html"{help}>Help</a>
      <a href="{p}about.html"{about}>About</a>
    </nav>
    <form class="site-search" role="search" action="{p}events.html" method="get" data-site-search-form>
      <label class="sr-only" for="site-q">Search events</label>
      <span class="search-wrap">{icon}<input class="search" id="site-q" name="q" type="search" placeholder="Search events, venues" autocomplete="off"
        data-site-search role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="site-search-list"></span>
      <ul class="search-suggest" id="site-search-list" role="listbox" aria-label="Suggestions" hidden data-site-results></ul>
    </form>
    <button type="button" class="btn quiet search-toggle" data-search-toggle aria-expanded="false" aria-label="Search">{icon}</button>
    <a class="btn signal" href="{p}tickets.html"{tickets}>My tickets</a>
  </div>
</header>""".format(
        p=prefix,
        events=cur("events"),
        venues=cur("venues"),
        help=cur("help"),
        about=cur("about"),
        tickets=cur("tickets"),
        icon=icon("search"),
    )


def footer(prefix):
    social = site("social", {}) or {}
    links = "".join(
        '<a href="%s" target="_blank" rel="noopener noreferrer">%s</a> ' % (esc(url), esc(name))
        for name, url in (("Instagram", social.get("instagram")), ("Facebook", social.get("facebook")), ("X", social.get("x")))
        if url
    )
    phone = site("contact_phone")
    return """<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <p class="footer-mark">{title}</p>
      <p>{blurb}</p>
      {social}
    </div>
    <div>
      <p class="footer-mark">Help</p>
      <p><a href="{p}tickets.html">My tickets</a></p>
      <p><a href="{p}help.html#refunds">Refunds</a> · <a href="{p}help.html#terms">Terms</a> · <a href="{p}help.html#privacy">Privacy</a></p>
      <p><a href="{p}help.html#organizers">List your event</a></p>
    </div>
    <div>
      <p class="footer-mark">Contact</p>
      <p><a data-contact href="mailto:{email}">{email}</a></p>
      {phone}
      <p><a href="{p}about.html">About {name}</a></p>
      <p><a href="{p}portal.html">Organizer desk</a></p>
      <p>{credit}</p>
    </div>
  </div>
</footer>""".format(
        p=prefix,
        title=esc(site("footer_title", "MDV")),
        blurb=esc(site("footer_blurb")),
        social='<p class="social">%s</p>' % links if links else "",
        email=esc(site("contact_email", "hello@mdv.example")),
        phone='<p><a href="tel:%s">%s</a></p>' % (esc(phone.replace(" ", "")), esc(phone)) if phone else "",
        name=esc(site("name", "MDV")),
        credit=esc(site("photo_credit")),
    )


def site_catalog():
    items = []
    for event in EVENTS:
        items.append({
            "listed": event.get("listed", True),
            "currency": currency_of(event),
            "format": event.get("format", "In person"),
            "online_url": event.get("online_url", ""),
            "slug": event["slug"],
            "kind": event["kind"],
            "title": event["title"],
            "summary": event["summary"],
            "dates": event["dates"],
            "place": event["place"],
            "invited": event["invited"],
            "seats": event["seats"],
            "state": event["state"],
            "ticket": event["ticket"] or "",
            "provider": event["provider"] or "",
            "lifecycle": event["lifecycle"],
            "start": event["start"],
            "mon": event["mon"],
            "day": event["day"],
            "year": event["year"],
            "group": event["group"],
            "end": event["end"],
            "address": event["address"],
            "mode": event["mode"],
            "pool": event["pool"],
            "max": event["max_per_order"],
            "types": event["types"],
            "questions": event["questions"],
            "waitlist": event["waitlist"],
            "invite": event["invite_code"],
        })
    return json.dumps(items, ensure_ascii=False).replace("<", "\\u003c")


SITE_DESCRIPTION = "MDV lists conferences, experiences, and workshops in Malé and Hulhumalé. Every event has its own page, with what is offered, directions, and how to get tickets."


def brand_style():
    brand = site("brand", {}) or {}
    pairs = [("--accent", brand.get("accent")), ("--copper", brand.get("warm")), ("--dark", brand.get("dark"))]
    rules = "".join("%s:%s;" % (k, v) for k, v in pairs if v and re.match(r"^#[0-9a-fA-F]{6}$", v))
    return "<style>:root{%s}</style>" % rules if rules else ""


_JSON_SCRIPT = re.compile(r'(<script type="application/json"[^>]*>.*?</script>)', re.S)


def brandify(page):
    """Swap the platform name and base URL into the page, leaving JSON data alone."""
    parts = _JSON_SCRIPT.split(page)
    for i in range(0, len(parts), 2):
        parts[i] = (re.sub(r"\bMDV\b", BRAND, parts[i]).replace("https://mdv.example", BASE_URL)
                    .replace("hello@mdv.example", site("contact_email", "hello@mdv.example")))
    return "".join(parts)


def shell(prefix, title, body_class, current, main, head="", description=None):
    css = prefix + "css/site.css"
    js = prefix + "js/site.js"
    body_attr = ' data-root="%s"' % prefix
    if body_class:
        body_attr = ' class="%s" data-root="%s"' % (body_class, prefix)
    page = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="theme-color" content="#16141c">
  <link rel="icon" href="{p}favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="{css}?v=30">
  <link rel="stylesheet" href="{tcss}?v=30">
  <link rel="stylesheet" href="{p}css/front.css?v=34">
  {brand_style}
  <!--extra-head-->
</head>
<body{body}>
  <a class="skip" href="#content">Skip to content</a>
  {header}
  <p class="site-note wrap" data-site-note hidden></p>
  {main}
  {footer}
  <dialog class="lightbox" id="lightbox">
    <form method="dialog"><button class="btn quiet">Close</button></form>
    <img alt="">
  </dialog>
  <script type="application/json" id="site-catalog">{catalog}</script>
  <script type="application/json" id="site-settings">{settings}</script>
  <script src="{js}?v=31"></script>
  <script src="{tjs}?v=30"></script>
</body>
</html>
""".format(
        title=esc(title),
        description=esc(description or site("description", SITE_DESCRIPTION)),
        brand_style=brand_style(),
        p=prefix,
        css=css,
        body=body_attr,
        header=header(prefix, current),
        main=main,
        footer=footer(prefix),
        js=js,
        tjs=prefix + "js/tickets.js",
        tcss=prefix + "css/tickets.css",
        catalog=site_catalog(),
        settings=site_settings_json(),
    ).replace("<!--extra-head-->", head)
    return brandify(page)


def card(event, prefix, heading="h3"):
    key, label = access(event)
    amount = from_amount(event)
    price = price_line(event)
    left = ""
    if event["state"] == "Sold out":
        left = "0"
    elif event.get("mode") == "site":
        left = str(event.get("pool", ""))
    elif event["seats"].endswith("seats left"):
        left = event["seats"].split()[0]
    sold_out = event["state"] in ("Sold out", "Sales closed")
    life = " hidden" if event["lifecycle"] not in ("published", "archived") or not event.get("listed", True) else ""
    return """<article class="card-shell{dim}" data-event data-kind="{kind}" data-city="{city}" data-month="{month}" data-group="{group}" data-slug="{slug}" data-lifecycle="{life}" data-price="{key}" data-amount="{amount}" data-left="{left}" data-start="{start}" data-end="{end}" data-venue="{venue}"{hidden}>
  <button type="button" class="save" data-save="{slug}" aria-pressed="false" aria-label="Save {title}">Save</button>
  <a class="card" href="{prefix}events/{slug}.html" aria-labelledby="card-{slug}" aria-describedby="card-{slug}-d">
  <div class="photo">
    {picture}
    <div class="dateband" aria-hidden="true">
      <span class="mon">{mon}</span>
      <span class="day">{day}</span>
    </div>
  </div>
  <div class="card-body">
    <p class="card-top"><span class="kind">{kind}</span><span class="access" data-access="{key}">{label}</span></p>
    <{h} class="card-title" id="card-{slug}">{title}</{h}>
    <p class="meta" id="card-{slug}-d">{dates} · {place}<span class="sr-only">. {label}. {price_sr}</span></p>
    <p class="offer">{offer}</p>
    {badges}
    <div class="card-foot">
      <span class="card-price">{price}{usd}</span>
      <span class="state" data-state="{state}">{seats}</span>
    </div>
  </div>
</a>
</article>""".format(
        dim=" is-dim" if sold_out else "",
        badges=badge_row(event),
        kind=esc(event["kind"]),
        city=esc(event["city"]),
        month=esc(event["month"]),
        group=esc(event["group"]),
        prefix=prefix,
        slug=esc(event["slug"]),
        picture=picture(event["slug"], prefix),
        mon=esc(event["mon"]),
        day=esc(event["day"]),
        key=key,
        label=esc(label),
        h=heading,
        title=esc(event["title"]),
        dates=esc(event["dates"]),
        place=esc(event["place"]),
        price_sr=esc(price + ". " if price else ""),
        offer=esc(event["offer_line"]),
        price=esc(price),
        usd=' <span class="usd">%s</span>' % esc(usd(amount, currency_of(event))) if amount else "",
        amount="" if amount is None else (0 if amount == 0 else round(usd_value(amount, currency_of(event)) or 0, 1)),
        left=left,
        start=esc(event["start"]),
        end=esc(event["end"]),
        venue=esc(venue_slug(event)),
        state=esc(event["state"]),
        seats=esc(event["seats"]),
        life=esc(event["lifecycle"]),
        hidden=life,
    )


def chip_row(name, label, options, attr):
    return '<div class="chips" role="group" aria-label="{label}"><span class="chips-label" aria-hidden="true">{label}</span>{chips}</div>'.format(
        label=esc(label),
        chips="".join(
            '<button type="button" class="chip%s" %s="%s" aria-pressed="%s">%s</button>'
            % (" is-active" if i == 0 else "", attr, esc(value), "true" if i == 0 else "false", esc(text))
            for i, (value, text) in enumerate(options)
        ),
    )


KIND_CHIPS = [("All", "All"), ("Conference", "Conferences"), ("Experience", "Experiences"), ("Workshop", "Workshops"), ("Saved", "Saved")]
WHEN_CHIPS = [("any", "Any time"), ("today", "Today"), ("weekend", "This weekend"), ("30d", "Next 30 days")]


def filters(events, include_search, include_selects=True):
    kind_row = chip_row("kind", "Kind", KIND_CHIPS, "data-filter")
    when_row = chip_row("when", "When", WHEN_CHIPS, "data-when")
    if not include_selects:
        return """<div class="filters">
      {kind}
    </div>""".format(kind=kind_row)
    cities = []
    for event in events:
        if event["city"] not in cities:
            cities.append(event["city"])
    city_html = "\n".join('<option value="%s">%s</option>' % (esc(c), esc(c)) for c in cities)
    search = ""
    if include_search:
        search = """<label class="search-field" id="find">
        <span>Search</span>
        <span class="search-wrap">{icon}<input class="search" data-search type="search" placeholder="Title, venue, or what is offered"></span>
      </label>""".format(icon=icon("search"))
    return """<div class="filters">
      <div class="field-row">
        {search}
        <div class="field date-field">
          <span id="date-label">Dates</span>
          <button type="button" class="select date-trigger" data-date-trigger aria-haspopup="dialog" aria-expanded="false" aria-labelledby="date-label date-value">{cal}<span id="date-value" data-date-value>Any date</span></button>
          <div class="date-pop" data-date-pop role="dialog" aria-label="Choose dates" hidden></div>
        </div>
        <button type="button" class="more-toggle" data-more-toggle aria-expanded="false" aria-controls="more-filters">{sliders}<span>Filters</span><b class="more-count" data-more-count hidden></b></button>
        <div class="more-filters" id="more-filters" data-more-filters>
        <label class="field">
          <span>Place</span>
          <select class="select" data-city>
            <option value="All">Everywhere</option>
            {cities}
          </select>
        </label>
        <label class="field">
          <span>Price</span>
          <select class="select" data-amount>
            <option value="All">Any price</option>
            <option value="free">Free</option>
            <option value="lt10">Under USD 10</option>
            <option value="10to50">USD 10–50</option>
            <option value="gt50">Over USD 50</option>
          </select>
        </label>
        <label class="field">
          <span>How to book</span>
          <select class="select" data-price-filter>
            <option value="All">Any way</option>
            <option value="site">Book on MDV</option>
            <option value="external">Organizer’s site</option>
            <option value="rsvp">Invite only</option>
          </select>
        </label>
        </div>
      </div>
      {when}
      {kind}
      <div class="list-tools">
        <p class="meta" data-count aria-live="polite"></p>
        <label class="field inline">
          <span>Sort</span>
          <select class="select" data-sort>
            <option value="date">Soonest first</option>
            <option value="price">Lowest price</option>
            <option value="fast">Fewest seats left</option>
          </select>
        </label>
        <div class="view-toggle" role="group" aria-label="View">
          <button type="button" class="is-active" data-view="list" aria-pressed="true">List</button>
          <button type="button" data-view="calendar" aria-pressed="false">Calendar</button>
        </div>
      </div>
      <div class="active-filters" data-active-filters></div>
    </div>""".format(search=search, cities=city_html, when=when_row, kind=kind_row, cal=icon("calendar"), sliders=icon("sliders"))


def group_section(title, events, prefix, heading="h2"):
    cards = "\n".join(card(event, prefix) for event in events)
    head = (
        '<div class="index-head"><%s>%s</%s></div>' % (heading, esc(title), heading) if title else ""
    )
    return """<section class="group" data-group>
      {head}
      <div class="cards">
        {cards}
      </div>
    </section>""".format(head=head, cards=cards)


def first_sentence(text):
    end = text.find(". ")
    return text[: end + 1] if end != -1 else text


QUICK_PICKS = [
    ("events.html?when=weekend", "This weekend"),
    ("events.html?when=30d", "Next 30 days"),
    ("events.html?price=free", "Free"),
    ("events.html?price=lt10", "Under USD 10"),
    ("events.html?book=site", "Book on MDV"),
    ("events.html?view=calendar", "Calendar"),
]


def index_page():
    upcoming = [event for event in EVENTS if event["group"] == "upcoming"]
    live = [e for e in upcoming if e["lifecycle"] == "published" and e.get("listed", True)]
    featured = next((e for e in live if e.get("featured")), None) or (live or upcoming or EVENTS)[0]
    key, label = access(featured)
    home = CONTENT.get("pages", {}).get("home", {})
    steps = home.get("steps", [])
    org = home.get("organizer", {})
    step_icons = [icon("search"), icon("ticket"), icon("qr")]
    steps_html = "".join(
        "<li>%s<h3>%s</h3><p>%s</p></li>" % (step_icons[i % 3], esc(st["title"]), md_inline(st["body"])) for i, st in enumerate(steps)
    )
    cities = []
    for event in upcoming:
        if event["city"] not in cities:
            cities.append(event["city"])
    city_tiles = "\n".join(
        '<a class="city-tile" href="events.html?city={q}"><strong>{c}</strong><span>{n}</span></a>'.format(
            q=quote(c), c=esc(c), n="%d upcoming" % sum(1 for e in upcoming if e["city"] == c and e["lifecycle"] == "published")
        )
        for c in cities
    )
    picks = "".join('<a class="pick" href="%s">%s</a>' % (href, esc(text)) for href, text in QUICK_PICKS)
    main = """<main id="content">
  <section class="featured" data-featured data-slug="{slug}">
    <div class="wrap featured-grid">
      <div>
        <p class="kind" data-featured-kind>Featured · {kind} · {dates}</p>
        <h1 data-featured-title>{title}</h1>
        <p class="lede" data-featured-summary>{summary}</p>
        <p class="meta" data-featured-meta>{place} · {label}</p>
        <div class="actions" data-featured-actions>
          {tickets}
          <a class="btn quiet" data-featured-page href="events/{slug}.html">Event page</a>
        </div>
      </div>
      <figure class="featured-photo">
        <span class="pic" data-featured-picture>{picture}</span>
        <div class="featured-date" aria-hidden="true">
          <span data-featured-mon>{mon}</span>
          <strong data-featured-day>{day}</strong>
          <span data-featured-year>{year}</span>
        </div>
      </figure>
    </div>
  </section>
  <nav class="wrap picks" aria-label="Quick picks"{picks_hidden}>
    <span class="chips-label">Find something</span>{picks}
  </nav>
  <div class="wrap index" data-index>
    <div class="index-head">
      <h2>Coming up</h2>
      <a class="see-all" href="events.html">All events, search, and filters →</a>
    </div>
    {filters}
    {group}
    <p class="empty" data-empty hidden>Nothing matches. <button type="button" class="text-button" data-clear-filters>Clear filters</button></p>
  </div>
  <section class="wrap home-band"{steps_hidden}>
    <div class="index-head"><h2>How tickets work</h2><a class="see-all" href="help.html#buying">Help with tickets →</a></div>
    <ol class="steps-row">{steps}</ol>
  </section>
  <section class="wrap home-band"{places_hidden}>
    <div class="index-head"><h2>By place</h2><a class="see-all" href="venues.html">All venues →</a></div>
    <div class="city-tiles">{cities}</div>
  </section>
  <section class="wrap organizer-band"{org_hidden}>
    <div>
      <p class="kind">{org_kicker}</p>
      <h2>{org_heading}</h2>
      <p>{org_body}</p>
    </div>
    <a class="btn signal" href="help.html#organizers">{org_button}</a>
  </section>
</main>""".format(
        kind=esc(featured["kind"]),
        dates=esc(featured["dates"]),
        title=esc(featured["title"]),
        summary=esc(first_sentence(featured["summary"])),
        place=esc(featured["place"]),
        label=esc(label),
        tickets=ticket_control(featured),
        slug=esc(featured["slug"]),
        picture=picture(featured["slug"], "", featured["title"], "(min-width: 900px) 45vw, 100vw", eager=True),
        mon=esc(featured["mon"]),
        day=esc(featured["day"]),
        year=esc(featured["year"]),
        picks=picks,
        filters=filters(upcoming, False, include_selects=False),
        group=group_section("", upcoming, ""),
        steps=steps_html,
        picks_hidden="" if (site("home", {}) or {}).get("show_picks", True) else " hidden",
        steps_hidden="" if (site("home", {}) or {}).get("show_steps", True) else " hidden",
        places_hidden="" if (site("home", {}) or {}).get("show_places", True) else " hidden",
        org_hidden="" if (site("home", {}) or {}).get("show_organizer_band", True) else " hidden",
        org_kicker=esc(org.get("kicker", "")),
        org_heading=esc(org.get("heading", "")),
        org_body=md_inline(org.get("body", "")),
        org_button=esc(org.get("button", "How it works")),
        cities=city_tiles,
    )
    return shell("", "%s · %s" % (site("name", "MDV"), site("tagline", "")), "home-page", "home", main)


def events_page():
    from datetime import datetime

    upcoming = [event for event in EVENTS if event["group"] == "upcoming"]
    earlier = [event for event in EVENTS if event["group"] == "earlier"]
    if not (site("listings", {}) or {}).get("show_past_public", True):
        earlier = []
    earlier.sort(key=lambda e: e["start"], reverse=True)
    months = []
    for event in upcoming:
        if event["month"] not in months:
            months.append(event["month"])
    month_groups = "\n".join(
        group_section(datetime.strptime(m, "%Y-%m").strftime("%B %Y"), [e for e in upcoming if e["month"] == m], "")
        for m in months
    )
    main = """<main id="content" class="wrap index events-index" data-index>
    <div class="index-head page-head">
      <div>
        <h1>What’s on</h1>
        <p class="lede">{tagline}</p>
      </div>
    </div>
    {filters}
    <section class="group" data-sorted hidden>
      <div class="index-head"><h2>Results</h2></div>
      <div class="cards" data-sorted-cards></div>
    </section>
    {months}
    {earlier}
    <nav class="pager" data-pager aria-label="Pages" hidden></nav>
    <div class="calendar" data-calendar hidden></div>
    <div class="empty" data-empty hidden>
      <p><strong>Nothing matches these filters.</strong></p>
      <p>Try another date, or <button type="button" class="text-button" data-clear-filters>clear all filters</button>.</p>
    </div>
  </main>""".format(
        filters=filters(EVENTS, True),
        tagline=esc(site("tagline", "")),
        months=month_groups,
        earlier=group_section("Past events", earlier, "") if earlier else "",
    )
    return shell("", "What’s on · MDV", "", "events", main,
                 description=site("description", ""))


def about_page():
    page = CONTENT.get("pages", {}).get("about", {})
    sections = "\n".join(
        "<section><h2>%s</h2>%s</section>" % (esc(sec["heading"]), md(sec["body"])) for sec in page.get("sections", [])
    )
    main = """<main id="content" class="wrap about">
    <header class="page-intro">
      <p class="kind">Company</p>
      <h1>About {name}</h1>
      <p class="lede">{lede}</p>
    </header>
    <div class="modules">
      {sections}
    </div>
  </main>""".format(name=esc(site("name", "MDV")), lede=esc(page.get("lede", "")), sections=sections)
    return shell("", "About · %s" % site("name", "MDV"), "", "about", main)


def visit_section(event):
    included = "\n".join("<li>%s</li>" % esc(item) for item in event.get("included", []))
    notes = "\n".join("<li>%s</li>" % esc(item) for item in event.get("notes", []))
    if not included and not notes and not event.get("arrival") and not event.get("language"):
        return ""
    return """<section>
        <h2>Before you go</h2>
        <h3>Included</h3>
        <ul class="notes">{included}</ul>
        <p class="visit-line"><strong>Arrival</strong>{arrival}</p>
        <p class="visit-line"><strong>Language</strong>{language}</p>
        <h3>Practical notes</h3>
        <ul class="notes">{notes}</ul>
      </section>""".format(
        included=included,
        arrival=esc(event.get("arrival", "")),
        language=esc(event.get("language", "")),
        notes=notes,
    )


def price_amount(event):
    if not event["price"]:
        return None
    digits = "".join(ch for ch in event["price"] if ch.isdigit())
    return int(digits) if digits else None


def event_jsonld(event):
    availability = {
        "On sale": "https://schema.org/InStock",
        "Limited": "https://schema.org/LimitedAvailability",
        "Sold out": "https://schema.org/SoldOut",
    }.get(event["state"], "https://schema.org/InStock")
    data = {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": event["title"],
        "description": event["summary"],
        "startDate": event["start"],
        "endDate": event["end"],
        "eventAttendanceMode": {"Online": "https://schema.org/OnlineEventAttendanceMode", "Hybrid": "https://schema.org/MixedEventAttendanceMode"}.get(event.get("format"), "https://schema.org/OfflineEventAttendanceMode"),
        "eventStatus": "https://schema.org/EventScheduled",
        "inLanguage": "en",
        "location": {
            "@type": "Place",
            "name": event["venue"],
            "address": {
                "@type": "PostalAddress",
                "streetAddress": event["address"],
                "addressLocality": event["city"],
                "addressCountry": CITY_INFO.get(event["city"], {}).get("country_code", ""),
            },
        },
        "organizer": {
            "@type": "Organization",
            "name": (organizer_of(event) or {}).get("name") or event["provider"] or "MDV",
        },
    }
    amount = price_amount(event)
    if event["ticket"] and amount is not None:
        data["offers"] = {
            "@type": "Offer",
            "url": event["ticket"],
            "price": amount,
            "priceCurrency": currency_of(event),
            "availability": availability,
        }
    if event.get("mode") == "site" and event["types"]:
        data["offers"] = [
            {
                "@type": "Offer",
                "name": t["label"],
                "url": "https://mdv.example/events/%s.html#tickets" % event["slug"],
                "price": t["price"],
                "priceCurrency": currency_of(event),
                "availability": "https://schema.org/SoldOut" if t.get("limit") == 0 else availability,
            }
            for t in event["types"]
            if t.get("seat")
        ]
        data["organizer"]["name"] = "MDV"
    blob = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    canonical = "https://mdv.example/events/%s.html" % event["slug"]
    og = (
        '<meta property="og:type" content="event">\n'
        '  <meta property="og:title" content="{t}">\n'
        '  <meta property="og:description" content="{d}">\n'
        '  <meta property="og:url" content="{u}">\n'
        '  <meta property="og:image" content="https://mdv.example/images/opt/{s}-1200.jpg">\n'
        '  <meta name="twitter:card" content="summary_large_image">'
    ).format(t=esc(event["title"]), d=esc(event["offer_line"] + " · " + event["dates"] + " · " + event["place"]), u=esc(canonical), s=esc(event["slug"]))
    return (
        '<link rel="canonical" href="%s">\n  %s\n  <script type="application/ld+json">%s</script>'
        % (esc(canonical), og, blob)
    )


def money(amount, cur=None):
    return "{} {:,}".format(cur or DEFAULT_CURRENCY, amount)


def ticket_box(event):
    """Inner HTML of the Tickets aside on an event page."""
    slug = esc(event["slug"])
    price = "<p class=\"price\">{p}</p>".format(p=esc(event["price"])) if event["price"] else ""
    if event["price"] and from_amount(event):
        price += '<p class="usd-line">%s · charged in %s</p>' % (esc(usd(from_amount(event), currency_of(event))), esc(currency_of(event)))
    state = '<p class="state" data-state="{s}" data-live-state="{slug}">{seats}</p>'.format(
        s=esc(event["state"]), seats=esc(event["seats"]), slug=slug
    )
    mode = event.get("mode")
    features = site("features", {}) or {}
    if mode == "site" and features.get("site_checkout") is False:
        return """{price}
      <p class="state" data-state="Sales closed">Tickets coming soon</p>
      <p class="fine">Online sales are paused. Save this event and check back.</p>""".format(price=price)
    if mode == "rsvp" and features.get("rsvp") is False:
        return """<p class="state" data-state="Sales closed">Registration closed</p>
      <p class="fine">Registration is not open on this site right now.</p>"""
    if mode == "site" and event["state"] in ("On sale", "Limited"):
        rows = []
        for t in event["types"]:
            rows.append(
                """<div class="tt-row" data-type="{id}">
          <div class="tt-info"><strong>{label}</strong><span class="tt-note">{note}</span><span class="tt-left" data-left></span></div>
          <div class="tt-side"><span class="tt-price">{price}</span>
          <div class="qty"><button type="button" data-qty="-1" aria-label="Fewer {label}">−</button><output data-count>0</output><button type="button" data-qty="1" aria-label="More {label}">+</button></div></div>
        </div>""".format(id=esc(t["id"]), label=esc(t["label"]), note=esc(t.get("note", "")), price=esc(money(t["price"], currency_of(event))))
            )
        return """{price}
      {state}
      <div class="tt-list" data-ticket-picker data-slug="{slug}">
        {rows}
      </div>
      <p class="tt-total">Total <strong data-tt-total>{cur} 0</strong></p>
      <a class="btn signal is-off" data-checkout href="../checkout.html?event={slug}" aria-disabled="true">Choose tickets</a>
      {fine}""".format(price=price, state=state, slug=slug, rows="\n".join(rows), fine=fine_print(event), cur=esc(currency_of(event)))
    if mode == "rsvp":
        return """{state}
      <button type="button" class="btn signal" data-dialog-open="rsvp-dialog">{rsvp_label}</button>
      {fine}""".format(state=state, fine=fine_print(event), rsvp_label="Confirm your invitation" if event.get("invite_code") else "Register free")
    extra = ""
    if event.get("waitlist") and event["state"] == "Sold out" and (site("features", {}) or {}).get("waitlist", True):
        extra = '<button type="button" class="btn signal" data-dialog-open="waitlist-dialog">Join the waitlist</button><p class="fine" data-waitlist-count="%s"></p>' % slug
    return "{price}\n      {state}\n      {control}\n      {extra}\n      {fine}".format(
        price=price, state=state, control=ticket_control(event, prefix="../"), extra=extra, fine=fine_print(event)
    )


def event_dialogs(event):
    slug = esc(event["slug"])
    title = esc(event["title"])
    if event.get("mode") == "rsvp":
        return """<dialog class="form-dialog" id="rsvp-dialog">
    <form data-rsvp-form data-slug="{slug}">
      <p class="kind">Invitation</p>
      <h2>Register for {title}</h2>
      <label class="field"><span>Full name</span><input class="search" name="name" required autocomplete="name"></label>
      <label class="field"><span>Email</span><input class="search" type="email" name="email" required autocomplete="email"></label>
      {code_field}
      <label class="field"><span>Anything the studio should know</span><input class="search" name="note" maxlength="140"></label>
      {code_hint}
      <p class="form-error" role="alert" hidden></p>
      <div class="admin-actions"><button class="btn signal" type="submit">Confirm</button><button class="btn quiet" type="button" data-dialog-close>Cancel</button></div>
    </form>
  </dialog>""".format(
            slug=slug, title=title,
            code_field='<label class="field"><span>Invitation code</span><input class="search" name="code" required placeholder="Printed on the invitation"></label>' if event["invite_code"] else "",
            code_hint='<p class="fine">Prototype: the demo code is %s.</p>' % esc(event["invite_code"]) if event["invite_code"] else "")
    if event.get("waitlist"):
        return """<dialog class="form-dialog" id="waitlist-dialog">
    <form data-waitlist-form data-slug="{slug}">
      <p class="kind">Waitlist</p>
      <h2>{title} is sold out</h2>
      <p>Leave your details. If a public seat comes back, MDV emails the first name on the list, who has 24 hours to buy it.</p>
      <label class="field"><span>Full name</span><input class="search" name="name" required autocomplete="name"></label>
      <label class="field"><span>Email</span><input class="search" type="email" name="email" required autocomplete="email"></label>
      <label class="field"><span>Seats wanted</span><select class="select" name="qty"><option>1</option><option>2</option><option>3</option><option>4</option></select></label>
      <p class="form-error" role="alert" hidden></p>
      <div class="admin-actions"><button class="btn signal" type="submit">Join the waitlist</button><button class="btn quiet" type="button" data-dialog-close>Cancel</button></div>
    </form>
  </dialog>""".format(slug=slug, title=title)
    return ""


def related_events(event, limit=3):
    pool = [
        e for e in EVENTS
        if e["slug"] != event["slug"] and e["group"] == "upcoming" and e["lifecycle"] == "published"
    ]
    pool.sort(key=lambda e: (e["kind"] != event["kind"], e["start"]))
    return pool[:limit]


def bullet_list(items, cls="notes"):
    if not items:
        return ""
    return '<ul class="%s">%s</ul>' % (cls, "".join("<li>%s</li>" % esc(i) for i in items))


def event_page(event):
    slug = esc(event["slug"])
    venue = venue_info(event)
    sections = []
    jump = []

    def add(section_id, title, body):
        sections.append('<section id="{i}" aria-labelledby="{i}-h"><h2 id="{i}-h">{t}</h2>{b}</section>'.format(i=section_id, t=esc(title), b=body))
        jump.append('<a href="#{i}">{t}</a>'.format(i=section_id, t=esc(title)))

    # 1. Overview: what you get and who it is for
    offers = "".join(
        "<li><p class=\"kind\">{k}</p><h3>{t}</h3><p>{d}</p></li>".format(k=esc(k), t=esc(t), d=esc(d))
        for k, t, d in event["offers"]
    )
    people = ""
    if event["people_heading"] and event["people"]:
        people = '<h3 class="sub">{h}</h3><ul class="people">{items}</ul>'.format(
            h=esc(event["people_heading"]),
            items="".join("<li><h4>{r}</h4><p>{d}</p></li>".format(r=esc(r), d=esc(d)) for r, d in event["people"]),
        )
    org = organizer_of(event)
    org_html = ""
    if org:
        org_html = """<h3 class="sub">Organizer</h3><div class="organizer-card"><p><strong>{name}</strong> · {type}, {city}</p><p>{about}</p>{site}</div>""".format(
            name=esc(org["name"]), type=esc(org.get("type", "")), city=esc(org.get("city", "")), about=esc(org.get("about", "")),
            site='<p><a href="%s" target="_blank" rel="noopener noreferrer">%s ↗</a></p>' % (esc(org["website"]), esc(org["website"].split("//")[-1])) if org.get("website") else "")
    online = ""
    if event.get("format") in ("Online", "Hybrid"):
        online = '<p class="visit-line"><strong>Online</strong>The joining link is sent with your ticket and shown in My tickets.</p>'
    add("overview", "Overview", """<ul class="offers">{offers}</ul>
        <h3 class="sub">Who it’s for</h3><p>{audience}</p>{online}{people}{org}""".format(
        offers=offers, audience=esc(event["audience"]), people=people, org=org_html, online=online))

    # 2. Schedule
    if event["schedule"]:
        items = "".join(
            "<li><p class=\"when\">{w}</p><h3>{t}</h3><p>{d}</p></li>".format(w=esc(w), t=esc(t), d=esc(d))
            for w, t, d in event["schedule"]
        )
        add("schedule", "Schedule", '<ol class="schedule">%s</ol>' % items)

    # 3. Getting there: one place for address, arrival, transport, and the venue page
    add("getting-there", "Getting there", """<div class="venue-card">
          <div>
            <p class="kind">{heading}</p>
            <h3><a href="../venues/{vslug}.html">{venue}</a></h3>
            <p class="meta">{address}</p>
          </div>
          <a class="btn quiet" href="{map}" target="_blank" rel="noopener noreferrer">{pin} Open in Maps</a>
        </div>
        <p>{arrival}</p>
        {transport}""".format(
        heading=esc(event["place_heading"]),
        vslug=esc(venue_slug(event)),
        venue=esc(event["venue"]),
        address=esc(event["address"]),
        map=map_url(event["address"]),
        pin=icon("pin"),
        arrival=esc(event.get("arrival") or event["directions"]),
        transport='<p class="visit-line"><strong>Transport</strong>%s</p>' % esc(venue["transport"]) if venue["transport"] else "",
    ))

    # 4. What to know: included, practical facts, language, notes
    facts = "".join(
        '<div><dt>{label}</dt><dd>{value}</dd></div>'.format(label=esc(label), value=esc(value))
        for label, value in event.get("facts", [])
    )
    know = ""
    if event.get("included"):
        know += '<h3 class="sub">Included</h3>' + bullet_list(event["included"])
    if facts:
        know += '<h3 class="sub">Good to know</h3><dl class="facts">%s</dl>' % facts
    if event.get("language"):
        know += '<p class="visit-line"><strong>Language</strong>%s</p>' % esc(event["language"])
    if event.get("notes"):
        know += '<h3 class="sub">Practical notes</h3>' + bullet_list(event["notes"])
    if know:
        add("what-to-know", "What to know", know)

    # 5. Accessibility
    if venue["access"]:
        rows = "".join('<div><dt>{a}</dt><dd>{b}</dd></div>'.format(a=esc(a), b=esc(b)) for a, b in venue["access"])
        add("accessibility", "Accessibility", """<dl class="facts access-list">{rows}</dl>
        <p class="fine">Access details come from the organizer and the venue. If you need something specific, ask before you book: <a data-contact href="mailto:hello@mdv.example">hello@mdv.example</a>.</p>""".format(rows=rows))

    # 6. Questions
    faqs = "".join(
        "<details><summary>{q}</summary><p>{a}</p></details>".format(q=esc(q), a=esc(a)) for q, a in event["faq"]
    )
    add("questions", "Questions", """<div class="faq">{faqs}</div>
        <p class="fine">Still unsure? <a href="../help.html">Read the help pages</a> or write to <a data-contact href="mailto:hello@mdv.example">hello@mdv.example</a>.</p>""".format(faqs=faqs))

    key, label = access(event)
    amount = from_amount(event)
    price = price_line(event) or "No public price"
    related = related_events(event)
    related_html = ""
    if related:
        related_html = """<section class="related" aria-labelledby="related-title">
      <div class="index-head"><h2 id="related-title">More events</h2><a class="see-all" href="../events.html">All events →</a></div>
      <div class="cards">{cards}</div>
    </section>""".format(cards="\n".join(card(e, "../") for e in related))

    main = """<main id="content" class="wrap event-layout">
    <nav class="crumbs" aria-label="Breadcrumb">
      <a class="back-results" href="../events.html" data-back-results hidden>← Back to results</a>
      <a href="../events.html">What’s on</a><span aria-hidden="true">/</span><a href="../events.html?kind={kind}">{kind}</a><span aria-hidden="true">/</span><span aria-current="page">{title}</span>
    </nav>
    <header class="event-hero">
      <button type="button" class="hero-photo" data-photo="../images/{slug}.jpg" data-alt="{alt}" aria-label="Open the photo larger">
        {picture}
      </button>
      <p class="site-note" data-page-hidden data-page-life data-slug="{slug}" data-lifecycle="{lifecycle}" hidden></p>
      <p class="kind">{kind} · {format}{level} <span class="countdown" data-countdown="{start}" data-end="{end}"></span></p>
      <h1>{title}</h1>
      {badges}
      <div class="summary-wrap" data-readmore>
        <p class="summary">{summary}</p>
        <button type="button" class="text-button readmore" data-readmore-toggle aria-expanded="false" hidden>Read more</button>
      </div>
      <ul class="keyfacts">
        <li>{i_cal}<div><strong><time datetime="{start}">{dates}</time></strong><span>{duration} · {tz}</span></div></li>
        <li>{i_pin}<div><strong><a href="../venues/{vslug}.html">{venue}</a></strong><span><a href="#getting-there">{city} · How to get there</a></span></div></li>
        <li>{i_ticket}<div><strong class="card-price">{price}</strong><span>{usd}<a href="#tickets">{access}</a></span></div></li>
        <li>{i_people}<div><strong>{capacity}</strong><span data-live-state="{slug}">{seats}</span></div></li>
      </ul>
      <div class="hero-actions">
        <button type="button" class="btn quiet" data-save="{slug}">Save</button>
        <button type="button" class="btn quiet" data-share data-copy>Share</button>
        <a class="btn quiet" href="{slug}.ics" download>Add to calendar</a>
      </div>
    </header>
    <aside class="ticket" id="tickets" aria-labelledby="tickets-h">
      <h2 id="tickets-h">Tickets</h2>
      {ticketbox}
    </aside>
    {dialogs}
    <div class="modules">
      <nav class="jump" aria-label="On this page">{jump}</nav>
      {sections}
    </div>
    {related}
  </main>""".format(
        kind=esc(event["kind"]),
        format=esc(event.get("format") or "In person"),
        level=(" · " + esc(event["level"])) if event.get("level") and event["level"] != "All levels" else "",
        title=esc(event["title"]),
        summary=esc(event["summary"]),
        slug=slug,
        alt=esc(event["title"] + " at " + event["place"]),
        picture=picture(event["slug"], "../", event["title"] + " at " + event["place"], "(min-width: 900px) 60vw, 100vw", eager=True),
        lifecycle=esc(event["lifecycle"]),
        start=esc(event["start"]),
        end=esc(event["end"]),
        dates=esc(event["dates"]),
        duration=esc(duration(event)),
        tz=esc(tz_text(event)),
        vslug=esc(venue_slug(event)),
        venue=esc(event["venue"]),
        city=esc(event["city"]),
        price=esc(price),
        usd=(esc(usd(amount)) + " · ") if amount else "",
        access=esc(label),
        capacity=esc(capacity(event)),
        seats=esc(event["seats"]),
        i_cal=icon("calendar"),
        i_pin=icon("pin"),
        i_ticket=icon("ticket"),
        i_people=icon("people"),
        ticketbox=ticket_box(event),
        dialogs=event_dialogs(event),
        badges=badge_row(event),
        jump="".join(jump),
        sections="\n      ".join(sections),
        related=related_html,
    )
    return shell(
        "../",
        "%s · %s · MDV" % (event["title"], event["dates"]),
        "event-page",
        "event",
        main,
        event_jsonld(event) + '\n  <link rel="stylesheet" href="../css/event-min.css?v=30">',
        description="%s. %s, %s. %s" % (event["offer_line"], event["dates"], event["place"], first_sentence(event["summary"])),
    )


VENUE_FEATURES = [
    ("step-free", "Step-free"), ("ramp", "Ramp"), ("lift", "Lift"), ("accessible toilet", "Accessible toilet"),
    ("hearing loop", "Hearing loop"), ("quiet room", "Quiet room"), ("captions", "Captions"),
]


def venue_features(info):
    """Short access tags read from the venue's access notes."""
    text = " ".join(str(b).lower() for _, b in info.get("access", []))
    return [label for needle, label in VENUE_FEATURES if needle in text]


def venues_index_page():
    """A compact, searchable directory: many venues fit on one screen."""
    by_venue = {}
    for event in EVENTS:
        if event["venue"] != "Online":
            by_venue.setdefault(event["venue"], []).append(event)
    names = [n for n in VENUES if n != "Online"]
    for n in by_venue:
        if n not in names:
            names.append(n)
    cards = []
    city_counts = {}
    for name in names:
        info = VENUES.get(name, {"about": "", "access": [], "city": "", "address": ""})
        events = sorted(by_venue.get(name, []), key=lambda e: e["start"])
        city = info.get("city") or (events[0]["city"] if events else "")
        city_counts[city] = city_counts.get(city, 0) + 1
        upcoming = [e for e in events if e["group"] == "upcoming" and e["lifecycle"] == "published" and e.get("listed", True)]
        feats = venue_features(info)
        country = CITY_INFO.get(city, {}).get("country", "")
        photo = (upcoming or events)[0]["slug"] if (upcoming or events) else ""
        slug = slugify(name + " " + city)
        nxt = upcoming[0] if upcoming else None
        thumb = (
            '<img class="venue-thumb" src="images/opt/%s-640.webp" alt="" loading="lazy" width="640" height="427">' % esc(photo)
            if photo else '<span class="venue-thumb venue-initial" aria-hidden="true">%s</span>' % esc(name[:1])
        )
        cards.append("""<a class="venue-row" href="{href}" data-venue data-name="{name}" data-city="{city}" data-upcoming="{n}" data-stepfree="{sf}" data-search="{search}">
        {thumb}
        <span class="venue-info">
          <strong class="venue-name">{name}</strong>
          <span class="meta">{city}{country} · {address}</span>
          <span class="venue-tags">{tags}</span>
          <span class="venue-next">{next}</span>
        </span>
      </a>""".format(
            href=("venues/%s.html" % esc(slug)) if events else "events.html?q=" + quote(name), name=esc(name), city=esc(city), n=len(upcoming),
            sf="1" if ("Step-free" in feats or "Ramp" in feats) else "0",
            search=esc(" ".join([name, city, country, info.get("address", ""), info.get("about", "")] + feats).lower()),
            thumb=thumb, country=(", " + esc(country)) if country else "", address=esc(info.get("address", "")),
            tags="".join('<span class="vtag">%s</span>' % esc(f) for f in feats[:3]),
            next=("<b>%d upcoming</b> · Next: %s, %s" % (len(upcoming), esc(nxt["title"]), esc(nxt["dates"].split(",")[0]))) if nxt else "No upcoming events",
        ))
    chips = '<button type="button" class="chip is-active" data-venue-city="All" aria-pressed="true">All <span class="chip-count">%d</span></button>' % len(cards)
    chips += "".join(
        '<button type="button" class="chip" data-venue-city="%s" aria-pressed="false">%s <span class="chip-count">%d</span></button>' % (esc(c), esc(c), n)
        for c, n in sorted(city_counts.items(), key=lambda x: (-x[1], x[0])) if c
    )
    main = """<main id="content" class="wrap index venues-index" data-venue-index>
    <div class="index-head page-head">
      <div>
        <h1>Venues</h1>
        <p class="lede">Where events happen, how to get there, and what access is like.</p>
      </div>
    </div>
    <div class="venue-tools">
      <label class="search-field"><span>Search</span><span class="search-wrap">{icon}<input class="search" type="search" data-venue-search placeholder="Venue, area, city, or access"></span></label>
      <label class="field"><span>Sort</span><select class="select" data-venue-sort><option value="upcoming">Most upcoming events</option><option value="name">Name A–Z</option><option value="city">City</option></select></label>
      <div class="chips" role="group" aria-label="City"><span class="chips-label" aria-hidden="true">City</span>{chips}</div>
      <label class="switch"><input type="checkbox" data-venue-stepfree> Step-free entrance only</label>
    </div>
    <p class="meta count-line" data-venue-count aria-live="polite"></p>
    <div class="venue-list" data-venue-list>
      {cards}
    </div>
    <p class="empty" data-venue-empty hidden>No venues match. <button type="button" class="text-button" data-venue-clear>Clear filters</button></p>
    <nav class="pager" data-venue-pager aria-label="Pages" hidden></nav>
  </main>""".format(icon=icon("search"), chips=chips, cards="\n".join(cards))
    return shell("", "Venues · MDV", "", "venues", main,
                 description="Venues that host MDV events, with directions, transport, and accessibility notes.")


def venue_page(name, events):
    first = events[0]
    info = VENUES.get(name, {"about": "", "transport": "", "access": []})
    upcoming = [e for e in events if e["group"] == "upcoming"]
    earlier = [e for e in events if e["group"] != "upcoming"]
    access_rows = "".join('<div><dt>{a}</dt><dd>{b}</dd></div>'.format(a=esc(a), b=esc(b)) for a, b in info["access"])
    main = """<main id="content" class="wrap about venue-page">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="../venues.html">Venues</a><span aria-hidden="true">/</span><span aria-current="page">{name}</span></nav>
    <header class="page-intro">
      <p class="kind">{city}</p>
      <h1>{name}</h1>
      <p class="lede">{about}</p>
      <div class="actions"><a class="btn signal" href="{map}" target="_blank" rel="noopener noreferrer">{pin} Open in Maps</a></div>
    </header>
    <div class="modules">
      <section><h2>Getting there</h2><p><strong>{address}</strong></p><p>{directions}</p>{transport}</section>
      {access}
    </div>
    <section class="related"><div class="index-head"><h2>Upcoming here</h2></div>
      {upcoming}
    </section>
    {earlier}
  </main>""".format(
        name=esc(name), city=esc(first["city"]), about=esc(info["about"]),
        map=map_url(first["address"]), pin=icon("pin"), address=esc(first["address"]), directions=esc(first["directions"]),
        transport='<p class="visit-line"><strong>Transport</strong>%s</p>' % esc(info["transport"]) if info.get("transport") else "",
        access='<section><h2>Accessibility</h2><dl class="facts access-list">%s</dl><p class="fine">Check with the organizer if you need something specific.</p></section>' % access_rows if access_rows else "",
        upcoming='<div class="cards">%s</div>' % "".join(card(e, "../") for e in upcoming) if upcoming else '<p class="empty">No upcoming events here yet.</p>',
        earlier='<section class="related"><div class="index-head"><h2>Earlier here</h2></div><div class="cards">%s</div></section>' % "".join(card(e, "../") for e in earlier) if earlier else "",
    )
    return shell("../", "%s, %s · Venues · MDV" % (name, first["city"]), "", "venues", main,
                 description="%s, %s: directions, transport, accessibility, and upcoming events." % (name, first["city"]))


def invited_number(event):
    return int(event["invited"].split()[0])


def seats_number(event):
    text = event["seats"]
    if text.endswith("seats left"):
        return int(text.split()[0])
    return 0


def portal_record(event):
    return {
        "slug": event["slug"],
        "kind": event["kind"],
        "title": event["title"],
        "summary": event["summary"],
        "dates": event["dates"],
        "month": event["month_label"],
        "city": event["city"],
        "place": event["place"],
        "address": event["address"],
        "directions": event["directions"],
        "invited": event["invited"],
        "seats": event["seats"],
        "state": event["state"],
        "price": event["price"] or "No public price",
        "provider": event["provider"] or "No ticket seller",
        "ticket": event["ticket"] or "",
        "group": "Upcoming" if event["group"] == "upcoming" else "Earlier",
        "lifecycle": event["lifecycle"],
        "mode": event["mode"],
        "offer": event["offer_line"],
        "offers": ["%s · %s — %s" % item for item in event["offers"]],
        "schedule": ["%s — %s. %s" % item for item in event["schedule"]],
        "venue": event.get("venue") or "",
        "language": event.get("language") or "",
        "audience": event.get("audience") or "",
        "included": event.get("included") or [],
        "notes": event.get("notes") or [],
        "facts": ["%s: %s" % pair for pair in event.get("facts", [])],
        "faq": ["%s — %s" % pair for pair in event.get("faq", [])],
        "people": ["%s — %s" % pair for pair in event.get("people", [])],
        "start": event["start"],
        "end": event["end"],
        "featured": bool(event.get("featured")),
        "waitlist": event["waitlist"],
        "invite": event["invite_code"],
    }


def portal_page():
    """The organizer desk. A shell plus data; js/portal.js renders every view."""
    payload = json.dumps(CONTENT, ensure_ascii=False).replace("<", "\\u003c")

    def nav(route, label, badge=False):
        count = '<span class="note-count" data-badge="%s" hidden>0</span>' % route if badge else ""
        return '<a class="side-item" href="#%s" data-route="%s"><span>%s</span>%s</a>' % (route, route, label, count)

    # Grouped by job: run events, sell and admit, write the site, run the system.
    # js/portal.js hides what the signed-in role cannot use.
    side = "\n          ".join([
        '<button type="button" class="btn signal side-new" data-new-event hidden>+ New event</button>',
        nav("home", "Home", True),
        '<p class="side-label">Events</p>',
        nav("events", "All events"),
        nav("approvals", "Approvals", True),
        nav("organizers", "Organizers"),
        '<p class="side-label">Sales</p>',
        nav("orders", "Orders", True),
        nav("checkin", "Door check-in"),
        nav("customers", "Customers"),
        nav("analytics", "Analytics"),
        nav("reports", "Reports"),
        '<p class="side-label">Content</p>',
        nav("content", "Pages &amp; text"),
        nav("venues", "Venues"),
        nav("taxonomy", "Categories &amp; badges"),
        '<p class="side-label">System</p>',
        nav("users", "Users &amp; roles"),
        nav("settings", "Site settings"),
        nav("activity", "Activity log"),
    ])
    main = """<main id="content" class="wrap portal">
    <section class="login-card" id="portal-login">
      <p class="kind">Organizer desk</p>
      <h1>Sign in</h1>
      <p class="lede">The desk is for the people who publish listings and run the door. Visitors can browse the public site without an account.</p>
      <form id="portal-form" novalidate>
        <label class="field">
          <span>Username or email</span>
          <input class="search" type="text" name="username" autocomplete="username" required>
        </label>
        <label class="field">
          <span>Password</span>
          <input class="search" type="password" name="password" autocomplete="current-password" required>
        </label>
        <p class="form-error" role="alert" hidden></p>
        <button class="btn signal" type="submit">Sign in</button>
      </form>
      <p class="fine">Prototype accounts (username / password): admin / admin, editor / editor, boxoffice / boxoffice, door / door. The session ends when this tab closes.</p>
    </section>
    <section id="portal-desk" class="desk-app" hidden>
      <button type="button" class="side-backdrop" data-menu-close aria-label="Close menu"></button>
      <aside class="side" id="admin-drawer">
        <div class="side-brand">
          <a class="logo" href="index.html">MDV</a>
          <p>Desk</p>
        </div>
        <nav class="side-nav" aria-label="Desk">
          {side}
        </nav>
        <div class="side-foot">
          <button type="button" class="side-user" data-account data-route-profile aria-label="My profile">
            <strong data-portal-user></strong><span class="meta" data-portal-role></span>
          </button>
          <a class="side-item" href="index.html" target="_blank" rel="noopener"><span>View public site</span><span aria-hidden="true">↗</span></a>
          <button type="button" class="side-item" data-sign-out><span>Sign out</span></button>
        </div>
      </aside>
      <div class="desk-main">
        <header class="desk-top">
          <button type="button" class="btn quiet desk-menu" data-menu-open aria-expanded="false" aria-controls="admin-drawer">Menu</button>
          <div class="desk-title">
            <p class="kind" data-kicker></p>
            <h1 data-title tabindex="-1">Home</h1>
            <p class="meta" data-note></p>
          </div>
          <div class="desk-search" role="search">
            <input class="search" type="search" data-global-search placeholder="Search events, orders, ticket codes  ( / )" aria-label="Search the desk" autocomplete="off">
            <div class="search-pop" data-search-pop hidden></div>
          </div>
        </header>
        <div class="desk-view" data-view></div>
      </div>
      <div class="toasts" data-toasts aria-live="polite"></div>
      <dialog class="form-dialog wide" id="desk-dialog"><div data-dialog-body></div></dialog>
    </section>
    <script type="application/json" id="portal-content">{payload}</script>
  </main>""".format(side=side, payload=payload)
    head = (
        '<meta name="robots" content="noindex, nofollow">\n'
        '  <link rel="stylesheet" href="css/portal.css?v=32">\n'
        '  <script src="js/portal.js?v=33" defer></script>'
    )
    return shell("", "Desk · MDV", "portal-page", "portal", main, head)


def checkout_page():
    main = """<main id="content" class="wrap checkout" data-checkout-app>
    <p class="test-banner">Test mode. No real payments. Card 4242 4242 4242 4242 succeeds and 4000 0000 0000 0002 is declined. Mobile money: any number succeeds except one ending in 0001.</p>
    <ol class="steps" data-steps>
      <li class="is-active" data-step-label="1">Tickets</li>
      <li data-step-label="2">Details</li>
      <li data-step-label="3">Payment</li>
      <li data-step-label="4">Done</li>
    </ol>
    <div class="checkout-grid">
      <div class="checkout-main">
        <section class="co-step" data-step="1">
          <h1>Choose tickets</h1>
          <div class="co-picker" data-co-picker></div>
          <label class="field promo"><span>Promo code</span>
            <span class="promo-row"><input class="search" data-promo placeholder="Try MDV10"><button type="button" class="btn quiet" data-promo-apply>Apply</button></span>
          </label>
          <p class="fine" data-promo-note></p>
          <p class="form-error" role="alert" data-error="1" hidden></p>
          <button type="button" class="btn signal" data-next="2">Continue</button>
        </section>
        <section class="co-step" data-step="2" hidden>
          <h1>Your details</h1>
          <p class="hold" data-hold>Seats held for <strong data-hold-timer>{hold}:00</strong>. Nobody else can take them while you finish. After that they go back on sale.</p>
          <form data-details novalidate>
            <div class="co-fields">
              <label class="field"><span>Full name</span><input class="search" name="name" required autocomplete="name"></label>
              <label class="field"><span>Email</span><input class="search" type="email" name="email" required autocomplete="email"></label>
              <label class="field"><span>Mobile</span><input class="search" type="tel" name="phone" required autocomplete="tel" placeholder="+960"></label>
            </div>
            <h2>Ticket holders</h2>
            <p class="meta">Each ticket carries a name. Leave a line empty to use your name.</p>
            <div data-holders></div>
            <div data-questions></div>
            <label class="switch"><input type="checkbox" name="terms" required> I agree to the <a href="help.html#terms" target="_blank">terms</a> and the <a href="help.html#refunds" target="_blank">refund policy</a>.</label>
            <label class="switch"><input type="checkbox" name="news"> Email me about new events.</label>
            <p class="form-error" role="alert" data-error="2" hidden></p>
            <div class="admin-actions"><button type="button" class="btn quiet" data-back="1">Back</button><button type="button" class="btn signal" data-next="3">Continue to payment</button></div>
          </form>
        </section>
        <section class="co-step" data-step="3" hidden>
          <h1>Payment</h1>
          <p class="hold">Seats held for <strong data-hold-timer>10:00</strong></p>
          <div class="pay-methods" role="radiogroup" aria-label="Payment method">
            {pay_card}
            {pay_mobile}
          </div>
          <form data-pay novalidate>
            <div data-pay-card{card_hidden}>
              <label class="field"><span>Card number</span><input class="search" name="card" inputmode="numeric" autocomplete="cc-number" placeholder="4242 4242 4242 4242"></label>
              <div class="co-fields">
                <label class="field"><span>Expiry</span><input class="search" name="exp" placeholder="MM/YY" autocomplete="cc-exp"></label>
                <label class="field"><span>CVC</span><input class="search" name="cvc" inputmode="numeric" placeholder="123" autocomplete="cc-csc"></label>
              </div>
              <p class="fine">In the live site these fields are the payment provider’s hosted form. Card details never touch MDV.</p>
            </div>
            <div data-pay-mobile{mobile_hidden}>
              <label class="field"><span>Mobile money number</span><input class="search" name="mobile" type="tel" inputmode="tel" autocomplete="tel" placeholder="+254 7XX XXX XXX"></label>
              <p class="fine">You get a prompt on your phone to approve the payment with your PIN. In this prototype the approval is simulated.</p>
            </div>
            <p class="form-error" role="alert" data-error="3" hidden></p>
            <div class="admin-actions"><button type="button" class="btn quiet" data-back="2">Back</button><button type="submit" class="btn signal" data-pay-button>Pay</button></div>
          </form>
        </section>
        <section class="co-step" data-step="4" hidden>
          <p class="kind">Order confirmed</p>
          <h1 data-done-title>You’re going</h1>
          <p class="lede" data-done-lede></p>
          <div class="admin-actions">
            <a class="btn signal" href="tickets.html">My tickets</a>
            <button type="button" class="btn quiet" data-ics>Add to calendar</button>
            <button type="button" class="btn quiet" onclick="window.print()">Print</button>
          </div>
          <div class="ticket-cards" data-done-tickets></div>
        </section>
        <section class="co-step" data-step="0" hidden>
          <h1>Nothing to check out</h1>
          <p>This event does not sell on MDV checkout, or the link is incomplete.</p>
          <a class="btn signal" href="events.html">Browse events</a>
        </section>
      </div>
      <aside class="summary-card" data-summary>
        <p class="kind">Order summary</p>
        <h2 data-sum-title></h2>
        <p class="meta" data-sum-meta></p>
        <ul class="sum-lines" data-sum-lines></ul>
        <dl class="sum-totals">
          <div><dt>Subtotal</dt><dd data-sum-sub>0</dd></div>
          <div data-sum-discount-row hidden><dt>Discount</dt><dd data-sum-discount></dd></div>
          <div><dt>Booking fee</dt><dd data-sum-fee>0</dd></div>
          <div class="sum-total"><dt>Total</dt><dd data-sum-total>0</dd></div>
          <div class="sum-usd"><dt>About</dt><dd data-sum-usd></dd></div>
        </dl>
        <p class="fine">Prices include taxes where they apply. Booking fee {fee}% of the order. You pay in the event’s currency; the USD figure is approximate.</p>
      </aside>
    </div>
  </main>"""
    co = site("checkout", {}) or {}
    card_on = co.get("card", True)
    mobile_on = co.get("mobile_money", True) or not card_on
    main = (main.replace("{fee}", str(co.get("fee_percent", 3))).replace("{hold}", str(co.get("hold_minutes", 10)))
            .replace("{pay_card}", '<label class="pay-method"><input type="radio" name="method" value="card" checked> Card <span class="meta">Visa, Mastercard</span></label>' if card_on else "")
            .replace("{pay_mobile}", '<label class="pay-method"><input type="radio" name="method" value="mobile"%s> Mobile money <span class="meta">%s</span></label>' % ("" if card_on else " checked", esc(co.get("mobile_money_label", ""))) if mobile_on else "")
            .replace("{card_hidden}", "" if card_on else " hidden")
            .replace("{mobile_hidden}", " hidden" if card_on else ""))
    return shell("", "Checkout · MDV", "checkout-page", "checkout", main, '<meta name="robots" content="noindex">')


def tickets_page():
    main = """<main id="content" class="wrap my-tickets" data-my-tickets>
    <header class="page-intro">
      <p class="kind">Your orders</p>
      <h1>My tickets</h1>
      <p class="lede">Tickets bought on MDV checkout and confirmed invitations. Show the QR code at the door, from your phone or printed.</p>
    </header>
    <form class="lookup" data-lookup>
      <label class="field"><span>Find an order by email</span><input class="search" type="email" name="email" placeholder="The email used at checkout" required></label>
      <button class="btn quiet" type="submit">Find</button>
    </form>
    <p class="fine">Prototype: orders are kept in this browser. In the live site this sends a sign-in link to the email.</p>
    <div data-orders></div>
    <p class="empty" data-orders-empty hidden>No orders yet. <a href="events.html">Browse events</a> — Night Market Walk and Reef Dawn sell on MDV checkout.</p>
  </main>"""
    return shell("", "My tickets · MDV", "tickets-page", "tickets", main, '<meta name="robots" content="noindex">')


def help_page():
    page = CONTENT.get("pages", {}).get("help", {})
    sections = page.get("sections", [])
    nav = "".join('<a href="#%s">%s</a>' % (esc(sec.get("id") or slugify(sec["heading"])), esc(sec["heading"])) for sec in sections)
    body = "\n".join(
        '<section id="%s"><h2>%s</h2>%s</section>' % (esc(sec.get("id") or slugify(sec["heading"])), esc(sec["heading"]), md(sec["body"]))
        for sec in sections
    )
    faq = page.get("faq", [])
    if faq:
        nav += '<a href="#questions">Questions</a>'
        body += '<section id="questions"><h2>Questions</h2><div class="faq">%s</div></section>' % "".join(
            "<details><summary>%s</summary><p>%s</p></details>" % (esc(f["q"]), md_inline(f["a"])) for f in faq)
    main = """<main id="content" class="wrap about help">
    <header class="page-intro">
      <p class="kind">Help</p>
      <h1>Help and policies</h1>
      <p class="lede">{lede}</p>
      <nav class="help-nav" aria-label="On this page">{nav}</nav>
    </header>
    <div class="modules">
      {body}
    </div>
  </main>""".format(lede=esc(page.get("lede", "")), nav=nav, body=body)
    return shell("", "Help · %s" % site("name", "MDV"), "", "help", main)


# ================================================================ content store
# data/content.json is the source of truth for events, venues, categories,
# badges, page text, site settings, and desk users. The first build writes it
# from the defaults in this file; after that the desk edits it (through
# serve.py) and every build reads it.
import hashlib
import re
from datetime import datetime, timedelta, timezone

CONTENT_PATH = ROOT / "data" / "content.json"
CONTENT = {}
MV_TZ = timezone(timedelta(hours=5))

EVENT_KEYS = [
    "slug", "title", "kind", "summary", "offer_line", "start", "end", "lifecycle", "listed", "featured",
    "badges", "venue", "city", "address", "directions", "arrival", "place_heading",
    "capacity", "seats", "state", "price", "provider", "ticket", "mode", "pool", "max_per_order",
    "types", "questions", "waitlist", "invite_code",
    "offers_heading", "offers", "schedule", "people_heading", "people",
    "audience", "language", "included", "notes", "facts", "faq",
]
TUPLE_LISTS = ("offers", "schedule", "people", "faq", "facts")


def password_hash(username, password):
    """Must match passwordHash() in js/portal.js."""
    return hashlib.sha256(("mdv:%s:%s" % (username.lower(), password)).encode("utf-8")).hexdigest()


SEED_PATH = ROOT / "data" / "seed.json"


def seed_content():
    """The first build copies data/seed.json (written by data/make_seed.py)."""
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def derive(event):
    """Fill the display fields from the stored ones (dates from start/end, etc.)."""
    start = datetime.fromisoformat(event["start"])
    end = datetime.fromisoformat(event["end"]) if event.get("end") else start
    if end < start:
        end = start
    if start.date() == end.date():
        event["dates"] = "%d %s %d, %s" % (start.day, start.strftime("%b"), start.year, start.strftime("%H:%M"))
        event["day"] = str(start.day)
    elif (start.year, start.month) == (end.year, end.month):
        event["dates"] = "%d–%d %s %d" % (start.day, end.day, start.strftime("%b"), start.year)
        event["day"] = "%d–%d" % (start.day, end.day)
    else:
        event["dates"] = "%d %s %d – %d %s %d" % (start.day, start.strftime("%b"), start.year, end.day, end.strftime("%b"), end.year)
        event["day"] = str(start.day)
    event["month"] = start.strftime("%Y-%m")
    event["month_label"] = start.strftime("%b %Y")
    event["mon"] = start.strftime("%b")
    event["year"] = str(start.year)
    today = datetime.now(end.tzinfo or MV_TZ).date()
    event["group"] = "upcoming" if end.date() >= today else "earlier"
    event["place"] = "Online" if event.get("venue") == "Online" else "%s, %s" % (event["venue"], event["city"])
    event["invited"] = "%d invited" % int(event.get("capacity") or 0)
    event.setdefault("format", "In person")
    return event


def normalize_event(raw):
    e = dict(raw)
    defaults = {
        "listed": True, "featured": False, "badges": [], "lifecycle": "pending", "mode": "external",
        "pool": 0, "max_per_order": 6, "types": [], "questions": [], "waitlist": False, "invite_code": "",
        "offers_heading": "What’s on", "people_heading": "", "place_heading": "Place and directions",
        "audience": "", "language": "", "arrival": "", "included": [], "notes": [], "price": None,
        "provider": None, "ticket": None, "seats": "", "state": "On sale", "capacity": 0,
        "offers": [], "schedule": [], "people": [], "faq": [], "facts": [], "directions": "", "address": "",
        "summary": "", "offer_line": "", "format": "In person", "online_url": "", "level": "All levels",
        "organizer": "", "currency": "",
    }
    for k, v in defaults.items():
        if e.get(k) is None and v is not None:
            e[k] = v
        e.setdefault(k, v)
    for key in TUPLE_LISTS:
        e[key] = [tuple(item) for item in e.get(key) or []]
    for key in ("price", "provider", "ticket"):
        if e.get(key) == "":
            e[key] = None
    if e.get("mode") == "mdv":  # older content
        e["mode"] = "site"
    return derive(e)


def load_content():
    global KIND_CHIPS, DEFAULT_CURRENCY, BRAND, BASE_URL
    if CONTENT_PATH.exists():
        data = json.loads(CONTENT_PATH.read_text(encoding="utf-8"))
    else:
        data = seed_content()
        CONTENT_PATH.parent.mkdir(exist_ok=True)
        CONTENT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print("wrote", CONTENT_PATH.relative_to(ROOT), "(seeded from render_site.py)")
    CONTENT.clear()
    CONTENT.update(data)
    EVENTS[:] = sorted((normalize_event(e) for e in data["events"]), key=lambda e: e["start"])
    VENUES.clear()
    for v in data.get("venues", []):
        VENUES[v["name"]] = {
            "about": v.get("about", ""),
            "transport": v.get("transport", ""),
            "access": [tuple(a) for a in v.get("access", [])],
            "city": v.get("city", ""),
            "address": v.get("address", ""),
            "directions": v.get("directions", ""),
        }
    site_cfg = data.get("site", {})
    region = site_cfg.get("region", {})
    DEFAULT_CURRENCY = region.get("default_currency") or "KES"
    CURRENCY_RATES.clear()
    CURRENCY_RATES.update({c["code"]: float(c.get("per_usd") or 0) for c in region.get("currencies", []) if c.get("code")})
    CURRENCY_RATES.setdefault("USD", 1.0)
    CITY_INFO.clear()
    CITY_INFO.update({c["name"]: c for c in region.get("cities", []) if c.get("name")})
    BRAND = site_cfg.get("short_name") or site_cfg.get("name") or "MDV"
    BASE_URL = (site_cfg.get("base_url") or "https://example.com").rstrip("/")
    KIND_CHIPS = [("All", "All")] + [(k["name"], k.get("plural") or k["name"] + "s") for k in data.get("kinds", [])] + [("Saved", "Saved")]


def site(key, default=""):
    return CONTENT.get("site", {}).get(key, default)


def badge_defs():
    return {b["id"]: b for b in CONTENT.get("badges", [])}


def badge_row(event, cls="badge-row"):
    defs = badge_defs()
    items = [defs[b] for b in event.get("badges", []) if b in defs]
    if not items:
        return ""
    return '<ul class="%s" aria-label="Highlights">%s</ul>' % (
        cls, "".join('<li class="badge tone-%s">%s</li>' % (esc(b.get("tone", "neutral")), esc(b["label"])) for b in items))


# Web, email, phone, in-page, a root path, or a page on this site. Never "//host"
# (protocol-relative, which would leave the site) or scripts.
_SAFE_URL = re.compile(r"^(https?://|mailto:|tel:|#|/(?!/)|[a-zA-Z0-9_.-][a-zA-Z0-9_./-]*(\?[\w=&%.,+:-]*)?(#[\w-]+)?$)")


def md_inline(text, prefix=""):
    out = esc(text)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1<em>\2</em>", out)

    def link(m):
        label, url = m.group(1), html.unescape(m.group(2))
        if not _SAFE_URL.match(url):
            return label
        if not re.match(r"^(https?://|mailto:|tel:|#|/)", url):
            url = prefix + url
        ext = ' target="_blank" rel="noopener noreferrer"' if url.startswith("http") else ""
        return '<a href="%s"%s>%s</a>' % (esc(url), ext, label)

    return re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, out)


def md(text, prefix=""):
    """A small, safe subset of Markdown, matching the desk's rich-text editor:
    paragraphs, '- ' and '1. ' lists, **bold**, *italic*, [links](url)."""
    blocks = []
    for chunk in re.split(r"\n\s*\n", (text or "").strip()):
        lines = [l.strip() for l in chunk.splitlines() if l.strip()]
        if not lines:
            continue
        if all(l.startswith("- ") for l in lines):
            blocks.append('<ul class="notes">%s</ul>' % "".join("<li>%s</li>" % md_inline(l[2:], prefix) for l in lines))
        elif all(re.match(r"^\d+[.)] ", l) for l in lines):
            blocks.append('<ol class="notes numbered">%s</ol>' % "".join("<li>%s</li>" % md_inline(re.sub(r"^\d+[.)] ", "", l), prefix) for l in lines))
        else:
            blocks.append("<p>%s</p>" % md_inline(" ".join(lines), prefix))
    return "\n".join(blocks)


def site_settings_json():
    checkout = site("checkout", {}) or {}
    features = site("features", {}) or {}
    listings = site("listings", {}) or {}
    region = site("region", {}) or {}
    promos = site("promos", []) if features.get("promo_codes", True) else []
    data = {
        "brand": BRAND,
        "feePercent": checkout.get("fee_percent", 3),
        "hold": checkout.get("hold_minutes", 10),
        "card": checkout.get("card", True),
        "mobile": checkout.get("mobile_money", True),
        "mobileLabel": checkout.get("mobile_money_label", "Mobile money"),
        "promos": {p["code"].upper(): p["percent"] / 100.0 for p in promos if p.get("active") and p.get("code")},
        "rates": CURRENCY_RATES,
        "currency": DEFAULT_CURRENCY,
        "weekend": region.get("weekend", [6, 0]),
        "perPage": listings.get("events_per_page", 9),
        "waitlist": features.get("waitlist", True),
    }
    return json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")


def placeholder_image(event):
    """Events without a photo get generated "data" artwork, different per event.
    Upload a real photo in the desk (Edit → Photo) to replace it."""
    src = ROOT / "images" / ("%s.jpg" % event["slug"])
    if src.exists():
        return
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return
    import random
    rng = random.Random(event["slug"])
    brand = site("brand", {}) or {}

    def rgb(hex_value, fallback):
        h = (hex_value or fallback).lstrip("#")
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    dark, accent, warm = rgb(brand.get("dark"), "121923"), rgb(brand.get("accent"), "1d5fa8"), rgb(brand.get("warm"), "e0782f")
    w, h = 1600, 1067
    img = Image.new("RGB", (w, h), dark)
    d = ImageDraw.Draw(img)
    for y in range(h):  # soft vertical glow
        t = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(dark[i] * (1 - 0.35 * t) + accent[i] * 0.35 * t) for i in range(3)))
    for x in range(0, w, 80):  # grid
        d.line([(x, 0), (x, h)], fill=tuple(min(255, c + 14) for c in dark))
    for y in range(0, h, 80):
        d.line([(0, y), (w, y)], fill=tuple(min(255, c + 14) for c in dark))
    kind = event.get("kind", "")
    if kind == "Conference":  # bar chart
        n = 14
        for i in range(n):
            bh = rng.randint(180, 760)
            x0 = 120 + i * 98
            d.rectangle([x0, h - 120 - bh, x0 + 62, h - 120], fill=warm if i % 4 == 0 else accent)
    elif kind == "Meetup":  # network
        pts = [(rng.randint(140, w - 140), rng.randint(140, h - 140)) for _ in range(26)]
        for i, a in enumerate(pts):
            for b in pts[i + 1:]:
                if (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 < 300 ** 2:
                    d.line([a, b], fill=accent, width=3)
        for i, (x, y) in enumerate(pts):
            r = rng.randint(10, 26)
            d.ellipse([x - r, y - r, x + r, y + r], fill=warm if i % 5 == 0 else (235, 240, 248))
    elif kind == "Hackathon":  # scatter + trend
        for _ in range(220):
            x = rng.randint(120, w - 120)
            y = int(h - 140 - (x - 120) * 0.55 + rng.gauss(0, 90))
            r = rng.randint(5, 12)
            d.ellipse([x - r, y - r, x + r, y + r], fill=accent if rng.random() > 0.2 else warm)
        d.line([(120, h - 140), (w - 120, h - 140 - (w - 240) * 0.55)], fill=(240, 240, 240), width=6)
    else:  # workshop: line chart
        y = rng.randint(500, 800)
        last = (120, y)
        for x in range(200, w - 100, 80):
            y = max(160, min(h - 160, y + rng.randint(-120, 100)))
            d.line([last, (x, y)], fill=warm, width=10)
            d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=(240, 240, 240))
            last = (x, y)
    img.save(src, "JPEG", quality=88)


FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#16141c"/><path d="M14 46V18h7l11 15 11-15h7v28h-7V30L32 44 21 30v16z" fill="#f3e6d4"/></svg>
"""


def not_found_page():
    upcoming = [e for e in EVENTS if e["group"] == "upcoming" and e["lifecycle"] == "published"][:3]
    main = """<main id="content" class="wrap about not-found">
    <header class="page-intro">
      <p class="kind">404</p>
      <h1>That page isn’t here</h1>
      <p class="lede">The link may be old, or the event may have moved. These are coming up next.</p>
      <div class="actions"><a class="btn signal" href="/events.html">Browse events</a> <a class="btn quiet" href="/help.html">Help</a></div>
    </header>
    <div class="cards">{cards}</div>
  </main>""".format(cards="\n".join(card(e, "/") for e in upcoming))
    return shell("/", "Page not found · MDV", "", "404", main, '<meta name="robots" content="noindex">')


def main():
    load_content()
    (ROOT / "events").mkdir(exist_ok=True)
    for event in EVENTS:
        placeholder_image(event)
    build_images()
    keep = {e["slug"] for e in EVENTS}
    for old in list((ROOT / "events").glob("*.html")) + list((ROOT / "events").glob("*.ics")):
        if old.stem not in keep:
            old.unlink()
    (ROOT / "index.html").write_text(index_page(), encoding="utf-8")
    (ROOT / "events.html").write_text(events_page(), encoding="utf-8")
    (ROOT / "about.html").write_text(about_page(), encoding="utf-8")
    (ROOT / "portal.html").write_text(portal_page(), encoding="utf-8")
    (ROOT / "checkout.html").write_text(checkout_page(), encoding="utf-8")
    (ROOT / "tickets.html").write_text(tickets_page(), encoding="utf-8")
    (ROOT / "help.html").write_text(help_page(), encoding="utf-8")
    (ROOT / "404.html").write_text(not_found_page(), encoding="utf-8")
    (ROOT / "venues").mkdir(exist_ok=True)
    (ROOT / "venues.html").write_text(venues_index_page(), encoding="utf-8")
    by_venue = {}
    for event in EVENTS:
        by_venue.setdefault(event["venue"], []).append(event)
    for name, events in by_venue.items():
        if name == "Online":
            continue
        (ROOT / "venues" / ("%s.html" % venue_slug(events[0]))).write_text(venue_page(name, events), encoding="utf-8")
    brand = site("brand", {}) or {}
    (ROOT / "favicon.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="%s"/>'
        '<text x="32" y="44" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="34" fill="%s">%s</text></svg>\n'
        % (esc(brand.get("dark", "#121923")), esc(brand.get("warm", "#e0782f")), esc(BRAND[:1].upper())), encoding="utf-8")
    for event in EVENTS:
        path = ROOT / "events" / ("%s.html" % event["slug"])
        path.write_text(event_page(event), encoding="utf-8")
        (ROOT / "events" / ("%s.ics" % event["slug"])).write_bytes(brandify(ics(event)).encode("utf-8"))
    locs = ["https://mdv.example/", "https://mdv.example/events.html", "https://mdv.example/about.html", "https://mdv.example/help.html", "https://mdv.example/venues.html"]
    locs.extend("https://mdv.example/events/%s.html" % event["slug"] for event in EVENTS if event["lifecycle"] == "published")
    locs.extend("https://mdv.example/venues/%s.html" % slug for slug in sorted({venue_slug(e) for e in EVENTS if e["venue"] != "Online"}))
    body = "\n".join("<url><loc>%s</loc></url>" % loc.replace("https://mdv.example", BASE_URL) for loc in locs)
    (ROOT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s\n</urlset>\n' % body,
        encoding="utf-8",
    )
    keep_venues = {venue_slug(e) for e in EVENTS if e["venue"] != "Online"}
    for old in (ROOT / "venues").glob("*.html"):
        if old.stem not in keep_venues:
            old.unlink()
    print("wrote", len(EVENTS), "event pages")


if __name__ == "__main__":
    main()
