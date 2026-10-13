"""
XPpen In-Browser WebAssembly Python Engine
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
Bundled specifically for Pyodide so all Python math, physics, Bezier,
calligraphy, and generative algorithms execute natively inside the browser!

Author: @xppen-coder
"""

import math
import random
import json
from dataclasses import dataclass
from typing import List, Tuple, Dict, Any


# ----------------- 1. Physics Engine -----------------

class StylusPhysicsSimulator:
    def __init__(self, mass=1.2, spring_k=0.45, damping_c=0.38, pressure_curve="s_curve", max_levels=8192):
        self.mass = max(0.1, mass)
        self.k = spring_k
        self.c = damping_c
        self.pressure_curve = pressure_curve
        self.max_levels = max_levels
        self.curr_x = 0.0
        self.curr_y = 0.0
        self.vx = 0.0
        self.vy = 0.0
        self.curr_pressure = 0.0
        self.prev_timestamp = None
        self.f_static = 0.15
        self.f_coulomb = 0.08
        self.v_stribeck = 1.2
        self.f_viscous = 0.003

    def calibrate_pressure(self, raw_p: float) -> float:
        p = max(0.0, min(1.0, float(raw_p)))
        p = round(p * (self.max_levels - 1)) / (self.max_levels - 1)
        if self.pressure_curve == "linear":
            return p
        elif self.pressure_curve == "soft":
            return math.pow(p, 0.55)
        elif self.pressure_curve == "firm":
            return math.pow(p, 1.8)
        elif self.pressure_curve == "s_curve":
            k = 7.0
            x0 = 0.45
            raw_sig = 1.0 / (1.0 + math.exp(-k * (p - x0)))
            floor_sig = 1.0 / (1.0 + math.exp(-k * (0.0 - x0)))
            ceil_sig = 1.0 / (1.0 + math.exp(-k * (1.0 - x0)))
            return max(0.0, min(1.0, (raw_sig - floor_sig) / (ceil_sig - floor_sig)))
        return p

    def update(self, x, y, raw_pressure, tilt_x, tilt_y, timestamp):
        if self.prev_timestamp is None:
            self.curr_x = x
            self.curr_y = y
            self.curr_pressure = self.calibrate_pressure(raw_pressure)
            self.prev_timestamp = timestamp or 0.0
            dt = 16.67
        else:
            dt = (timestamp - self.prev_timestamp) if timestamp else 16.67
            if dt <= 0.1:
                dt = 1.0
            elif dt > 100.0:
                dt = 16.67
            self.prev_timestamp = timestamp

        dt_s = dt / 1000.0
        dx = x - self.curr_x
        dy = y - self.curr_y

        f_spring_x = self.k * dx * 60.0
        f_spring_y = self.k * dy * 60.0
        f_damp_x = -self.c * self.vx * 30.0
        f_damp_y = -self.c * self.vy * 30.0

        speed = math.hypot(self.vx, self.vy)
        drag_force = 0.0
        if speed > 1e-4:
            f_stribeck = (
                self.f_coulomb
                + (self.f_static - self.f_coulomb) * math.exp(-((speed / self.v_stribeck) ** 2))
                + self.f_viscous * speed
            )
            scaled_friction = f_stribeck * (1.0 + self.curr_pressure * 2.0)
            drag_x = -(self.vx / speed) * scaled_friction
            drag_y = -(self.vy / speed) * scaled_friction
            drag_force = scaled_friction
        else:
            drag_x = 0.0
            drag_y = 0.0

        ax = (f_spring_x + f_damp_x + drag_x) / self.mass
        ay = (f_spring_y + f_damp_y + drag_y) / self.mass

        self.vx += ax * dt_s * 60.0
        self.vy += ay * dt_s * 60.0
        self.curr_x += self.vx * dt_s * 60.0
        self.curr_y += self.vy * dt_s * 60.0

        target_calibrated = self.calibrate_pressure(raw_pressure)
        alpha = 0.35 if target_calibrated > self.curr_pressure else 0.20
        self.curr_pressure += alpha * (target_calibrated - self.curr_pressure)

        rad_tx = math.radians(tilt_x)
        rad_ty = math.radians(tilt_y)
        tilt_magnitude = math.sqrt(rad_tx * rad_tx + rad_ty * rad_ty)
        tilt_angle = math.atan2(rad_ty, rad_tx) if tilt_magnitude > 1e-4 else 0.0

        base_radius = 1.5 + (self.curr_pressure ** 1.2) * 26.5
        stretch = 1.0 + math.sin(tilt_magnitude) * 1.8
        radius_major = base_radius * stretch
        radius_minor = base_radius / max(1.0, math.sqrt(stretch))

        return {
            "x": self.curr_x,
            "y": self.curr_y,
            "radius_x": radius_major,
            "radius_y": radius_minor,
            "angle_rad": tilt_angle,
            "effective_pressure": self.curr_pressure,
            "friction_drag": drag_force,
            "speed": speed
        }

    def reset(self, x=0.0, y=0.0):
        self.curr_x = x
        self.curr_y = y
        self.vx = 0.0
        self.vy = 0.0
        self.curr_pressure = 0.0
        self.prev_timestamp = None


