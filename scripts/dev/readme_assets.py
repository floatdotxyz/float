#!/usr/bin/env python3
"""
Generates the animated SVG assets used by README.md into .github/assets/.

    python3 scripts/dev/readme_assets.py

All artwork is original to this repository. Animations are pure SVG/CSS
(SMIL + keyframes), so they play when GitHub renders the files as <img>.
"""
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / ".github" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

SANS = "Inter, ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace"

BG0, BG1 = "#060A14", "#0D1530"
TEXT, MUTED = "#E6EDF7", "#8A97B1"
TEAL, SKY, INDIGO = "#5EEAD4", "#38BDF8", "#818CF8"

BUCKETS = [
    ("Holders", 15, "#5EEAD4", "paired token · pro rata"),
    ("Creator", 5, "#FBBF24", "paired token"),
    ("Flagship", 35, "#F472B6", "SOL → $FLOAT, burned"),
    ("Traders", 35, "#38BDF8", "USDC airdrop"),
    ("Treasury", 10, "#A78BFA", "paired token"),
]


def mark(x: float, y: float, s: float, bob: bool = True) -> str:
    """Original mark: a buoy riding three waves, inside a rounded tile. Drawn on a 128 grid."""
    k = s / 128
    anim = (
        '<animateTransform attributeName="transform" type="translate" values="0 0; 0 -5; 0 0" dur="3.2s" repeatCount="indefinite" '
        'calcMode="spline" keySplines=".45 0 .55 1; .45 0 .55 1"/>'
        if bob
        else ""
    )
    return f"""
  <g transform="translate({x} {y}) scale({k})">
    <rect x="0" y="0" width="128" height="128" rx="30" fill="url(#tile)"/>
    <rect x="1" y="1" width="126" height="126" rx="29" fill="none" stroke="url(#edge)" stroke-opacity=".55" stroke-width="2"/>
    <g>
      {anim}
      <circle cx="64" cy="50" r="19" fill="url(#brand)"/>
      <path d="M45 50a19 19 0 0 0 38 0" fill="#060A14" fill-opacity=".28"/>
      <circle cx="58" cy="43" r="5" fill="#fff" fill-opacity=".55"/>
    </g>
    <g fill="none" stroke-linecap="round" stroke-width="7">
      <path d="M22 82 q10.5-9 21 0 t21 0 t21 0 t21 0" stroke="{TEAL}"/>
      <path d="M22 97 q10.5-9 21 0 t21 0 t21 0 t21 0" stroke="{SKY}" stroke-opacity=".75"/>
      <path d="M22 112 q10.5-9 21 0 t21 0 t21 0 t21 0" stroke="{INDIGO}" stroke-opacity=".5"/>
    </g>
  </g>"""


DEFS = f"""
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{TEAL}"/><stop offset=".5" stop-color="{SKY}"/><stop offset="1" stop-color="{INDIGO}"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#111B3A"/><stop offset="1" stop-color="#070C1C"/>
    </linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{TEAL}"/><stop offset="1" stop-color="{INDIGO}"/>
    </linearGradient>
  </defs>"""


def write(name: str, svg: str) -> None:
    (OUT / name).write_text(svg.strip() + "\n", encoding="utf-8")
    print(f"wrote .github/assets/{name}")


# ---------------------------------------------------------------- logo

write(
    "logo.svg",
    f"""<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="float-community logo">
  <title>float-community</title>{DEFS}{mark(0, 0, 128)}
</svg>""",
)

# -------------------------------------------------------------- banner

W, H = 1280, 440
cx, cy = 905, 228  # fee source node
targets = [(1170, 92 + i * 68) for i in range(5)]

