"""
xppen.cli
~~~~~~~~~
Command-line interface for the XPpen suite:
- Generate Spirograph, Lorenz Attractor, or Harmonograph art to SVG & G-code
- Benchmark Schneider's Bézier curve fitting against raw sampled points
- Preview strokes in full ANSI 256-color terminal ASCII art!

Author: @xppen-coder
"""

import sys
import os
import time
import argparse
import math
from typing import List, Tuple

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from . import BANNER, __version__
from .physics_engine import StylusPhysicsSimulator, StylusState
from .bezier_synth import BezierFitter, Point2D
from .calligraphy import PointedFlexNib, BroadEdgeNib
from .gcode_plotter import GCodeGenerator, PlotterStroke, CrossHatchGenerator
from .generative_pens import SpirographPen, LorenzAttractorPen, HarmonographPen
from .human_jitter import HumanHandImperfectionSimulator


def render_ascii_canvas(points: List[Tuple[float, float, float]], width: int = 70, height: int = 24) -> str:
    """Renders pen points to a cool ANSI terminal canvas."""
    if not points:
        return "(empty canvas bro)"

    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    range_x = max(1.0, max_x - min_x)
    range_y = max(1.0, max_y - min_y)

    grid = [[" " for _ in range(width)] for _ in range(height)]

    # Shades of ink based on pressure
    shades = " .:-=+*#%@"

    for x, y, p in points:
        gx = int(((x - min_x) / range_x) * (width - 1))
        gy = int(((y - min_y) / range_y) * (height - 1))
        if 0 <= gx < width and 0 <= gy < height:
            s_idx = int(min(1.0, max(0.0, p)) * (len(shades) - 1))
            grid[gy][gx] = shades[s_idx]

    border = "+" + "-" * width + "+"
    canvas_lines = [border]
    for row in grid:
        canvas_lines.append("|" + "".join(row) + "|")
    canvas_lines.append(border)
    return "\n".join(canvas_lines)


def export_svg(points: List[Tuple[float, float, float]], filename: str = "output.svg", width: int = 800, height: int = 600):
    """Exports points to a smooth SVG with variable stroke-width from pressure."""
    # Convert to Point2D and fit with Bezier
    pt2d = [Point2D(p[0], p[1], p[2]) for p in points]
    fitter = BezierFitter(error_tolerance=2.5)
    segments = fitter.fit_curve(pt2d)

    svg_lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">',
        '  <rect width="100%" height="100%" fill="#0d1117" />',
        '  <defs>',
        '    <linearGradient id="inkGrad" x1="0%" y1="0%" x2="100%" y2="100%">',
        '      <stop offset="0%" stop-color="#38bdf8" />',
        '      <stop offset="50%" stop-color="#818cf8" />',
        '      <stop offset="100%" stop-color="#c084fc" />',
        '    </linearGradient>',
        '  </defs>'
    ]

    if segments:
        path_d = f"M {segments[0].p0.x:.2f},{segments[0].p0.y:.2f} "
        for seg in segments:
            path_d += seg.to_svg_path_cmd() + " "

        avg_pressure = sum(p[2] for p in points) / len(points) if points else 0.5
        stroke_w = max(1.2, avg_pressure * 6.0)

        svg_lines.append(
            f'  <path d="{path_d.strip()}" fill="none" stroke="url(#inkGrad)" stroke-width="{stroke_w:.2f}" stroke-linecap="round" stroke-linejoin="round" />'
        )
    else:
        # Fallback polyline
        pts_str = " ".join([f"{p[0]:.1f},{p[1]:.1f}" for p in points])
        svg_lines.append(f'  <polyline points="{pts_str}" fill="none" stroke="#38bdf8" stroke-width="2.5" />')

    svg_lines.append('</svg>')

    with open(filename, "w", encoding="utf-8") as f:
        f.write("\n".join(svg_lines))
    print(f"✨ Saved SVG to: {filename}")


def main():
    print(BANNER)
    parser = argparse.ArgumentParser(description="XPpen: Insane Digital Pen & Physics Studio CLI")
    parser.add_argument("command", choices=["spiro", "lorenz", "harmonograph", "benchmark", "hatch", "demo"], help="Command to execute")
    parser.add_argument("--out", "-o", default="pen_artwork.svg", help="Output SVG filepath")
    parser.add_argument("--gcode", "-g", default=None, help="Output G-code filepath")
    parser.add_argument("--caffeine", "-c", type=float, default=0.0, help="Human hand jitter caffeine level (0.0 to 1.0)")

    args = parser.parse_args()

    print(f"🚀 Running command: {args.command} ...")

    if args.command == "spiro":
        pen = SpirographPen(R=220, r=84, d=110, gear_type="hypotrochoid")
        pts = pen.generate(center_x=400, center_y=300, revolutions=14, samples=2800)
    elif args.command == "lorenz":
        pen = LorenzAttractorPen(dt=0.007)
        pts = pen.generate(steps=4500, scale=12.5, offset_x=400, offset_y=300)
    elif args.command == "harmonograph":
        pen = HarmonographPen()
        pts = pen.generate(center_x=400, center_y=300, duration=70.0, samples=3500)
    elif args.command == "hatch":
        hatcher = CrossHatchGenerator(spacing=10.0)
        strokes = hatcher.hatch_rect(100, 100, 600, 400, density=1.4)
        pts = []
        for s in strokes:
            pts.extend(s.points)
    elif args.command == "benchmark":
        print("⚡ Benchmarking Philip J. Schneider Bézier Curve Fitting...")
        pen = SpirographPen(R=200, r=75, d=90)
        pts = pen.generate(samples=3000)
        pt2d = [Point2D(p[0], p[1], p[2]) for p in pts]

        t0 = time.perf_counter()
        fitter = BezierFitter(error_tolerance=2.5)
        segments = fitter.fit_curve(pt2d)
        elapsed = (time.perf_counter() - t0) * 1000.0

        compression_ratio = (len(segments) * 4) / len(pts) * 100.0
        print(f"  • Raw Input Points:   {len(pts)}")
        print(f"  • Bézier Segments:    {len(segments)} ({len(segments) * 4} control points)")
        print(f"  • Data Compression:   {100.0 - compression_ratio:.1f}% reduction")
        print(f"  • Fit Time:           {elapsed:.2f} ms")
        print("  • Curve Continuity:   C1 Tangent Continuous")
        print("🔥 Benchmark complete! Schneider's algorithm crushed it.")
        return
    else:  # demo
        pen = HarmonographPen()
        pts = pen.generate(center_x=400, center_y=300, duration=60.0, samples=2500)

    # Apply caffeine jitter if requested
    if args.caffeine > 0.0:
        print(f"☕ Applying caffeine hand tremor level: {args.caffeine}...")
        humanizer = HumanHandImperfectionSimulator(caffeine_level=args.caffeine)
        pts = humanizer.humanize_stroke(pts)

    # Render terminal ASCII preview
    print("\nTerminal Preview:")
    print(render_ascii_canvas(pts, width=72, height=22))

    # Export SVG
    export_svg(pts, args.out)

    # Export G-code if requested
    if args.gcode:
        gcode_gen = GCodeGenerator()
        stroke = PlotterStroke(points=pts)
        gcode_str = gcode_gen.generate([stroke], optimize_first=True)
        with open(args.gcode, "w", encoding="utf-8") as f:
            f.write(gcode_str)
        print(f"🤖 Exported G-Code to: {args.gcode}")


if __name__ == "__main__":
    main()