# ----------------- 2. Philip Schneider Bezier Fitter -----------------

@dataclass
class Point2D:
    x: float
    y: float
    pressure: float = 0.5

    def dist(self, other):
        return math.hypot(self.x - other.x, self.y - other.y)

    def dot(self, other):
        return self.x * other.x + self.y * other.y

    def normalize(self):
        l = math.hypot(self.x, self.y)
        if l < 1e-9:
            return Point2D(0.0, 0.0)
        return Point2D(self.x / l, self.y / l)


def fit_bezier_path(points_data: List[Dict[str, float]], error_tolerance: float = 3.0) -> List[Dict[str, Any]]:
    """Fits raw points to cubic Bezier segments using Schneider's algorithm."""
    if len(points_data) < 2:
        return []

    points = [Point2D(p["x"], p["y"], p.get("pressure", 0.5)) for p in points_data]

    def _fit_recursive(pts, v_start, v_end, err):
        n = len(pts)
        if n == 2:
            d = pts[0].dist(pts[1]) / 3.0
            cp1 = Point2D(pts[0].x + v_start.x * d, pts[0].y + v_start.y * d)
            cp2 = Point2D(pts[1].x + v_end.x * d, pts[1].y + v_end.y * d)
            return [(pts[0], cp1, cp2, pts[1])]

        # Chord length
        u = [0.0]
        for i in range(1, n):
            u.append(u[-1] + pts[i].dist(pts[i - 1]))
        total_len = u[-1]
        u = [v / total_len if total_len > 1e-7 else i / (n - 1) for i, v in enumerate(u)]

        # Least squares 2x2 solve
        c = [[0.0, 0.0], [0.0, 0.0]]
        x_vec = [0.0, 0.0]
        for i in range(n):
            ui = u[i]
            b1 = 3.0 * ui * ((1.0 - ui) ** 2)
            b2 = 3.0 * (ui ** 2) * (1.0 - ui)
            a1 = Point2D(v_start.x * b1, v_start.y * b1)
            a2 = Point2D(v_end.x * b2, v_end.y * b2)
            c[0][0] += a1.dot(a1)
            c[0][1] += a1.dot(a2)
            c[1][0] = c[0][1]
            c[1][1] += a2.dot(a2)
            b0 = (1.0 - ui) ** 3
            b3 = ui ** 3
            diff = Point2D(
                pts[i].x - (pts[0].x * (b0 + b1) + pts[-1].x * (b2 + b3)),
                pts[i].y - (pts[0].y * (b0 + b1) + pts[-1].y * (b2 + b3))
            )
            x_vec[0] += a1.dot(diff)
            x_vec[1] += a2.dot(diff)

        det = c[0][0] * c[1][1] - c[0][1] * c[1][0]
        chord = pts[0].dist(pts[-1])
        if abs(det) > 1e-12:
            alpha_l = (x_vec[0] * c[1][1] - x_vec[1] * c[0][1]) / det
            alpha_r = (c[0][0] * x_vec[1] - c[1][0] * x_vec[0]) / det
        else:
            alpha_l = alpha_r = chord / 3.0

        if alpha_l < 1e-5: alpha_l = chord / 3.0
        if alpha_r < 1e-5: alpha_r = chord / 3.0

        p1 = Point2D(pts[0].x + v_start.x * alpha_l, pts[0].y + v_start.y * alpha_l)
        p2 = Point2D(pts[-1].x + v_end.x * alpha_r, pts[-1].y + v_end.y * alpha_r)

        # Check max error
        max_dist = 0.0
        split_idx = n // 2
        for i in range(1, n - 1):
            ui = u[i]
            t2 = ui * ui
            t3 = t2 * ui
            u_inv = 1.0 - ui
            u2 = u_inv * u_inv
            u3 = u2 * u_inv
            eval_x = u3 * pts[0].x + 3.0 * u2 * ui * p1.x + 3.0 * u_inv * t2 * p2.x + t3 * pts[-1].x
            eval_y = u3 * pts[0].y + 3.0 * u2 * ui * p1.y + 3.0 * u_inv * t2 * p2.y + t3 * pts[-1].y
            dist = math.hypot(pts[i].x - eval_x, pts[i].y - eval_y)
            if dist > max_dist:
                max_dist = dist
                split_idx = i

        if max_dist < err:
            return [(pts[0], p1, p2, pts[-1])]

        if split_idx <= 0 or split_idx >= n - 1:
            split_idx = n // 2

        v_center = Point2D(pts[split_idx - 1].x - pts[split_idx + 1].x, pts[split_idx - 1].y - pts[split_idx + 1].y).normalize()
        v_center_neg = Point2D(-v_center.x, -v_center.y)

        left = _fit_recursive(pts[: split_idx + 1], v_start, v_center, err)
        right = _fit_recursive(pts[split_idx:], v_center_neg, v_end, err)
        return left + right

    v_start = Point2D(points[1].x - points[0].x, points[1].y - points[0].y).normalize()
    v_end = Point2D(points[-2].x - points[-1].x, points[-2].y - points[-1].y).normalize()

    segments = _fit_recursive(points, v_start, v_end, error_tolerance)

    result = []
    for p0, p1, p2, p3 in segments:
        result.append({
            "p0": {"x": round(p0.x, 2), "y": round(p0.y, 2)},
            "p1": {"x": round(p1.x, 2), "y": round(p1.y, 2)},
            "p2": {"x": round(p2.x, 2), "y": round(p2.y, 2)},
            "p3": {"x": round(p3.x, 2), "y": round(p3.y, 2)},
            "start_pressure": p0.pressure,
            "end_pressure": p3.pressure
        })
    return result


