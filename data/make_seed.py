# -*- coding: utf-8 -*-
"""Write data/seed.json: the starting content for an East African data-events site.

Every organizer, venue, person, and event here is FICTIONAL demo content.
Cities, countries, currencies, and time zones are real. Exchange rates are
rough examples; set your own in the desk under Site settings → Region.

    python data/make_seed.py            # writes data/seed.json
    python data/make_seed.py --apply    # also replaces data/content.json
"""
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def pw(username, password):
    return hashlib.sha256(("mdv:%s:%s" % (username.lower(), password)).encode("utf-8")).hexdigest()


CITIES = [
    {"name": "Nairobi", "country": "Kenya", "country_code": "KE", "timezone": "Africa/Nairobi", "utc_offset": "+03:00", "tz_label": "EAT", "currency": "KES"},
    {"name": "Kampala", "country": "Uganda", "country_code": "UG", "timezone": "Africa/Kampala", "utc_offset": "+03:00", "tz_label": "EAT", "currency": "UGX"},
    {"name": "Dar es Salaam", "country": "Tanzania", "country_code": "TZ", "timezone": "Africa/Dar_es_Salaam", "utc_offset": "+03:00", "tz_label": "EAT", "currency": "TZS"},
    {"name": "Kigali", "country": "Rwanda", "country_code": "RW", "timezone": "Africa/Kigali", "utc_offset": "+02:00", "tz_label": "CAT", "currency": "RWF"},
    {"name": "Addis Ababa", "country": "Ethiopia", "country_code": "ET", "timezone": "Africa/Addis_Ababa", "utc_offset": "+03:00", "tz_label": "EAT", "currency": "ETB"},
]

CURRENCIES = [
    {"code": "KES", "name": "Kenyan shilling", "per_usd": 129},
    {"code": "UGX", "name": "Ugandan shilling", "per_usd": 3650},
    {"code": "TZS", "name": "Tanzanian shilling", "per_usd": 2500},
    {"code": "RWF", "name": "Rwandan franc", "per_usd": 1450},
    {"code": "ETB", "name": "Ethiopian birr", "per_usd": 150},
    {"code": "USD", "name": "US dollar", "per_usd": 1},
]

SITE = {
    "name": "MDV",
    "short_name": "MDV",
    "base_url": "https://mdv.example",
    "tagline": "Data, AI, and analytics events across East Africa",
    "description": "Conferences, workshops, meetups, and hackathons on data, AI, and analytics in Nairobi, Kampala, Dar es Salaam, Kigali, and Addis Ababa. Dates, venues, prices, and how to book.",
    "footer_title": "MDV · East Africa",
    "footer_blurb": "MDV lists conferences, workshops, meetups, and hackathons on data, AI, and analytics. Some events sell tickets here; others link to the organizer’s own site.",
    "contact_email": "hello@mdv.example",
    "contact_phone": "",
    "social": {"instagram": "", "facebook": "", "x": "", "linkedin": ""},
    "photo_credit": "Photographs from Unsplash.",
    "brand": {"accent": "#1d5fa8", "warm": "#e0782f", "dark": "#121923"},
    "region": {"default_currency": "KES", "currencies": CURRENCIES, "cities": CITIES, "weekend": [6, 0]},
    "checkout": {
        "fee_percent": 3, "hold_minutes": 10, "card": True, "mobile_money": True,
        "mobile_money_label": "M-Pesa, Airtel Money, MTN MoMo",
    },
    "promos": [{"code": "DATA10", "percent": 10, "active": True}],
    "listings": {"events_per_page": 6, "desk_rows_per_page": 10, "show_past_public": True},
    "features": {"site_checkout": True, "waitlist": True, "rsvp": True, "promo_codes": True},
    "home": {"show_picks": True, "show_steps": True, "show_places": True, "show_organizer_band": True},
}

