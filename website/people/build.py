"""Kanalyst family characters: Arjun (dad), Meera (mom), Nila (daughter), Paati (grandma).
One source of truth. Writes:  <name>.svg  (stand-alone)  and  ../people.js  (inline strings for the site).
Run:  python3 build.py
"""
import json, os

INK = "#1a1612"
HAIR = "#241a14"
GREY = "#d9d2c3"
GREY_D = "#b8afa0"
SKIN = {"arjun": "#b07650", "meera": "#c58a5f", "nila": "#c99064", "paati": "#a8714d"}
SHADE = {"arjun": "#96603e", "meera": "#a9724c", "nila": "#ad7650", "paati": "#8e5d3e"}

FACE = """
  <circle cx="44" cy="{ey}" r="1.9" fill="{ink}"/><circle cx="56" cy="{ey}" r="1.9" fill="{ink}"/>
  <path d="M45.5 {my} Q50 {my2} 54.5 {my}" fill="none" stroke="{ink}" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="40" cy="{cy}" r="2.6" fill="#e0785a" opacity=".35"/><circle cx="60" cy="{cy}" r="2.6" fill="#e0785a" opacity=".35"/>
"""


def face(ey=47, my=54, cy=52):
    return FACE.format(ey=ey, my=my, my2=my + 3.5, cy=cy, ink=INK)


def head(who, cy=46, rx=15.5, ry=17.5):
    s, d = SKIN[who], SHADE[who]
    return f"""
  <circle cx="{50-rx}" cy="{cy+2}" r="3.4" fill="{d}"/><circle cx="{50+rx}" cy="{cy+2}" r="3.4" fill="{d}"/>
  <ellipse cx="50" cy="{cy}" rx="{rx}" ry="{ry}" fill="{s}"/>"""


def neck(who, y=58, h=16):
    return f'<rect x="44" y="{y}" width="12" height="{h}" rx="4" fill="{SHADE[who]}"/>'


PEOPLE = {
    # ── Arjun: dad, short hair, moustache, terracotta shirt on prussian ─────────────
    "arjun": dict(bg="#2f4577", body=f"""
  <path d="M16 100 C16 80 31 71 50 71 C69 71 84 80 84 100 Z" fill="#b8551f"/>
  <path d="M41 71 L50 84 L59 71 Z" fill="#faf5e8"/>
  <path d="M41 71 L46 79 L50 74 Z M59 71 L54 79 L50 74 Z" fill="#9a4618"/>
  {neck('arjun')}
  {head('arjun')}
  <path d="M34 44 C32 27 43 22 51 23 C62 23 70 30 66 45 C64 37 60 33 56 32 C50 35 42 35 37 36 C35 38 34.5 41 34 44 Z" fill="{HAIR}"/>
  {face()}
  <path d="M44 52.2 Q50 49.6 56 52.2 Q50 53.8 44 52.2 Z" fill="{HAIR}"/>
"""),
    # ── Meera: mom, long hair with side parting, bindi, earrings, marigold saree ───
    "meera": dict(bg="#964062", body=f"""
  <path d="M31 50 C28 28 40 21 50 21 C61 21 72 28 69 50 C70 60 72 68 74 76 C62 80 38 80 26 76 C28 68 30 60 31 50 Z" fill="{HAIR}"/>
  <path d="M16 100 C16 80 31 71 50 71 C69 71 84 80 84 100 Z" fill="#e3a018"/>
  <path d="M60 72 C68 76 73 84 70 100 L56 100 C60 88 60 80 54 72 Z" fill="#b8551f"/>
  <path d="M42 71 Q50 78 58 71" fill="none" stroke="#b8551f" stroke-width="2.4"/>
  {neck('meera')}
  {head('meera')}
  <path d="M34.5 45 C34 30 43 25 49 27 C56 24 66 29 65.5 45 C63 37 57 32 49 31 C46 36 40 40 34.5 45 Z" fill="{HAIR}"/>
  <circle cx="50" cy="38.5" r="1.6" fill="#a82c2c"/>
  {face()}
  <circle cx="34.5" cy="54" r="2" fill="#e3a018"/><circle cx="65.5" cy="54" r="2" fill="#e3a018"/>
"""),
    # ── Nila: daughter (8), bob with fringe, two puffs with ribbons, teal top ──────
    "nila": dict(bg="#e3a018", body=f"""
  <circle cx="29" cy="40" r="7.5" fill="{HAIR}"/><circle cx="71" cy="40" r="7.5" fill="{HAIR}"/>
  <path d="M25 33 l5 3 -5 3 z M33 33 l-5 3 5 3 z" fill="#964062"/>
  <path d="M67 33 l5 3 -5 3 z M75 33 l-5 3 5 3 z" fill="#964062"/>
  <path d="M22 100 C22 84 34 77 50 77 C66 77 78 84 78 100 Z" fill="#2d6b6b"/>
  <path d="M42 77 Q50 84 58 77" fill="#faf5e8"/>
  {neck('nila', y=62, h=17)}
  {head('nila', cy=49, rx=16, ry=16.5)}
  <path d="M33.5 49 C31 31 42 26 50 26 C59 26 70 31 66.5 49 C66 44 64 41 61 39 C55 41 45 41 39 39 C36 41 34 44 33.5 49 Z" fill="{HAIR}"/>
  {face(ey=50, my=56.5, cy=55)}
"""),
    # ── Paati: grandma, grey bun, round glasses, bindi, aubergine saree w/ border ──
    "paati": dict(bg="#5f7f1f", body=f"""
  <circle cx="50" cy="25" r="8" fill="{GREY_D}"/>
  <path d="M16 100 C16 80 31 71 50 71 C69 71 84 80 84 100 Z" fill="#5d3b78"/>
  <path d="M30 76 C40 82 46 92 46 100 L40 100 C40 92 35 84 26 79 Z" fill="#e3a018"/>
  <path d="M42 71 Q50 77 58 71" fill="none" stroke="#e3a018" stroke-width="2.2"/>
  {neck('paati')}
  {head('paati')}
  <path d="M34 47 C32 30 42 25 50 25 C59 25 69 30 66 47 C65 39 60 34 50 33.5 C41 34 36 39 34 47 Z" fill="{GREY}"/>
  <path d="M50 26 L50 33" stroke="{GREY_D}" stroke-width="1.2"/>
  <circle cx="50" cy="38.5" r="1.5" fill="#a82c2c"/>
  {face(ey=47.5)}
  <g fill="none" stroke="{INK}" stroke-width="1.4"><circle cx="44" cy="47.5" r="4.4"/><circle cx="56" cy="47.5" r="4.4"/><path d="M48.4 47.5 H51.6"/></g>
  <path d="M41 58 Q50 61 59 58" fill="none" stroke="{SHADE['paati']}" stroke-width="1" opacity=".6"/>
"""),
}