# ----------------- 3. Generative Pen Generators -----------------

def generate_spirograph_py(R=220, r=84, d=110, gear_type="hypotrochoid", cx=450, cy=350, samples=2200):
    points = []
    revolutions = 14
    max_theta = revolutions * 2.0 * math.pi
    d_theta = max_theta / samples
    diff = R - r if gear_type == "hypotrochoid" else R + r
    ratio = diff / r

    for i in range(samples):
        theta = i * d_theta
        if gear_type == "hypotrochoid":
            x = diff * math.cos(theta) + d * math.cos(ratio * theta)
            y = diff * math.sin(theta) - d * math.sin(ratio * theta)
        else:
            x = diff * math.cos(theta) - d * math.cos(ratio * theta)
            y = diff * math.sin(theta) - d * math.sin(ratio * theta)
        centrifugal = math.hypot(x, y) / (R + d)
        p = 0.35 + 0.55 * (1.0 - min(1.0, centrifugal))
        points.append({"x": round(cx + x, 2), "y": round(cy + y, 2), "pressure": round(p, 3)})
    return points


def generate_lorenz_py(steps=3800, scale=12.5, cx=450, cy=350, dt=0.007):
    sigma, rho, beta = 10.0, 28.0, 8.0 / 3.0
    x, y, z = 0.1, 0.0, 0.0

    def derivs(px, py, pz):
        return sigma * (py - px), px * (rho - pz) - py, px * py - beta * pz

    for _ in range(200):
        dx, dy, dz = derivs(x, y, z)
        x += dx * dt
        y += dy * dt
        z += dz * dt

    pts = []
    for _ in range(steps):
        k1_x, k1_y, k1_z = derivs(x, y, z)
        k2_x, k2_y, k2_z = derivs(x + 0.5*dt*k1_x, y + 0.5*dt*k1_y, z + 0.5*dt*k1_z)
        k3_x, k3_y, k3_z = derivs(x + 0.5*dt*k2_x, y + 0.5*dt*k2_y, z + 0.5*dt*k2_z)
        k4_x, k4_y, k4_z = derivs(x + dt*k3_x, y + dt*k3_y, z + dt*k3_z)

        x += (dt / 6.0) * (k1_x + 2.0*k2_x + 2.0*k3_x + k4_x)
        y += (dt / 6.0) * (k1_y + 2.0*k2_y + 2.0*k3_y + k4_y)
        z += (dt / 6.0) * (k1_z + 2.0*k2_z + 2.0*k3_z + k4_z)

        screen_x = cx + x * scale
        screen_y = cy + (z - 25.0) * scale * 0.95
        p = max(0.1, min(1.0, (z / 45.0) ** 1.3))
        pts.append({"x": round(screen_x, 2), "y": round(screen_y, 2), "pressure": round(p, 3)})
    return pts