KINDS = [
    {"name": "Conference", "plural": "Conferences", "description": "Talks, panels, and tracks over one or more days."},
    {"name": "Workshop", "plural": "Workshops", "description": "Small, hands-on sessions with an instructor."},
    {"name": "Meetup", "plural": "Meetups", "description": "Evening talks and community gatherings."},
    {"name": "Hackathon", "plural": "Hackathons", "description": "Teams build with data over a day or a weekend."},
]

BADGES = [
    {"id": "beginner", "label": "Beginner friendly", "tone": "good"},
    {"id": "hands-on", "label": "Hands-on", "tone": "accent"},
    {"id": "laptop", "label": "Bring a laptop", "tone": "warn"},
    {"id": "certificate", "label": "Certificate", "tone": "info"},
    {"id": "networking", "label": "Networking", "tone": "neutral"},
    {"id": "lunch", "label": "Lunch included", "tone": "accent"},
    {"id": "online", "label": "Online", "tone": "info"},
]

ORGANIZERS = [
    {"id": "savanna-data-guild", "name": "Savanna Data Guild", "type": "Community", "city": "Nairobi", "website": "https://savanna-data.example", "email": "team@savanna-data.example", "phone": "", "about": "A volunteer community of data engineers and analysts in Nairobi. Runs the summit and monthly meetups."},
    {"id": "lakeside-analytics", "name": "Lakeside Analytics Collective", "type": "Community", "city": "Kampala", "website": "https://lakeside-analytics.example", "email": "hello@lakeside-analytics.example", "phone": "", "about": "Kampala’s data and machine-learning meetup, focused on agriculture and climate data."},
    {"id": "coastline-open-data", "name": "Coastline Open Data Group", "type": "Nonprofit", "city": "Dar es Salaam", "website": "https://coastline-data.example", "email": "info@coastline-data.example", "phone": "", "about": "Opens and documents public datasets for the Tanzanian coast, and runs hackathons on them."},
    {"id": "thousand-hills-lab", "name": "Thousand Hills Data Lab", "type": "Research lab", "city": "Kigali", "website": "https://thousand-hills-lab.example", "email": "contact@thousand-hills-lab.example", "phone": "", "about": "Applied research on responsible AI and data policy."},
    {"id": "highlands-data-forum", "name": "Highlands Data Forum", "type": "Training", "city": "Addis Ababa", "website": "https://highlands-data.example", "email": "learn@highlands-data.example", "phone": "", "about": "Short courses in SQL, statistics, and data visualisation in Addis Ababa."},
    {"id": "kilima-data-school", "name": "Kilima Data School", "type": "Training", "city": "Nairobi", "website": "https://kilima-data.example", "email": "courses@kilima-data.example", "phone": "", "about": "Practical data engineering and visualisation courses, in person and online."},
]

