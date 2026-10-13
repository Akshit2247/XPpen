"""
Tests for XPpen Core Suite
~~~~~~~~~~~~~~~~~~~~~~~~~~
Checks spring-damper dynamics, Bezier curve fitting, G-code optimization,
calligraphy railroading, and spirograph generators.
"""

import unittest
import math
from xppen.physics_engine import StylusPhysicsSimulator, StylusState
from xppen.bezier_synth import BezierFitter, Point2D
from xppen.calligraphy import PointedFlexNib, BroadEdgeNib
from xppen.gcode_plotter import PlotterOptimizer, GCodeGenerator, PlotterStroke
from xppen.generative_pens import SpirographPen, LorenzAttractorPen, HarmonographPen


class TestStylusPhysics(unittest.TestCase):
    def test_spring_damper_convergence(self):
        sim = StylusPhysicsSimulator(mass=1.0, spring_k=0.5, damping_c=0.4)
        target = StylusState(x=100.0, y=100.0, pressure=0.8, timestamp=0.0)
        # Advance simulation several ticks
        for i in range(1, 40):
            target.timestamp = i * 16.67
            contact = sim.update(target)

        # Tip should track target position closely
        self.assertAlmostEqual(contact.x, 100.0, delta=2.5)
        self.assertAlmostEqual(contact.y, 100.0, delta=2.5)
        self.assertGreater(contact.effective_pressure, 0.6)

    def test_pressure_calibration_curves(self):
        sim = StylusPhysicsSimulator(pressure_curve="s_curve")
        p0 = sim.calibrate_pressure(0.0)
        p1 = sim.calibrate_pressure(1.0)
        p_mid = sim.calibrate_pressure(0.5)

        self.assertAlmostEqual(p0, 0.0, delta=0.01)
        self.assertAlmostEqual(p1, 1.0, delta=0.01)
        self.assertTrue(0.0 < p_mid < 1.0)


class TestBezierFitting(unittest.TestCase):
    def test_straight_line(self):
        pts = [Point2D(0.0, 0.0), Point2D(50.0, 50.0), Point2D(100.0, 100.0)]
        fitter = BezierFitter(error_tolerance=2.0)
        segments = fitter.fit_curve(pts)
        self.assertEqual(len(segments), 1)

    def test_circle_arc_fitting(self):
        # Sample points on a quadrant arc
        pts = []
        for i in range(25):
            angle = i * (math.pi * 0.5 / 24)
            pts.append(Point2D(math.cos(angle) * 100.0, math.sin(angle) * 100.0))

        fitter = BezierFitter(error_tolerance=2.5)
        segments = fitter.fit_curve(pts)
        self.assertGreaterEqual(len(segments), 1)
        self.assertLessEqual(len(segments), 4)


class TestGCodePlotter(unittest.TestCase):
    def test_tsp_2opt_reduces_air_travel(self):
        # Create disconnected strokes out of order
        stroke1 = PlotterStroke([(0, 0, 0.5), (10, 0, 0.5)])
        stroke2 = PlotterStroke([(100, 100, 0.5), (110, 100, 0.5)])
        stroke3 = PlotterStroke([(11, 0, 0.5), (20, 0, 0.5)])

        optimizer = PlotterOptimizer()
        ordered = optimizer.optimize_strokes([stroke1, stroke2, stroke3])

        # stroke3 is right next to stroke1, so it should be placed right after stroke1!
        self.assertEqual(ordered[0], stroke1)
        self.assertEqual(ordered[1], stroke3)


class TestCalligraphy(unittest.TestCase):
    def test_flex_nib_railroading(self):
        nib = PointedFlexNib(surface_tension_limit=15.0)
        # Fast movement with maximum pressure triggers capillary collapse
        samples = [(0, 0, 1.0, 25.0), (10, 10, 1.0, 25.0)]
        vertices = nib.process_stroke(samples)
        self.assertTrue(any(v.is_railroading for v in vertices))


if __name__ == "__main__":
    unittest.main()