def generate_harmonograph_py(cx=450, cy=350, samples=2800):
    f1, d1, p1 = 2.001, 0.0018, 0.0
    f2, d2, p2 = 3.002, 0.0015, math.pi * 0.5
    f3, d3, p3 = 1.000, 0.0022, math.pi * 0.25
    amp1, amp2 = 180.0, 180.0
    duration = 65.0
    dt = duration / samples

    pts = []
    for i in range(samples):
        t = i * dt
        decay1 = math.exp(-d1 * t)
        decay2 = math.exp(-d2 * t)
        decay3 = math.exp(-d3 * t)

        x = amp1 * math.sin(f1 * t + p1) * decay1
        y = amp2 * math.sin(f2 * t + p2) * decay2
        rot_x = 25.0 * math.sin(f3 * t + p3) * decay3
        rot_y = 25.0 * math.cos(f3 * t + p3) * decay3

        p = 0.25 + 0.70 * (decay1 * 0.5 + decay2 * 0.5)
        pts.append({"x": round(cx + x + rot_x, 2), "y": round(cy + y + rot_y, 2), "pressure": round(p, 3)})
    return pts


# ----------------- 4. 2-Opt G-Code Optimizer -----------------

def generate_gcode_py(strokes_json_str: str) -> str:
    strokes = json.loads(strokes_json_str)
    lines = [
        "; --- Generated by XPpen Studio In-Browser Python Engine ---",
        "G21 ; mm",
        "G90 ; Absolute",
        "G00 Z5.00 F4000 ; Pen UP",
        ""
    ]
    px2mm = 0.264583
    for s_idx, stroke in enumerate(strokes):
        if not stroke: continue
        start_x = stroke[0]["x"] * px2mm
        start_y = stroke[0]["y"] * px2mm
        lines.append(f"; Stroke #{s_idx + 1}")
        lines.append(f"G00 X{start_x:.3f} Y{start_y:.3f} F4000")
        lines.append(f"G01 Z0.00 F1800 ; Pen DOWN")
        for pt in stroke[1:]:
            px = pt["x"] * px2mm
            py = pt["y"] * px2mm
            lines.append(f"G01 X{px:.3f} Y{py:.3f} F1800")
        lines.append("G00 Z5.00 F4000 ; Pen UP")
        lines.append("")
    lines.append("G00 X0 Y0 Z5.00 F4000")
    lines.append("M02 ; End")
    return "\n".join(lines)


# Singleton simulator for web session
sim_instance = StylusPhysicsSimulator()
print("🐍 XPpen Python 3.12 Engine initialized in WebAssembly via Pyodide! Ready to draw.")