VENUES = [
    {"name": "Riverside Innovation Hall", "city": "Nairobi", "address": "Riverside Drive, Westlands, Nairobi", "directions": "Main entrance faces Riverside Drive. Registration is in the ground-floor foyer.",
     "about": "A conference hall with three breakout rooms in Westlands.", "transport": "Matatus and taxis stop on Riverside Drive. Limited parking behind the hall; arrive early.",
     "access": [["Entrance", "Step-free main entrance."], ["Inside", "Lift to the breakout rooms on the first floor."], ["Toilets", "Accessible toilets on both floors."], ["Quiet room", "A quiet room next to registration."]]},
    {"name": "Kilimani Learning Lab", "city": "Nairobi", "address": "Kilimani, Nairobi", "directions": "Second floor. Take the lift from the lobby and follow the signs.",
     "about": "A training room with 30 desks, screens, and reliable Wi-Fi.", "transport": "Ride-hailing drop-off at the front gate.",
     "access": [["Entrance", "Ramp at the front gate, then a lift."], ["Seating", "Desks with chairs; tell the organizer if you need a different set-up."], ["Power", "A power socket at every desk."]]},
    {"name": "Ngong Road Community Hall", "city": "Nairobi", "address": "Ngong Road, Nairobi", "directions": "The hall is at the back of the compound, past the car park.",
     "about": "A bright community hall used for breakfasts and small talks.", "transport": "On the Ngong Road matatu routes.",
     "access": [["Entrance", "Ground level, step-free."], ["Toilets", "One accessible toilet."]]},
    {"name": "Lakeview Conference Centre", "city": "Kampala", "address": "Kololo, Kampala", "directions": "Use the east gate. The meetup room is signposted from reception.",
     "about": "A conference centre in Kololo with a 150-seat room.", "transport": "Boda-bodas and taxis drop off at the east gate. Evening traffic is heavy; allow extra time.",
     "access": [["Entrance", "Step-free from the east gate."], ["Seating", "Theatre seating with spaces for wheelchairs at the front."], ["Toilets", "Accessible toilets by reception."]]},
    {"name": "Harbourfront Tech Hub", "city": "Dar es Salaam", "address": "Kivukoni, Dar es Salaam", "directions": "Enter from the harbour side. Hackathon check-in is on the ground floor.",
     "about": "A tech hub near the harbour with open-plan desks and meeting rooms.", "transport": "Bajajis and taxis drop off on the harbour road.",
     "access": [["Entrance", "Step-free on the harbour side."], ["Overnight", "Rest area with sofas for the hackathon night."], ["Toilets", "Accessible toilet on the ground floor."]]},
    {"name": "Hills Convention Pavilion", "city": "Kigali", "address": "Kimihurura, Kigali", "directions": "Registration desk in the main lobby.",
     "about": "A convention pavilion with a plenary hall and two roundtable rooms.", "transport": "Taxi-motos and cars drop off at the lobby.",
     "access": [["Entrance", "Step-free main lobby."], ["Inside", "Lift to the roundtable rooms."], ["Hearing", "Hearing loop in the plenary hall."]]},
    {"name": "Bole Data Studio", "city": "Addis Ababa", "address": "Bole, Addis Ababa", "directions": "Third floor. The studio door has the forum’s logo.",
     "about": "A small training studio with 20 seats.", "transport": "Ride-hailing drop-off on the main road.",
     "access": [["Entrance", "Lift to the third floor."], ["Seating", "Desks for 20 people."]]},
    {"name": "Online", "city": "Nairobi", "address": "Online", "directions": "The joining link is sent with your ticket.",
     "about": "Events held online.", "transport": "", "access": [["Captions", "Live captions in the video call."]]},
]


def ev(**kw):
    base = {
        "lifecycle": "published", "listed": True, "featured": False, "badges": [], "arrival": "", "place_heading": "Place and directions",
        "seats": "", "state": "On sale", "price": None, "provider": None, "ticket": None, "mode": "external", "pool": 0, "max_per_order": 6,
        "types": [], "questions": [], "waitlist": False, "invite_code": "", "offers_heading": "What’s on", "offers": [], "schedule": [],
        "people_heading": "", "people": [], "audience": "", "language": "English", "included": [], "notes": [], "facts": [], "faq": [],
        "format": "In person", "online_url": "", "level": "All levels", "organizer": "", "currency": "",
    }
    base.update(kw)
    return base