paths, nodes, dots = [], [], []
for i, ((name, pct, color, _), (tx, ty)) in enumerate(zip(BUCKETS, targets)):
    d = f"M{cx + 46} {cy} C {cx + 140} {cy}, {tx - 150} {ty}, {tx - 74} {ty}"
    paths.append(f'<path id="p{i}" d="{d}" stroke="{color}" stroke-opacity=".38" stroke-width="2" fill="none"/>')
    nodes.append(
        f"""<g transform="translate({tx - 72} {ty - 22})">
      <rect width="150" height="44" rx="12" fill="#0B1430" stroke="{color}" stroke-opacity=".55"/>
      <circle cx="20" cy="22" r="6" fill="{color}"/>
      <text x="34" y="27" font-family="{SANS}" font-size="15" font-weight="600" fill="{TEXT}">{name}</text>
      <text x="136" y="27" text-anchor="end" font-family="{MONO}" font-size="14" fill="{color}">{pct}%</text>
    </g>"""
    )
    for j in range(3):
        begin = f"{(i * 0.37 + j * 1.1):.2f}s"
        dots.append(
            f"""<circle r="3.6" fill="{color}">
      <animateMotion dur="3.3s" repeatCount="indefinite" begin="{begin}" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".4 0 .6 1"><mpath href="#p{i}"/></animateMotion>
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.85;1" dur="3.3s" begin="{begin}" repeatCount="indefinite"/>
    </circle>"""
        )

chips = ["Docs", "TypeScript SDK", "CLI", "Anchor program", "Rust core", "Bots"]
chip_svg, x = [], 92
for c in chips:
    w = 18 + len(c) * 8.6
    chip_svg.append(
        f'<g transform="translate({x} 318)"><rect width="{w:.0f}" height="30" rx="15" fill="#0E1838" stroke="#22305A"/>'
        f'<text x="{w / 2:.0f}" y="20" text-anchor="middle" font-family="{SANS}" font-size="13.5" fill="#B9C6DE">{c}</text></g>'
    )
    x += w + 10

write(
    "banner.svg",
    f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="float-community: docs, SDK, CLI and on-chain programs for Float on Solana">
  <title>float-community</title>{DEFS}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BG0}"/><stop offset="1" stop-color="{BG1}"/></linearGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#fff" stroke-opacity=".035"/></pattern>
    <radialGradient id="glowA"><stop offset="0" stop-color="{SKY}" stop-opacity=".45"/><stop offset="1" stop-color="{SKY}" stop-opacity="0"/></radialGradient>
    <radialGradient id="glowB"><stop offset="0" stop-color="{INDIGO}" stop-opacity=".40"/><stop offset="1" stop-color="{INDIGO}" stop-opacity="0"/></radialGradient>
    <radialGradient id="core"><stop offset="0" stop-color="{TEAL}" stop-opacity=".9"/><stop offset="1" stop-color="{SKY}" stop-opacity=".15"/></radialGradient>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#BFD3F5"/></linearGradient>
    <clipPath id="frame"><rect width="{W}" height="{H}" rx="22"/></clipPath>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="{W}" height="{H}" fill="url(#bg)"/>
    <rect width="{W}" height="{H}" fill="url(#grid)"/>
    <circle cx="1020" cy="120" r="260" fill="url(#glowA)"><animate attributeName="cx" values="1020;960;1020" dur="14s" repeatCount="indefinite"/></circle>
    <circle cx="260" cy="420" r="300" fill="url(#glowB)"><animate attributeName="cy" values="420;380;420" dur="11s" repeatCount="indefinite"/></circle>

    <g fill="none" stroke-width="2">
      <path d="M-40 392 q80-26 160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0" stroke="{TEAL}" stroke-opacity=".18">
        <animateTransform attributeName="transform" type="translate" values="0 0;-160 0" dur="9s" repeatCount="indefinite"/></path>
      <path d="M-40 408 q80-22 160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0 t160 0" stroke="{INDIGO}" stroke-opacity=".16">
        <animateTransform attributeName="transform" type="translate" values="-160 0;0 0" dur="12s" repeatCount="indefinite"/></path>
    </g>

    {mark(92, 84, 96)}
    <text x="210" y="136" font-family="{SANS}" font-size="58" font-weight="800" letter-spacing="-1.5" fill="url(#title)">float-community</text>
    <text x="212" y="172" font-family="{SANS}" font-size="20" fill="{MUTED}">Docs, SDK, CLI and on-chain programs for Float on Solana</text>
    <text x="92" y="232" font-family="{SANS}" font-size="17" fill="#C9D5EA">Every coin's fees, split five ways: holders, creator, $FLOAT burns,</text>
    <text x="92" y="258" font-family="{SANS}" font-size="17" fill="#C9D5EA">top traders and the treasury. Routed through Raydium LaunchLab &amp; CPMM.</text>
    <text x="92" y="298" font-family="{MONO}" font-size="12.5" fill="#5F6E8C" letter-spacing="1.6">UNOFFICIAL · COMMUNITY-MAINTAINED · MIT</text>
    {''.join(chip_svg)}

    {''.join(paths)}
    {''.join(dots)}
    <g transform="translate({cx} {cy})">
      <circle r="58" fill="url(#core)" opacity=".35"><animate attributeName="r" values="52;62;52" dur="3.2s" repeatCount="indefinite"/></circle>
      <circle r="46" fill="#0B1430" stroke="url(#brand)" stroke-width="2.5"/>
      <text y="-4" text-anchor="middle" font-family="{SANS}" font-size="14" font-weight="700" fill="{TEXT}">Cycle</text>
      <text y="15" text-anchor="middle" font-family="{SANS}" font-size="14" font-weight="700" fill="{TEXT}">fees</text>
    </g>
    <text x="{cx}" y="{cy + 80}" text-anchor="middle" font-family="{MONO}" font-size="12" fill="#5F6E8C">LaunchLab · CPMM · Burn &amp; Earn</text>
    {''.join(nodes)}
  </g>
