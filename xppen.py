# XPpen: Simple & Insane Digital Stylus Physics Simulation
# bro hooke's law + damping makes digital pens actually feel alive
import math, sys

class XPPen:
    def __init__(self, k=0.45, c=0.35, levels=8192):
        self.k, self.c, self.levels = k, c, levels  # stiffness, damping, 8192 levels
        self.x = self.y = self.vx = self.vy = self.p = 0.0

    def step(self, tx, ty, raw_p, dt=0.016):
        # 2nd-order spring-damper physics (bye bye robotic straight lines)
        ax = (self.k * (tx - self.x) * 60 - self.c * self.vx * 30)
        ay = (self.k * (ty - self.y) * 60 - self.c * self.vy * 30)
        self.vx += ax * dt; self.vy += ay * dt
        self.x += self.vx * dt; self.y += self.vy * dt
        # sigmoid pressure curve mapping to 8192 levels (gentle tap, juicy swells)
        sig = 1.0 / (1.0 + math.exp(-7.0 * (raw_p - 0.45)))
        self.p += 0.3 * (sig - self.p)
        return self.x, self.y, round(self.p * (self.levels - 1))

def simulate_orbit(samples=600):
    pen, pts = XPPen(), []
    for i in range(samples):
        t = i * 0.04
        # harmonic pen orbit physics (triple pendulum vibes)
        tx = 35 + 28 * math.sin(2.0 * t) * math.exp(-0.001 * t)
        ty = 12 + 10 * math.sin(3.0 * t + 1.57) * math.exp(-0.001 * t)
        raw_p = 0.3 + 0.6 * math.sin(t * 1.5)
        x, y, p_lvl = pen.step(tx, ty, max(0.0, raw_p))
        pts.append((x, y, p_lvl))
    return pts

def render_ascii(pts, w=70, h=22):
    grid = [[" " for _ in range(w)] for _ in range(h)]
    shades = " .:-=+*#%@"
    for x, y, p in pts:
        gx, gy = int(x), int(y)
        if 0 <= gx < w and 0 <= gy < h:
            grid[gy][gx] = shades[int((p / 8191) * (len(shades) - 1))]
    return "+" + "-" * w + "+\n" + "\n".join("|" + "".join(r) + "|" for r in grid) + "\n+" + "-" * w + "+"

def export_svg(pts, filename="xppen_art.svg"):
    # SVG export with pressure-modulated stroke width
    paths = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" style="background:#121316">']
    for i in range(1, len(pts)):
        p1, p2 = pts[i-1], pts[i]
        sw = max(1.0, (p2[2] / 8191) * 8.0)
        paths.append(f'<line x1="{p1[0]*11:.1f}" y1="{p1[1]*24:.1f}" x2="{p2[0]*11:.1f}" y2="{p2[1]*24:.1f}" stroke="#e50012" stroke-width="{sw:.1f}" stroke-linecap="round"/>')
    paths.append('</svg>')
    with open(filename, "w") as f: f.write("\n".join(paths))

if __name__ == "__main__":
    if sys.platform == "win32":
        try: sys.stdout.reconfigure(encoding="utf-8")
        except: pass
    print("XP·PEN Digitizer Simulation (8,192 Levels) - Python 3.12")
    pts = simulate_orbit()
    print(render_ascii(pts))
    export_svg(pts)
    print(">> Generated xppen_art.svg! Open web/index.html for live simulation.")