EVENTS = [
    ev(slug="ea-data-summit-2026", title="East Africa Data Summit 2026", kind="Conference", featured=True,
       summary="Two days in Nairobi for data engineers, analysts, and the people who fund and use their work. Tracks on data engineering, AI in practice, and public data, with time to meet people from across the region.",
       offer_line="3 tracks, 30 talks, two evening receptions", start="2026-12-08T09:00:00+03:00", end="2026-12-09T17:30:00+03:00",
       venue="Riverside Innovation Hall", city="Nairobi", address="Riverside Drive, Westlands, Nairobi",
       directions="Main entrance faces Riverside Drive. Registration is in the ground-floor foyer.",
       arrival="Registration opens at 08:00 both days. Bring the name on your ticket.", capacity=600, seats="140 seats left", state="On sale",
       price="From KES 6,500", provider="SummitPass", ticket="https://tickets.example.com/ea-data-summit", currency="KES",
       organizer="savanna-data-guild", badges=["networking", "lunch", "certificate"],
       offers=[["Track", "Data engineering", "Pipelines, warehouses, and data quality at East African scale."], ["Track", "AI in practice", "Models that shipped, and what it took."], ["Track", "Public data", "Open data, statistics offices, and policy."], ["Inclusion", "Lunch and receptions", "Lunch both days and two evening receptions."]],
       schedule=[["Tue 8 Dec · 09:00", "Opening keynote", "The state of data work in East Africa."], ["Tue 8 Dec · 11:00", "Tracks begin", "Three rooms, talks every 40 minutes."], ["Tue 8 Dec · 18:00", "Reception", "In the foyer."], ["Wed 9 Dec · 09:30", "Panels", "Funding data teams; hiring and training."], ["Wed 9 Dec · 16:30", "Closing", "What to build next year."]],
       people_heading="Speakers", people=[["Head of data, a Nairobi fintech", "Opens the data engineering track."], ["Statistician, a national statistics office", "On publishing open data."], ["ML lead, an agritech start-up", "On models in the field."]],
       audience="For data engineers, analysts, data scientists, product people, and the managers and funders who work with them.",
       included=["Both days of talks.", "Lunch both days.", "Two evening receptions.", "A certificate of attendance."],
       facts=[["Length", "Two days, 09:00–17:30"], ["Format", "Three parallel tracks"], ["Language", "English"], ["Wi-Fi", "Throughout the hall"]],
       notes=["Tracks run in parallel; seating is open.", "Talks are recorded and shared with ticket holders."],
       faq=[["Where are tickets sold?", "On SummitPass. This site lists the event and links to it."], ["Is there a student price?", "Yes, on SummitPass with a valid student ID."]]),
    ev(slug="pipelines-with-python", title="Data Engineering Bootcamp: Pipelines with Python", kind="Workshop", level="Intermediate",
       summary="A full-day, hands-on workshop on building reliable data pipelines with Python: ingesting from APIs and spreadsheets, cleaning, testing, and scheduling. You leave with a working pipeline and the code.",
       offer_line="One day, 30 seats, bring a laptop", start="2026-12-12T09:00:00+03:00", end="2026-12-12T16:00:00+03:00",
       venue="Kilimani Learning Lab", city="Nairobi", address="Kilimani, Nairobi", directions="Second floor. Take the lift from the lobby and follow the signs.",
       arrival="Doors at 08:30. Set up your laptop before 09:00; the instructor checks installs from 08:30.", capacity=30, seats="18 seats left", state="Limited",
       price="From KES 2,000", mode="site", pool=18, max_per_order=4, currency="KES", organizer="kilima-data-school", badges=["hands-on", "laptop", "certificate"],
       types=[{"id": "standard", "label": "Standard", "price": 4500, "note": "Workshop, lunch, and certificate", "seat": True}, {"id": "student", "label": "Student", "price": 2000, "note": "With a valid student ID", "seat": True, "limit": 6}, {"id": "laptop-hire", "label": "Laptop hire", "price": 1000, "note": "Add-on. Set up for the day", "seat": False, "limit": 5}],
       questions=[{"id": "level", "label": "Your Python level (none, some, comfortable)"}],
       offers=[["Session", "Ingest", "APIs, CSVs, and spreadsheets into one place."], ["Session", "Clean and test", "Validation and tests that catch bad data."], ["Session", "Schedule", "Run it every night and get alerted when it fails."]],
       schedule=[["09:00", "Set-up and warm-up", "Check installs, meet the group."], ["10:00", "Ingest", "Pull from two sources."], ["12:30", "Lunch", ""], ["13:30", "Clean and test", ""], ["15:00", "Schedule", ""], ["15:45", "Wrap-up", "Questions and next steps."]],
       people_heading="Instructor", people=[["Lead instructor, Kilima Data School", "Builds pipelines for a logistics company."]],
       audience="For analysts and developers who know some Python and want to automate their data work.",
       included=["Instruction for the full day.", "Lunch and tea.", "The finished code.", "A certificate."],
       notes=["Install Python 3.11 or newer before you come; a setup guide is emailed after booking.", "Laptop hire is limited to five."],
       faq=[["Do I need to know Python?", "Some. You should be able to write a loop and a function."]]),
    ev(slug="kampala-ml-meetup-rainfall", title="Kampala Data & ML Meetup: Forecasting rainfall", kind="Meetup", level="All levels",
       summary="An evening meetup on forecasting rainfall with open weather data, with two short talks, a live notebook, and time to meet Kampala’s data community. Free, but register so the room is set up.",
       offer_line="Two talks, a live notebook, networking", start="2026-12-03T18:00:00+03:00", end="2026-12-03T20:30:00+03:00",
       venue="Lakeview Conference Centre", city="Kampala", address="Kololo, Kampala", directions="Use the east gate. The meetup room is signposted from reception.",
       capacity=120, seats="Free · register", state="Registration open", mode="rsvp", currency="UGX", organizer="lakeside-analytics", badges=["beginner", "networking"],
       offers=[["Talk", "Rainfall from open data", "Where the data comes from and how good it is."], ["Talk", "A first forecasting model", "Live in a notebook."]],
       schedule=[["18:00", "Doors", "Tea and introductions."], ["18:30", "Talks", ""], ["19:30", "Networking", ""]],
       audience="For anyone curious about data and climate. No experience needed.",
       faq=[["Is it free?", "Yes. Register so the organizers know how many chairs to set out."]]),
    ev(slug="dar-open-data-hackathon", title="Dar es Salaam Open Data Hackathon", kind="Hackathon", level="All levels",
       summary="A weekend hackathon on the coast’s open data: fisheries, ferries, and flooding. Teams of three to five build something useful in 30 hours, with mentors on hand and a judging panel on Sunday afternoon.",
       offer_line="30 hours, mentors, prizes for three teams", start="2027-01-16T09:00:00+03:00", end="2027-01-17T18:00:00+03:00",
       venue="Harbourfront Tech Hub", city="Dar es Salaam", address="Kivukoni, Dar es Salaam", directions="Enter from the harbour side. Check-in is on the ground floor.",
       capacity=80, seats="Free · register", state="Registration open", mode="rsvp", currency="TZS", organizer="coastline-open-data", badges=["hands-on", "laptop", "networking"],
       offers=[["Challenge", "Fisheries", "Catch data from landing sites."], ["Challenge", "Ferries", "Crossing times and crowding."], ["Challenge", "Flooding", "Rainfall, drains, and reported floods."]],
       schedule=[["Sat 16 Jan · 09:00", "Kick-off", "Challenges and team forming."], ["Sat 16 Jan · 13:00", "Build", "Mentors on the floor."], ["Sun 17 Jan · 14:00", "Demos", "Five minutes per team."], ["Sun 17 Jan · 17:00", "Prizes", ""]],
       audience="Developers, designers, analysts, and domain experts. Come alone or as a team.",
       included=["Meals both days.", "A rest area overnight.", "Mentors and datasets."],
       faq=[["Do I need a team?", "No. Teams form on Saturday morning."]]),
    ev(slug="responsible-ai-policy-forum", title="Responsible AI Policy Forum", kind="Conference", level="All levels",
       summary="One day in Kigali on making AI accountable: what regulators across the region are asking for, how teams document models, and how communities are consulted. Morning plenary, afternoon roundtables.",
       offer_line="Plenary, two roundtables, lunch", start="2027-02-04T09:00:00+02:00", end="2027-02-04T16:30:00+02:00",
       venue="Hills Convention Pavilion", city="Kigali", address="Kimihurura, Kigali", directions="Registration desk in the main lobby.",
       capacity=160, seats="Sold out", state="Sold out", price="From RWF 25,000", provider="ForumDesk", ticket="https://tickets.example.com/rai-forum",
       waitlist=True, currency="RWF", organizer="thousand-hills-lab", badges=["networking", "lunch"],
       offers=[["Plenary", "Where regulation is going", ""], ["Roundtable", "Documenting models", "Assigned seats."], ["Roundtable", "Consulting communities", "Assigned seats."]],
       schedule=[["09:00", "Plenary", ""], ["12:30", "Lunch", ""], ["14:00", "Roundtables", ""], ["16:00", "Summary", ""]],
       audience="Policy makers, researchers, and the teams who build and deploy AI.",
       faq=[["Is there a waitlist?", "Yes. Join it in the Tickets box and you get an email if a seat comes back."]]),
    ev(slug="sql-for-analysts-addis", title="SQL for Analysts", kind="Workshop", level="Beginner",
       summary="A beginner-friendly day of SQL in Addis Ababa: selecting, filtering, joining, and summarising real sales data. Small group, lots of exercises, and a cheat sheet to take home.",
       offer_line="One day, 20 seats, exercises with real data", start="2027-01-23T09:30:00+03:00", end="2027-01-23T15:30:00+03:00",
       venue="Bole Data Studio", city="Addis Ababa", address="Bole, Addis Ababa", directions="Third floor. The studio door has the forum’s logo.",
       capacity=20, seats="20 seats left", state="On sale", price="From ETB 2,500", mode="site", pool=20, max_per_order=4, currency="ETB",
       organizer="highlands-data-forum", badges=["beginner", "hands-on", "laptop"],
       types=[{"id": "early", "label": "Early bird", "price": 1800, "note": "Ended", "seat": True, "limit": 0}, {"id": "standard", "label": "Standard", "price": 2500, "note": "Workshop and lunch", "seat": True}],
       offers=[["Session", "Select and filter", ""], ["Session", "Joins", ""], ["Session", "Summaries", ""]],
       schedule=[["09:30", "Start", ""], ["12:30", "Lunch", ""], ["15:30", "Finish", ""]],
       audience="For analysts who use spreadsheets and want to query databases.", language="English and Amharic"),
    ev(slug="intro-data-visualisation-online", title="Introduction to Data Visualisation", kind="Workshop", level="Beginner", format="Online",
       online_url="https://meet.example.com/mdv-dataviz",
       summary="Two evening hours online on choosing the right chart, cleaning up defaults, and telling one clear story with data. Works with any tool; examples in a spreadsheet and in Python.",
       offer_line="Online, two hours, slides and examples", start="2027-02-18T18:00:00+03:00", end="2027-02-18T20:00:00+03:00",
       venue="Online", city="Nairobi", address="Online", directions="The joining link is sent with your ticket.",
       capacity=100, seats="100 seats left", state="On sale", price="From KES 1,500", mode="site", pool=100, max_per_order=2, currency="KES",
       organizer="kilima-data-school", badges=["online", "beginner"],
       types=[{"id": "standard", "label": "Standard", "price": 1500, "note": "Live session and recording", "seat": True}],
       audience="Anyone who makes charts for reports or dashboards."),
    ev(slug="women-in-data-breakfast", title="Women in Data Breakfast", kind="Meetup", lifecycle="pending",
       summary="A breakfast for women working in data across Nairobi: one short talk, then tables by topic. Places are by invitation from partner organisations.",
       offer_line="Breakfast, one talk, tables by topic", start="2027-03-07T08:00:00+03:00", end="2027-03-07T10:00:00+03:00",
       venue="Ngong Road Community Hall", city="Nairobi", address="Ngong Road, Nairobi", directions="The hall is at the back of the compound, past the car park.",
       capacity=60, seats="Invite only", state="Invite only", mode="rsvp", invite_code="WID27", currency="KES", organizer="savanna-data-guild", badges=["networking"],
       audience="Women working in data, by invitation."),
    # ---- past events
    ev(slug="kigali-data-science-day-2026", title="Kigali Data Science Day 2026", kind="Conference", lifecycle="archived",
       summary="A one-day conference on data science in Rwanda, with talks from the health, finance, and transport sectors.",
       offer_line="One day, 12 talks", start="2026-06-12T09:00:00+02:00", end="2026-06-12T17:00:00+02:00",
       venue="Hills Convention Pavilion", city="Kigali", address="Kimihurura, Kigali", directions="Registration desk in the main lobby.",
       capacity=250, seats="Sales closed", state="Sales closed", mode="closed", currency="RWF", organizer="thousand-hills-lab", badges=["networking"],
       audience="Data scientists and analysts."),
    ev(slug="nairobi-python-data-night", title="Nairobi Python & Data Night", kind="Meetup",
       summary="An evening of lightning talks on Python for data, followed by pizza and conversation.",
       offer_line="Six lightning talks, pizza", start="2026-10-15T18:00:00+03:00", end="2026-10-15T21:00:00+03:00",
       venue="Riverside Innovation Hall", city="Nairobi", address="Riverside Drive, Westlands, Nairobi", directions="Main entrance faces Riverside Drive.",
       capacity=90, seats="Sales closed", state="Sales closed", mode="closed", currency="KES", organizer="savanna-data-guild", badges=["beginner"],
       audience="Python users of every level."),
    ev(slug="kampala-gis-mapping-workshop", title="Kampala GIS & Mapping Workshop", kind="Workshop", lifecycle="archived", level="Intermediate",
       summary="A hands-on workshop on mapping with open geospatial data and QGIS.",
       offer_line="One day, QGIS, open map data", start="2026-09-05T09:00:00+03:00", end="2026-09-05T16:00:00+03:00",
       venue="Lakeview Conference Centre", city="Kampala", address="Kololo, Kampala", directions="Use the east gate.",
       capacity=25, seats="Sales closed", state="Sales closed", mode="closed", currency="UGX", organizer="lakeside-analytics", badges=["hands-on", "laptop"],
       audience="Analysts working with location data."),
]