</svg>""",
)

# ------------------------------------------------------------ fee split

R, SW, C = 108, 34, 2 * 3.141592653589793 * 108
segs, legend, offset = [], [], 0.0
for i, (name, pct, color, paid) in enumerate(BUCKETS):
    length = C * pct / 100
    gap = 3
    segs.append(
        f"""<circle r="{R}" fill="none" stroke="{color}" stroke-width="{SW}" stroke-dasharray="0 {C:.2f}" stroke-dashoffset="{-offset:.2f}" transform="rotate(-90)">
      <animate attributeName="stroke-dasharray" from="0 {C:.2f}" to="{length - gap:.2f} {C:.2f}" begin="{0.15 + i * 0.22:.2f}s" dur=".7s" fill="freeze" calcMode="spline" keySplines=".2 .8 .2 1" keyTimes="0;1"/>
    </circle>"""
    )
    offset += length
    y = 62 + i * 46
    legend.append(
        f"""<g transform="translate(340 {y})" opacity="0">
      <animate attributeName="opacity" from="0" to="1" begin="{0.25 + i * 0.22:.2f}s" dur=".5s" fill="freeze"/>
      <rect x="0" y="-15" width="470" height="38" rx="10" fill="#0D1634"/>
      <circle cx="20" cy="4" r="7" fill="{color}"/>
      <text x="38" y="9" font-family="{SANS}" font-size="16" font-weight="600" fill="{TEXT}">{name}</text>
      <text x="160" y="9" font-family="{MONO}" font-size="16" font-weight="700" fill="{color}">{pct:>2}%</text>
      <text x="220" y="9" font-family="{SANS}" font-size="14" fill="{MUTED}">{paid}</text>
    </g>"""
    )

write(
    "fee-split.svg",
    f"""<svg xmlns="http://www.w3.org/2000/svg" width="860" height="300" viewBox="0 0 860 300" role="img" aria-label="Fee split: holders 15%, creator 5%, flagship 35%, traders 35%, treasury 10%">
  <title>Float fee split</title>
  <rect width="860" height="300" rx="20" fill="{BG0}"/>
  <rect x=".5" y=".5" width="859" height="299" rx="19.5" fill="none" stroke="#1C2950"/>
  <g transform="translate(165 150)">
    <circle r="{R}" fill="none" stroke="#111B3A" stroke-width="{SW}"/>
    {''.join(segs)}
    <text y="-6" text-anchor="middle" font-family="{SANS}" font-size="30" font-weight="800" fill="{TEXT}">100%</text>
    <text y="20" text-anchor="middle" font-family="{SANS}" font-size="13" fill="{MUTED}">of platform fees</text>
  </g>
  {''.join(legend)}
