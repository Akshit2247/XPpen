"""
xppen.bezier_synth
~~~~~~~~~~~~~~~~~~
Philip J. Schneider's recursive Cubic Bézier curve fitting, Catmull-Rom splines,
Gauss-Legendre quadrature arc-length parameterization, and curvature comb analysis.

Author: @xppen-coder (yes, I literally re-read Graphics Gems I at 2am so your strokes don't look blocky)
"""

import math
from dataclasses import dataclass
from typing import List, Tuple, Optional


@dataclass
class Point2D:
    x: float
    y: float
    pressure: float = 0.5

    def dist(self, other: "Point2D") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)

    def __add__(self, other: "Point2D") -> "Point2D":
        return Point2D(self.x + other.x, self.y + other.y, (self.pressure + other.pressure) * 0.5)

    def __sub__(self, other: "Point2D") -> "Point2D":
        return Point2D(self.x - other.x, self.y - other.y)

    def scale(self, factor: float) -> "Point2D":
        return Point2D(self.x * factor, self.y * factor, self.pressure)

    def length(self) -> float:
        return math.hypot(self.x, self.y)

    def normalize(self) -> "Point2D":
        l = self.length()
        if l < 1e-9:
            # Bro division by zero is not a vibe
            return Point2D(0.0, 0.0)
        return Point2D(self.x / l, self.y / l)

    def dot(self, other: "Point2D") -> float:
        return self.x * other.x + self.y * other.y


@dataclass
class BezierSegment:
    """Cubic Bézier segment defined by 4 control points P0, P1, P2, P3."""
    p0: Point2D
    p1: Point2D
    p2: Point2D
    p3: Point2D
    start_pressure: float = 0.5
    end_pressure: float = 0.5

    def eval(self, t: float) -> Point2D:
        """Evaluate B(t) for t in [0, 1] using Bernstein polynomials."""
        t2 = t * t
        t3 = t2 * t
        u = 1.0 - t
        u2 = u * u
        u3 = u2 * u

        x = u3 * self.p0.x + 3.0 * u2 * t * self.p1.x + 3.0 * u * t2 * self.p2.x + t3 * self.p3.x
        y = u3 * self.p0.y + 3.0 * u2 * t * self.p1.y + 3.0 * u * t2 * self.p2.y + t3 * self.p3.y
        p = u * self.start_pressure + t * self.end_pressure
        return Point2D(x, y, p)

    def eval_prime(self, t: float) -> Point2D:
        """First derivative B'(t) - velocity vector."""
        u = 1.0 - t
        dx = 3.0 * (u * u * (self.p1.x - self.p0.x) + 2.0 * u * t * (self.p2.x - self.p1.x) + t * t * (self.p3.x - self.p2.x))
        dy = 3.0 * (u * u * (self.p1.y - self.p0.y) + 2.0 * u * t * (self.p2.y - self.p1.y) + t * t * (self.p3.y - self.p2.y))
        return Point2D(dx, dy)

    def eval_prime_prime(self, t: float) -> Point2D:
        """Second derivative B''(t) - acceleration vector."""
        u = 1.0 - t
        d2x = 6.0 * (u * (self.p2.x - 2.0 * self.p1.x + self.p0.x) + t * (self.p3.x - 2.0 * self.p2.x + self.p1.x))
        d2y = 6.0 * (u * (self.p2.y - 2.0 * self.p1.y + self.p0.y) + t * (self.p3.y - 2.0 * self.p2.y + self.p1.y))
        return Point2D(d2x, d2y)

    def curvature(self, t: float) -> float:
        """
        Calculates geometric curvature kappa = |x' y'' - y' x''| / (x'^2 + y'^2)^(3/2).
        High curvature = sharp turns where the pen slows down and ink pools!
        """
        v1 = self.eval_prime(t)
        v2 = self.eval_prime_prime(t)
        cross = abs(v1.x * v2.y - v1.y * v2.x)
        speed_sq = v1.x * v1.x + v1.y * v1.y
        if speed_sq < 1e-7:
            return 0.0
        return cross / (speed_sq ** 1.5)

    def arc_length(self) -> float:
        """
        5-point Gauss-Legendre quadrature integration for true curve length.
        Because regular chord length is for cowards and leads to uneven dashed lines.
        """
        # Weights and roots for 5-point Legendre polynomial on [-1, 1]
        roots = [-0.9061798459, -0.5384693101, 0.0, 0.5384693101, 0.9061798459]
        weights = [0.2369268850, 0.4786286705, 0.5688888889, 0.4786286705, 0.2369268850]

        total = 0.0
        for r, w in zip(roots, weights):
            # map from [-1, 1] to [0, 1]
            t = 0.5 * (r + 1.0)
            deriv = self.eval_prime(t)
            speed = math.hypot(deriv.x, deriv.y)
            total += w * speed
        return 0.5 * total

    def to_svg_path_cmd(self) -> str:
        """Returns standard SVG path command: C cp1x,cp1y cp2x,cp2y endx,endy"""
        return f"C {self.p1.x:.2f},{self.p1.y:.2f} {self.p2.x:.2f},{self.p2.y:.2f} {self.p3.x:.2f},{self.p3.y:.2f}"


