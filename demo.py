"""
XPpen Quickstart Demo Script
~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Run this to immediately test the Python physics and generative pen engine:
    python demo.py

Author: @xppen-coder
"""

import sys
import os

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from xppen import BANNER
from xppen.generative_pens import HarmonographPen, SpirographPen, LorenzAttractorPen
from xppen.bezier_synth import BezierFitter, Point2D
from xppen.gcode_plotter import GCodeGenerator, PlotterStroke
from xppen.cli import render_ascii_canvas, export_svg


def run_demo():
    print(BANNER)
    print("🔥 Booting XPpen Studio Quickstart Demo...")
    print("------------------------------------------------------------------------")
    
    # 1. Generate Harmonograph
    print("1. Simulating 3-pendulum mechanical Harmonograph...")
    pen = HarmonographPen()
    pts = pen.generate(center_x=400, center_y=300, duration=60.0, samples=2000)
    print(f"   Generated {len(pts)} physical stylus points with kinetic decay.")

    # 2. Fit Bézier Curves
    print("2. Running Philip J. Schneider Bézier Curve Fitting (Graphics Gems I)...")
    pt2d = [Point2D(p[0], p[1], p[2]) for p in pts]
    fitter = BezierFitter(error_tolerance=2.5)
    segments = fitter.fit_curve(pt2d)
    compression = 100.0 - (len(segments) * 4 / len(pts) * 100.0)
    print(f"   Synthesized {len(segments)} C1-continuous cubic Bézier segments ({compression:.1f}% compression!).")

    # 3. Optimize G-Code with TSP 2-Opt
    print("3. Generating AxiDraw/CNC Plotter G-Code with 2-Opt TSP path optimization...")
    stroke = PlotterStroke(points=pts)
    gen = GCodeGenerator()
    gcode = gen.generate([stroke], optimize_first=True)
    with open("demo_output.gcode", "w", encoding="utf-8") as f:
        f.write(gcode)
    print("   Saved optimized G-Code to demo_output.gcode")

    # 4. Render Terminal ASCII Art
    print("\n4. ANSI Terminal Preview:")
    print(render_ascii_canvas(pts, width=70, height=20))

    # 5. Export SVG
    export_svg(pts, "demo_output.svg")
    print("\n✨ Done! Open 'demo_output.svg' or run 'python -m xppen.server' to launch the web studio!")


if __name__ == "__main__":
    run_demo()