PAGES = {
    "home": {
        "steps": [
            {"title": "Find an event", "body": "Search by city, date, price, and level. Every page says what is covered, where it is, and how to book."},
            {"title": "Book the way it sells", "body": "Pay here by card or mobile money, go to the organizer’s site, or register for free events."},
            {"title": "Show the QR at the door", "body": "Tickets bought here are in [My tickets](tickets.html) and your email. Each code works once."},
        ],
        "organizer": {
            "kicker": "For organizers",
            "heading": "List your data event, or sell tickets here",
            "body": "Reach data people across East Africa. Link to your own ticket site, or sell here with card and mobile money, promo codes, a waitlist, and door check-in.",
            "button": "How it works",
        },
    },
    "about": {
        "lede": "MDV lists data, AI, and analytics events in Nairobi, Kampala, Dar es Salaam, Kigali, Addis Ababa, and online, so you can find the right one and book it in a few minutes.",
        "sections": [
            {"heading": "What we list", "body": "Conferences, workshops, meetups, and hackathons about data engineering, data science, AI, statistics, and open data. Each listing shows the programme, the level, the venue, accessibility, and how to book."},
            {"heading": "How tickets work", "body": "Some events sell tickets here, by card or mobile money. Others link to the organizer’s own site. Free meetups and hackathons ask you to register so the organizers can plan."},
            {"heading": "For organizers", "body": "Send us your event, or ask for an account to manage it yourself. See [how it works](help.html#organizers)."},
            {"heading": "Contact", "body": "Write to [hello@mdv.example](mailto:hello@mdv.example)."},
        ],
    },
    "help": {
        "lede": "How booking works, paying with card or mobile money, refunds, and listing an event.",
        "sections": [
            {"id": "buying", "heading": "Booking", "body": "Each event page has a Tickets box that shows how that event sells:\n\n- **Book here.** Choose tickets, add names, and pay by card or mobile money. Seats are held while you pay. Your QR tickets are in [My tickets](tickets.html) and your email.\n- **Organizer’s site.** The button opens the organizer’s ticket site. They handle payment and refunds.\n- **Register.** Free events ask for your name and email. Invitation-only events also need the code on your invitation."},
            {"id": "payments", "heading": "Paying with mobile money", "body": "Choose mobile money at checkout and enter your phone number. Approve the payment on your phone (M-Pesa, Airtel Money, or MTN MoMo, depending on the country). Prices are in the event’s local currency; an approximate US dollar amount is shown for visitors."},
            {"id": "refunds", "heading": "Refunds and changes", "body": "- Full refund up to 7 days before the event, minus the booking fee.\n- Inside 7 days, tickets can be transferred to another name but not refunded.\n- If an event is cancelled or moved, everyone is refunded in full.\n- Request a refund or a name change from [My tickets](tickets.html). Mobile money refunds arrive within 3 working days; card refunds take 5–10."},
            {"id": "at-the-door", "heading": "At the door", "body": "Show the QR code on your phone or on paper. Each code works once. For online events, the joining link is in your ticket email."},
            {"id": "organizers", "heading": "For organizers", "body": "We can list your event and link to your ticket site, or sell tickets for you with ticket types, promo codes, a waitlist, guest lists, and door check-in. Payouts are made after the event, less the booking fee.\n\nWrite to [hello@mdv.example](mailto:hello@mdv.example) with the dates, venue, and how you want to sell. New listings are reviewed before they go live."},
            {"id": "terms", "heading": "Terms", "body": "A ticket is a licence to attend one event, for the named holder. The organizer runs the event and is responsible for its content and safety. Tickets may not be resold above face value."},
            {"id": "privacy", "heading": "Privacy", "body": "We keep the name, email, and phone you give at checkout to send tickets and updates, and share the guest list with that event’s organizer. Card and mobile money details are handled by the payment provider. We follow the data protection laws of the countries we operate in. Write to [hello@mdv.example](mailto:hello@mdv.example) to see or delete your data."},
        ],
        "faq": [
            {"q": "Which payment methods work?", "a": "Visa and Mastercard, and mobile money: M-Pesa, Airtel Money, and MTN MoMo where available."},
            {"q": "Which currency will I pay in?", "a": "The event’s local currency, for example KES in Nairobi or UGX in Kampala. The US dollar figure is approximate."},
            {"q": "Is there a booking fee?", "a": "A small percentage per order on tickets sold here, shown before you pay."},
        ],
    },
}