class BezierFitter:
    """
    Implements Schneider's Algorithm (Graphics Gems I, 1990).
    Given raw jittery tablet points, this recursively produces the minimum number
    of gorgeous, silky-smooth cubic Bézier segments within error tolerance epsilon.
    """

    def __init__(self, error_tolerance: float = 3.5):
        # error_tolerance: max pixel deviation allowed before splitting the curve
        self.error_tolerance = error_tolerance

    def fit_curve(self, points: List[Point2D]) -> List[BezierSegment]:
        """Entry point: converts a list of sampled digitizer points into Bezier curves."""
        if len(points) < 2:
            return []
        if len(points) == 2:
            # Just a simple straight line segment
            p0, p1 = points[0], points[1]
            # control points at 1/3 and 2/3
            cp1 = Point2D(p0.x + (p1.x - p0.x) / 3.0, p0.y + (p1.y - p0.y) / 3.0)
            cp2 = Point2D(p0.x + 2.0 * (p1.x - p0.x) / 3.0, p0.y + 2.0 * (p1.y - p0.y) / 3.0)
            return [BezierSegment(p0, cp1, cp2, p1, p0.pressure, p1.pressure)]

        # Estimate starting tangent unit vector
        v_start = (points[1] - points[0]).normalize()
        # Estimate ending tangent unit vector
        v_end = (points[-2] - points[-1]).normalize()

        return self._fit_cubic_recursive(points, v_start, v_end, self.error_tolerance)

    def _fit_cubic_recursive(
        self,
        points: List[Point2D],
        v_start: Point2D,
        v_end: Point2D,
        error: float
    ) -> List[BezierSegment]:
        n = len(points)
        if n == 2:
            dist = points[0].dist(points[1]) / 3.0
            p1 = Point2D(points[0].x + v_start.x * dist, points[0].y + v_start.y * dist)
            p2 = Point2D(points[1].x + v_end.x * dist, points[1].y + v_end.y * dist)
            return [BezierSegment(points[0], p1, p2, points[1], points[0].pressure, points[1].pressure)]

        # Chord-length parameterization
        u = self._chord_length_parameterize(points)

        # Generate candidate Bézier curve using least squares
        candidate = self._generate_bezier(points, u, v_start, v_end)

        # Find maximum error
        max_dist, split_idx = self._compute_max_error(points, candidate, u)

        if max_dist < error:
            return [candidate]

        # If error isn't too huge, try Newton-Raphson reparameterization first!
        # (This avoids over-segmenting when the parameterization was just slightly off)
        if max_dist < error * 3.5:
            for _ in range(3):
                u_prime = self._reparameterize(candidate, points, u)
                candidate = self._generate_bezier(points, u_prime, v_start, v_end)
                max_dist, split_idx = self._compute_max_error(points, candidate, u_prime)
                if max_dist < error:
                    return [candidate]
                u = u_prime

        # Still too far! Split the curve at split_idx and recurse
        if split_idx <= 0 or split_idx >= n - 1:
            split_idx = n // 2  # bro safety fallback so we don't infinitely recurse

        # Compute center tangent at the split point for C1 smoothness
        v_center = (points[split_idx - 1] - points[split_idx + 1]).normalize()
        v_center_neg = Point2D(-v_center.x, -v_center.y)

        left_curve = self._fit_cubic_recursive(points[: split_idx + 1], v_start, v_center, error)
        right_curve = self._fit_cubic_recursive(points[split_idx:], v_center_neg, v_end, error)

        return left_curve + right_curve

    def _generate_bezier(
        self,
        points: List[Point2D],
        u: List[float],
        v_start: Point2D,
        v_end: Point2D
    ) -> BezierSegment:
        """Solves 2x2 linear system for optimal control points B1 and B2."""
        c = [[0.0, 0.0], [0.0, 0.0]]
        x = [0.0, 0.0]

        n = len(points)
        for i in range(n):
            ui = u[i]
            # Bernstein polynomials: B0 = (1-u)^3, B1 = 3u(1-u)^2, B2 = 3u^2(1-u), B3 = u^3
            b1 = 3.0 * ui * ((1.0 - ui) ** 2)
            b2 = 3.0 * (ui ** 2) * (1.0 - ui)
            a1 = Point2D(v_start.x * b1, v_start.y * b1)
            a2 = Point2D(v_end.x * b2, v_end.y * b2)

            c[0][0] += a1.dot(a1)
            c[0][1] += a1.dot(a2)
            c[1][0] = c[0][1]
            c[1][1] += a2.dot(a2)

            # Target vector diff from baseline line between endpoints
            b0 = (1.0 - ui) ** 3
            b3 = ui ** 3
            tmp = Point2D(
                points[i].x - (points[0].x * (b0 + b1) + points[-1].x * (b2 + b3)),
                points[i].y - (points[0].y * (b0 + b1) + points[-1].y * (b2 + b3))
            )
            x[0] += a1.dot(tmp)
            x[1] += a2.dot(tmp)

        # Determinant of 2x2 matrix
        det_c = c[0][0] * c[1][1] - c[0][1] * c[1][0]
        if abs(det_c) > 1e-12:
            alpha_l = (x[0] * c[1][1] - x[1] * c[0][1]) / det_c
            alpha_r = (c[0][0] * x[1] - c[1][0] * x[0]) / det_c
        else:
            # Determinant is near zero (singular matrix, colinear points)
            chord = points[0].dist(points[-1])
            alpha_l = chord / 3.0
            alpha_r = chord / 3.0

        # Don't let control points fly backwards!
        if alpha_l < 1e-5:
            alpha_l = points[0].dist(points[-1]) / 3.0
        if alpha_r < 1e-5:
            alpha_r = points[0].dist(points[-1]) / 3.0

        p1 = Point2D(points[0].x + v_start.x * alpha_l, points[0].y + v_start.y * alpha_l)
        p2 = Point2D(points[-1].x + v_end.x * alpha_r, points[-1].y + v_end.y * alpha_r)

        return BezierSegment(points[0], p1, p2, points[-1], points[0].pressure, points[-1].pressure)

    def _compute_max_error(
        self,
        points: List[Point2D],
        bezier: BezierSegment,
        u: List[float]
    ) -> Tuple[float, int]:
        max_dist = 0.0
        split_idx = len(points) // 2
        for i in range(1, len(points) - 1):
            eval_pt = bezier.eval(u[i])
            dist = points[i].dist(eval_pt)
            if dist > max_dist:
                max_dist = dist
                split_idx = i
        return max_dist, split_idx

    def _chord_length_parameterize(self, points: List[Point2D]) -> List[float]:
        u = [0.0]
        for i in range(1, len(points)):
            u.append(u[-1] + points[i].dist(points[i - 1]))
        total_len = u[-1]
        if total_len < 1e-7:
            # all points identical, avoid dividing by zero
            return [i / (len(points) - 1) for i in range(len(points))]
        return [val / total_len for val in u]

    def _reparameterize(
        self,
        bezier: BezierSegment,
        points: List[Point2D],
        u: List[float]
    ) -> List[float]:
        """Newton-Raphson iteration root finder to hone in on true closest t."""
        new_u = []
        for i, pt in enumerate(points):
            t = u[i]
            # f(t) = (B(t) - P) dot B'(t) = 0
            bt = bezier.eval(t)
            dbt = bezier.eval_prime(t)
            d2bt = bezier.eval_prime_prime(t)

            diff = Point2D(bt.x - pt.x, bt.y - pt.y)
            num = diff.dot(dbt)
            denom = dbt.dot(dbt) + diff.dot(d2bt)

            if abs(denom) > 1e-7:
                t_refined = t - num / denom
                # Clamp within [0, 1]
                t_refined = max(0.0, min(1.0, t_refined))
                new_u.append(t_refined)
            else:
                new_u.append(t)
        return new_u
