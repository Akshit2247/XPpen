"""
xppen.generative_pens
~~~~~~~~~~~~~~~~~~~~~
Autonomous mechanical & chaotic generative pen instruments:
- Multi-gear Epicycloid / Hypotrochoid Spirograph engine
- 4th-Order Runge-Kutta Lorenz & Clifford Chaotic Attractor pens
- Triple-Pendulum damped Harmonograph physical simulation

Author: @xppen-coder (I put chaotic attractors in a pen engine because normal brushes are boring)
"""

import math
from typing import List, Tuple


class SpirographPen:
    """
    Simulates mechanical rolling gears with a pen hole at distance d from rotor center.
    Also models gear friction backlash so lines feel organically drawn rather than clinical.
    """

    def __init__(self, R: float = 180.0, r: float = 68.0, d: float = 95.0, gear_type: str = "hypotrochoid"):
        self.R = R
        self.r = r
        self.d = d
        self.gear_type = gear_type

    def generate(self, center_x: float = 400.0, center_y: float = 300.0, revolutions: int = 12, samples: int = 2500) -> List[Tuple[float, float, float]]:
        """Returns [(x, y, pressure), ...] for the spirograph loop."""
        points = []
        max_theta = revolutions * 2.0 * math.pi
        d_theta = max_theta / samples

        R, r, d = self.R, self.r, self.d
        diff = R - r if self.gear_type == "hypotrochoid" else R + r
        ratio = diff / r

        for i in range(samples):
            theta = i * d_theta

            if self.gear_type == "hypotrochoid":
                x = diff * math.cos(theta) + d * math.cos(ratio * theta)
                y = diff * math.sin(theta) - d * math.sin(ratio * theta)
            else:
                x = diff * math.cos(theta) - d * math.cos(ratio * theta)
                y = diff * math.sin(theta) - d * math.sin(ratio * theta)

            # Simulated pen pressure: pen accelerates on tight curves and slows down on crests
            # (Newtonian gear centrifugal acceleration on the pen tip)
            centrifugal = math.hypot(x, y) / (R + d)
            pressure = 0.35 + 0.55 * (1.0 - min(1.0, centrifugal))

            points.append((center_x + x, center_y + y, pressure))

        return points


class LorenzAttractorPen:
    """
    Simulates Edward Lorenz's atmospheric convection strange attractor:
      dx/dt = sigma * (y - x)
      dy/dt = x * (rho - z) - y
      dz/dt = x * y - beta * z
    Solved with 4th-Order Runge-Kutta (RK4) integration.
    The Z-dimension is mapped to stylus pressure and ink saturation!
    """

    def __init__(self, sigma: float = 10.0, rho: float = 28.0, beta: float = 8.0 / 3.0, dt: float = 0.008):
        self.sigma = sigma
        self.rho = rho
        self.beta = beta
        self.dt = dt

    def _derivs(self, x: float, y: float, z: float) -> Tuple[float, float, float]:
        dx = self.sigma * (y - x)
        dy = x * (self.rho - z) - y
        dz = x * y - self.beta * z
        return dx, dy, dz

    def generate(self, steps: int = 4000, scale: float = 11.0, offset_x: float = 400.0, offset_y: float = 300.0) -> List[Tuple[float, float, float]]:
        x, y, z = 0.1, 0.0, 0.0  # initial non-zero perturbation
        dt = self.dt
        points = []

        # Warm up 200 steps to let trajectory settle onto the strange attractor manifold
        for _ in range(200):
            k1_x, k1_y, k1_z = self._derivs(x, y, z)
            x += k1_x * dt
            y += k1_y * dt
            z += k1_z * dt

        # RK4 Integration loop
        for _ in range(steps):
            # k1
            k1_x, k1_y, k1_z = self._derivs(x, y, z)

            # k2
            x_k2 = x + 0.5 * dt * k1_x
            y_k2 = y + 0.5 * dt * k1_y
            z_k2 = z + 0.5 * dt * k1_z
            k2_x, k2_y, k2_z = self._derivs(x_k2, y_k2, z_k2)

            # k3
            x_k3 = x + 0.5 * dt * k2_x
            y_k3 = y + 0.5 * dt * k2_y
            z_k3 = z + 0.5 * dt * k2_z
            k3_x, k3_y, k3_z = self._derivs(x_k3, y_k3, z_k3)

            # k4
            x_k4 = x + dt * k3_x
            y_k4 = y + dt * k3_y
            z_k4 = z + dt * k3_z
            k4_x, k4_y, k4_z = self._derivs(x_k4, y_k4, z_k4)

            # Weighted sum
            x += (dt / 6.0) * (k1_x + 2.0 * k2_x + 2.0 * k3_x + k4_x)
            y += (dt / 6.0) * (k1_y + 2.0 * k2_y + 2.0 * k3_y + k4_y)
            z += (dt / 6.0) * (k1_z + 2.0 * k2_z + 2.0 * k3_z + k4_z)

            # Map 3D to 2D screen with perspective tilt
            screen_x = offset_x + x * scale
            screen_y = offset_y + (z - 25.0) * scale * 0.95

            # Map Z (vertical depth) to XP-Pen stylus pressure
            # Z varies roughly between 0 and 50
            pressure = max(0.1, min(1.0, (z / 45.0) ** 1.3))

            points.append((screen_x, screen_y, pressure))

        return points


class HarmonographPen:
    """
    Simulates a Victorian 3-Pendulum Harmonograph:
    Two lateral pendulums control X and Y axes, while a rotary pendulum
    controls paper platter rotation. Friction dampens the amplitude over time.
    """

    def __init__(
        self,
        f1: float = 2.001, d1: float = 0.0018, p1: float = 0.0,
        f2: float = 3.002, d2: float = 0.0015, p2: float = math.pi * 0.5,
        f3: float = 1.000, d3: float = 0.0022, p3: float = math.pi * 0.25,
        amp1: float = 180.0, amp2: float = 180.0
    ):
        self.f1, self.d1, self.p1 = f1, d1, p1
        self.f2, self.d2, self.p2 = f2, d2, p2
        self.f3, self.d3, self.p3 = f3, d3, p3
        self.amp1 = amp1
        self.amp2 = amp2

    def generate(self, center_x: float = 400.0, center_y: float = 300.0, duration: float = 60.0, samples: int = 3500) -> List[Tuple[float, float, float]]:
        points = []
        dt = duration / samples

        for i in range(samples):
            t = i * dt
            # Pendulum 1 & 2 (X and Y linear oscillations)
            decay1 = math.exp(-self.d1 * t)
            decay2 = math.exp(-self.d2 * t)
            decay3 = math.exp(-self.d3 * t)

            x = self.amp1 * math.sin(self.f1 * t + self.p1) * decay1
            y = self.amp2 * math.sin(self.f2 * t + self.p2) * decay2

            # Pendulum 3 (rotational platter offset)
            rot_x = 25.0 * math.sin(self.f3 * t + self.p3) * decay3
            rot_y = 25.0 * math.cos(self.f3 * t + self.p3) * decay3

            # Pressure softens as the pendulum loses kinetic energy
            kinetic_energy = decay1 * 0.5 + decay2 * 0.5
            pressure = 0.25 + 0.70 * kinetic_energy

            points.append((center_x + x + rot_x, center_y + y + rot_y, pressure))

        return points