</svg>""",
)

# ------------------------------------------------------------- terminal

LINES = [
    ("cmd", "npm run float -- cycle e2QwTzTjY74e1E2LFNsiw8RtQsdkqhsD3xMAdmQrPXT"),
    ("dim", "Coin e2Qw…rPXT — bonding (41.20% of curve)"),
    ("", ""),
    ("head", "Pending fees attributable to this coin:"),
    ("row", "  launchlab-pool-platform-fee      2.031 SOL"),
    ("", ""),
    ("head", "A cycle now would route 2.031 SOL:"),
    ("b0", "  Holders   15%   0.30465 SOL  → holder payout bot"),
    ("b1", "  Creator    5%   0.10155 SOL  → creator wallet"),
    ("b2", "  Flagship  35%   0.71085 SOL  → $FLOAT buyback & burn"),
    ("b3", "  Traders   35%   0.71085 SOL  → USDC airdrop"),
    ("b4", "  Treasury  10%   0.2031  SOL  → treasury"),
    ("", ""),
    ("ok", "✓ guarded swaps: ≥ 0.980 per 1.000 expected"),
]
TW, TH, CYCLE = 940, 470, 16.0
styles, rows = [], []
colors = {"dim": MUTED, "head": TEXT, "row": "#C9D5EA", "ok": "#4ADE80"}
for i, (_name, _pct, color, _paid) in enumerate(BUCKETS):
    colors[f"b{i}"] = color
t = 0.0
for i, (kind, text) in enumerate(LINES):
    if kind == "cmd":
        start, typed = 0.4, 2.2
        t = start + typed + 0.5
        pct_s, pct_e = start / CYCLE * 100, (start + typed) / CYCLE * 100
        styles.append(
            f"@keyframes type{i}{{0%,{pct_s:.2f}%{{width:0}}{pct_e:.2f}%,94%{{width:820px}}97%,100%{{width:820px;opacity:0}}}}"
            f"#c{i} rect{{animation:type{i} {CYCLE}s steps(64,end) infinite}}"
        )
        rows.append(
            f'<clipPath id="c{i}"><rect x="76" y="{70 + i * 26 - 18}" height="26" width="0"/></clipPath>'
            f'<text x="52" y="{70 + i * 26}" font-family="{MONO}" font-size="15" fill="{TEAL}">❯</text>'
            f'<text x="76" y="{70 + i * 26}" font-family="{MONO}" font-size="15" fill="{TEXT}" clip-path="url(#c{i})">{text}</text>'
        )
        continue
    if not text:
        continue
    t += 0.18 if kind.startswith("b") else 0.35
    p = t / CYCLE * 100
    styles.append(
        f"@keyframes l{i}{{0%,{p:.2f}%{{opacity:0;transform:translateY(4px)}}{p + 1.6:.2f}%,94%{{opacity:1;transform:none}}97%,100%{{opacity:0}}}}"
        f"#l{i}{{opacity:0;animation:l{i} {CYCLE}s ease-out infinite}}"
    )
    weight = ' font-weight="600"' if kind in ("head", "ok") else ""
    rows.append(f'<text id="l{i}" x="52" y="{70 + i * 26}" font-family="{MONO}" font-size="15"{weight} fill="{colors[kind]}" xml:space="preserve">{text.replace("&", "&amp;")}</text>')

cursor_y = 70 + len(LINES) * 26 - 16
write(
    "terminal.svg",
    f"""<svg xmlns="http://www.w3.org/2000/svg" width="{TW}" height="{TH}" viewBox="0 0 {TW} {TH}" role="img" aria-label="Terminal demo of float cycle">
  <title>float cycle — terminal demo</title>
  <style>{''.join(styles)}@keyframes blink{{50%{{opacity:0}}}}#cur{{animation:blink 1s steps(1) infinite}}</style>
  <rect width="{TW}" height="{TH}" rx="16" fill="#0A0F1E"/>
  <rect x=".5" y=".5" width="{TW - 1}" height="{TH - 1}" rx="15.5" fill="none" stroke="#1C2950"/>
  <rect width="{TW}" height="38" rx="16" fill="#0F1630"/><rect y="22" width="{TW}" height="16" fill="#0F1630"/>
  <circle cx="24" cy="19" r="6" fill="#FF5F57"/><circle cx="44" cy="19" r="6" fill="#FEBC2E"/><circle cx="64" cy="19" r="6" fill="#28C840"/>
  <text x="{TW / 2}" y="24" text-anchor="middle" font-family="{SANS}" font-size="13" fill="{MUTED}">float-community — zsh</text>
  {''.join(rows)}
  <rect id="cur" x="52" y="{cursor_y}" width="9" height="18" fill="{TEAL}" opacity=".8"/>
</svg>""",
)