USERS = [
    # username, password, name, role, title, organization, email, phone, country, notes
    ("superadmin", "superadmin", "Amina Wanjiru", "super_admin", "Platform owner", "MDV", "amina@mdv.example", "+254 700 000 001", "Kenya", "Owns the platform. Manages admins and system settings."),
    ("admin", "admin", "Daniel Okello", "admin", "Operations lead", "MDV", "daniel@mdv.example", "+256 700 000 002", "Uganda", "Runs day-to-day operations and approves listings."),
    ("editor", "editor", "Grace Mushi", "editor", "Content editor", "MDV", "grace@mdv.example", "+255 700 000 003", "Tanzania", "Writes and edits event pages."),
    ("boxoffice", "boxoffice", "Eric Habimana", "box_office", "Box office and support", "MDV", "eric@mdv.example", "+250 700 000 004", "Rwanda", "Handles orders, refunds, and customer questions."),
    ("door", "door", "Selam Tesfaye", "door", "Door staff", "Highlands Data Forum", "selam@mdv.example", "+251 900 000 005", "Ethiopia", "Checks guests in at Addis Ababa events."),
]


def build():
    return {
        "version": 2,
        "updated": "2026-11-22T12:00:00+03:00",
        "site": SITE,
        "kinds": KINDS,
        "badges": BADGES,
        "organizers": ORGANIZERS,
        "venues": VENUES,
        "pages": PAGES,
        "users": [
            {"id": u, "username": u, "password": pw(u, p), "name": n, "role": r, "title": t, "organization": o, "email": e,
             "phone": ph, "country": c, "notes": nt, "active": True, "created": "2026-11-01"}
            for u, p, n, r, t, o, e, ph, c, nt in USERS
        ],
        "events": EVENTS,
    }


if __name__ == "__main__":
    data = build()
    text = json.dumps(data, ensure_ascii=False, indent=2)
    (HERE / "seed.json").write_text(text, encoding="utf-8")
    print("wrote data/seed.json:", len(data["events"]), "events")
    if "--apply" in sys.argv:
        (HERE / "content.json").write_text(text, encoding="utf-8")
        print("replaced data/content.json")
