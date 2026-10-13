"""
XPpen: The Insanely Over-Engineered Python Digital Stylus & Physics Pen Studio
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Because life's too short for boring straight lines and rigid vectors.

Features:
- Spring-Mass-Damper 2nd-order nib dynamics with Stribeck paper friction
- 8,192-level XP-Pen pressure curve calibration (Linear, Soft, Firm, Sigmoidal S-Curve)
- Philip J. Schneider recursive Cubic Bézier curve fitting & Gauss-Legendre arc-length
- Broad-edge Gothic chisel nibs & Pointed flex nibs with capillary railroading
- AxiDraw / CNC Pen Plotter G-Code engine with TSP 2-Opt air-travel path optimization
- Spirograph, RK4 Lorenz Attractor, and Harmonograph generative pen instruments
- Biological human hand tremor & caffeine micro-jitter synthesis
"""

__version__ = "1.0.0-unhinged"
__author__ = "xppen-coder <dev@xppen.local>"

from .physics_engine import StylusPhysicsSimulator, StylusState, SimulatedContact
from .bezier_synth import BezierFitter, BezierSegment, Point2D
from .calligraphy import BroadEdgeNib, PointedFlexNib, CalligraphyVertex
from .gcode_plotter import PlotterOptimizer, GCodeGenerator, PlotterStroke, CrossHatchGenerator
from .generative_pens import SpirographPen, LorenzAttractorPen, HarmonographPen
from .human_jitter import HumanHandImperfectionSimulator

BANNER = r"""
 __   ______  ____            
 \ \ / /  _ \|  _ \ ___ _ __  
  \ V /| |_) | |_) / _ \ '_ \ 
   | | |  __/|  __/  __/ | | |
   |_| |_|   |_|   \___|_| |_|  v1.0.0
 >> Digital Stylus & Physics Pen Computing Suite <<
"""