def svg(who, standalone=True, uid=""):
    p = PEOPLE[who]
    cid = f"kc-{who}{uid}"
    ns = ' xmlns="http://www.w3.org/2000/svg"' if standalone else ""
    return (f'<svg{ns} viewBox="0 0 100 100" role="img" aria-label="{who.title()}">'
            f'<defs><clipPath id="{cid}"><circle cx="50" cy="50" r="50"/></clipPath></defs>'
            f'<g clip-path="url(#{cid})"><rect width="100" height="100" fill="{p["bg"]}"/>'
            f'<circle cx="50" cy="44" r="30" fill="#fff" opacity=".08"/>{p["body"]}</g></svg>')


here = os.path.dirname(os.path.abspath(__file__))
for w in PEOPLE:
    with open(os.path.join(here, f"{w}.svg"), "w") as f:
        f.write(" ".join(svg(w).split()))

js = "/* Generated by people/build.py - Kanalyst family characters. */\nwindow.KPEOPLE = " + json.dumps(
    {w: " ".join(svg(w, standalone=False).split()) for w in PEOPLE}, indent=1) + ";\n"
with open(os.path.join(here, "..", "people.js"), "w") as f:
    f.write(js)
house = open(os.path.join(here, "..", "house.svg")).read().replace(' xmlns="http://www.w3.org/2000/svg"', "")
react = ("/* Generated by website/people/build.py - do not edit by hand. */\n"
         "const PEOPLE = " + json.dumps({w: " ".join(svg(w, standalone=False).split()) for w in PEOPLE}, indent=1) + ";\n"
         "const HOUSE = " + json.dumps(" ".join(house.split())) + ";\n\n"
         "export function Person({ id, className = '' }) {\n"
         "  const s = PEOPLE[String(id || '').toLowerCase()];\n"
         "  if (!s) return null;\n"
         "  return <span className={'k-person ' + className} dangerouslySetInnerHTML={{ __html: s }} />;\n"
         "}\n\n"
         "export function House({ className = '' }) {\n"
         "  return <span className={'k-house ' + className} dangerouslySetInnerHTML={{ __html: HOUSE }} />;\n"
         "}\n")
os.makedirs(os.path.join(here, "..", "..", "frontend", "src", "brand"), exist_ok=True)
with open(os.path.join(here, "..", "..", "frontend", "src", "brand", "people.js"), "w") as f:
    f.write(react)
print("ok")
